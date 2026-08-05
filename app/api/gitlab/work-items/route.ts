import { NextResponse } from "next/server";
import { gitlabAllPages, gitlabApiError, gitlabOrigin, gitlabRequest } from "@/lib/gitlab";

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

function projectFromReference(reference: string) {
  const separator = reference.lastIndexOf("#");
  return separator > 0 ? reference.slice(0, separator) : reference;
}

export async function GET() {
  try {
    const [viewer, items] = await Promise.all([
      gitlabRequest<RawGitLabUser>("/user", 5 * 60_000),
      gitlabAllPages<RawGitLabWorkItem>(
        "/issues?scope=assigned_to_me&state=opened&order_by=created_at&sort=desc",
      ),
    ]);

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
