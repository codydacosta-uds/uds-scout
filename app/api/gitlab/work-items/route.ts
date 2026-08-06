import { NextResponse } from "next/server";
import { currentGitHubViewer } from "@/lib/github";
import { gitlabAllPages, gitlabApiError, gitlabGraphqlRequest, gitlabOrigin, gitlabRequest } from "@/lib/gitlab";
import { readLocalSettings } from "@/lib/local-settings";

export const runtime = "nodejs";

type RawGitLabUser = {
  username: string;
  name: string | null;
  avatar_url: string | null;
  web_url: string;
};

type RawGitLabWorkItem = {
  id: number;
  iid: number;
  title: string;
  state: string;
  created_at: string;
  updated_at: string;
  web_url: string;
  issue_type: string;
  labels: string[];
  due_date: string | null;
  confidential: boolean;
  references: {
    short: string;
    relative: string;
    full: string;
  };
};

type RawGitLabStatus = {
  name: string;
  color: string;
  iconName: string;
  category: string;
};

type RawGitLabStatusWorkItem = {
  widgets: { type: string; status?: RawGitLabStatus | null }[];
};

const STATUS_BATCH_SIZE = 50;

async function workItemStatuses(items: RawGitLabWorkItem[]) {
  const statuses = new Map<number, RawGitLabStatus>();

  for (let offset = 0; offset < items.length; offset += STATUS_BATCH_SIZE) {
    const batch = items.slice(offset, offset + STATUS_BATCH_SIZE);
    const selection = "{ widgets { type ... on WorkItemWidgetStatus { status { name color iconName category } } } }";
    const query = `query WorkItemStatuses { ${batch.map((item, index) => `item${index}: workItem(id: \"gid://gitlab/WorkItem/${item.id}\") ${selection}`).join("\n")} }`;
    const result = await gitlabGraphqlRequest<Record<string, RawGitLabStatusWorkItem | null>>(query);

    batch.forEach((item, index) => {
      const widget = result[`item${index}`]?.widgets.find((candidate) => candidate.type === "STATUS");
      if (widget?.status) statuses.set(item.id, widget.status);
    });
  }

  return statuses;
}

function projectFromReference(reference: string) {
  const separator = reference.lastIndexOf("#");
  return separator > 0 ? reference.slice(0, separator) : reference;
}

export async function GET() {
  try {
    const settings = readLocalSettings(currentGitHubViewer());
    const selectedProjects = new Set((settings?.gitlabProjects ?? []).map((project) => project.toLowerCase()));
    const [viewer, availableItems] = await Promise.all([
      gitlabRequest<RawGitLabUser>("/user", 5 * 60_000),
      selectedProjects.size
        ? gitlabAllPages<RawGitLabWorkItem>("/issues?scope=assigned_to_me&state=opened&order_by=created_at&sort=desc")
        : Promise.resolve([]),
    ]);
    const items = availableItems.filter((item) => selectedProjects.has(projectFromReference(item.references.full).toLowerCase()));

    const statuses = await workItemStatuses(items).catch(() => new Map<number, RawGitLabStatus>());
    const dashboard = new URL("/dashboard/work_items", gitlabOrigin());
    dashboard.searchParams.set("sort", "created_date");
    dashboard.searchParams.set("state", "opened");
    dashboard.searchParams.append("assignee_username[]", viewer.username);

    return NextResponse.json({
      viewer: {
        username: viewer.username,
        name: viewer.name,
        avatarUrl: viewer.avatar_url,
        url: viewer.web_url,
      },
      items: items.map((item) => ({
        id: item.id,
        iid: item.iid,
        title: item.title,
        url: item.web_url,
        state: item.state,
        status: statuses.get(item.id) ?? null,
        type: item.issue_type,
        project: projectFromReference(item.references.full),
        reference: item.references.short,
        labels: item.labels,
        createdAt: item.created_at,
        updatedAt: item.updated_at,
        dueDate: item.due_date,
        confidential: item.confidential,
      })),
      dashboardUrl: dashboard.toString(),
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    const failure = gitlabApiError(error);
    return NextResponse.json({ error: failure.message }, { status: failure.status });
  }
}
