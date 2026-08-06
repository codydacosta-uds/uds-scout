import { NextRequest, NextResponse } from "next/server";
import { currentGitHubViewer } from "@/lib/github";
import { gitlabAllPages, gitlabApiError, gitlabMutation, gitlabProjectPreflight } from "@/lib/gitlab";
import { MAX_GITLAB_TICKET_BATCH } from "@/lib/gitlab-ticket-constants";
import { readLocalSettings } from "@/lib/local-settings";

export const runtime = "nodejs";

type TicketDraft = {
  clientId: string;
  title: string;
  description: string;
  labels: string[];
};

type GitlabLabel = { name: string };

type CreatedIssue = {
  id: number;
  iid: number;
  title: string;
  web_url: string;
};

function validateDrafts(value: unknown): { drafts: TicketDraft[] } | { error: string } {
  if (!value || typeof value !== "object") return { error: "A ticket batch is required." };
  const tickets = (value as { tickets?: unknown }).tickets;
  if (!Array.isArray(tickets) || tickets.length === 0) return { error: "Stage at least one ticket before submitting." };
  if (tickets.length > MAX_GITLAB_TICKET_BATCH) return { error: `A batch can contain at most ${MAX_GITLAB_TICKET_BATCH} tickets.` };

  const drafts: TicketDraft[] = [];
  const clientIds = new Set<string>();
  for (const ticket of tickets) {
    if (!ticket || typeof ticket !== "object") return { error: "Every staged ticket must be an object." };
    const candidate = ticket as { clientId?: unknown; title?: unknown; description?: unknown; labels?: unknown };
    const clientId = typeof candidate.clientId === "string" ? candidate.clientId.trim() : "";
    const title = typeof candidate.title === "string" ? candidate.title.trim() : "";
    const description = typeof candidate.description === "string" ? candidate.description.trim() : "";
    if (candidate.labels !== undefined && !Array.isArray(candidate.labels)) return { error: "Ticket labels must be a list." };
    const labels = [...new Set((candidate.labels ?? []).map((label: unknown) => typeof label === "string" ? label.trim() : ""))].filter(Boolean);
    if (!clientId || clientId.length > 100 || clientIds.has(clientId)) return { error: "Every staged ticket must have a unique identifier." };
    if (!title) return { error: "Every staged ticket requires a title." };
    if (title.length > 255) return { error: "Ticket titles cannot exceed 255 characters." };
    if (description.length > 50_000) return { error: "Ticket descriptions cannot exceed 50,000 characters." };
    if (labels.length > 20 || labels.some((label) => label.length > 255)) return { error: "Each ticket can use at most 20 valid labels." };
    clientIds.add(clientId);
    drafts.push({ clientId, title, description, labels });
  }

  return { drafts };
}

function sameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === request.headers.get("host");
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Cross-origin ticket requests are not allowed." }, { status: 403 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "The ticket batch must be valid JSON." }, { status: 400 });
  }

  const validation = validateDrafts(body);
  if ("error" in validation) return NextResponse.json({ error: validation.error }, { status: 400 });
  const requestedProject = body && typeof body === "object" && typeof (body as { project?: unknown }).project === "string"
    ? (body as { project: string }).project.trim()
    : "";
  if (!requestedProject) return NextResponse.json({ error: "Choose one Gitlab project for this ticket batch." }, { status: 400 });

  const settings = readLocalSettings(currentGitHubViewer());
  const allowedProject = settings?.gitlabProjects.find((project) => project.toLowerCase() === requestedProject.toLowerCase()) ?? null;
  if (!allowedProject) {
    return NextResponse.json({ error: "The selected Gitlab project is not in this user's saved project allowlist." }, { status: 403 });
  }

  try {
    const preflight = await gitlabProjectPreflight(allowedProject, true);
    if (!preflight.canCreateTickets) {
      return NextResponse.json({ error: "The target project requires Developer access." }, { status: 409 });
    }
    const availableLabels = await gitlabAllPages<GitlabLabel>(`/projects/${encodeURIComponent(allowedProject)}/labels?include_ancestor_groups=true`, 10, true);
    const canonicalLabels = new Map(availableLabels.map((label) => [label.name.toLowerCase(), label.name]));
    for (const draft of validation.drafts) {
      const invalidLabel = draft.labels.find((label) => !canonicalLabels.has(label.toLowerCase()));
      if (invalidLabel) return NextResponse.json({ error: `The ${invalidLabel} label is not available in the target project.` }, { status: 409 });
      draft.labels = draft.labels.map((label) => canonicalLabels.get(label.toLowerCase())!);
    }
  } catch (error) {
    const failure = gitlabApiError(error);
    return NextResponse.json({ error: failure.message }, { status: failure.status });
  }
  const project = encodeURIComponent(allowedProject);

  const created: { clientId: string; id: number; iid: number; title: string; url: string }[] = [];
  const failed: { clientId: string; title: string; error: string }[] = [];

  for (const draft of validation.drafts) {
    try {
      const issue = await gitlabMutation<CreatedIssue>(`/projects/${project}/issues`, {
        title: draft.title,
        description: draft.description,
        ...(draft.labels.length ? { labels: draft.labels.join(",") } : {}),
        issue_type: "issue",
      });
      created.push({ clientId: draft.clientId, id: issue.id, iid: issue.iid, title: issue.title, url: issue.web_url });
    } catch (error) {
      failed.push({ clientId: draft.clientId, title: draft.title, error: gitlabApiError(error).message });
    }
  }

  return NextResponse.json({
    project: allowedProject,
    created,
    failed,
  });
}
