import { NextRequest, NextResponse } from "next/server";
import { currentGitHubViewer } from "@/lib/github";
import { gitlabAllPages, gitlabApiError, gitlabProjectPreflight } from "@/lib/gitlab";
import { readLocalSettings } from "@/lib/local-settings";

export const runtime = "nodejs";

type GitlabLabel = {
  id: number;
  name: string;
  color: string;
  description: string | null;
};

export async function GET(request: NextRequest) {
  const requestedProject = request.nextUrl.searchParams.get("project")?.trim() ?? "";
  if (!requestedProject) return NextResponse.json({ error: "Choose a Gitlab project before loading labels." }, { status: 400 });

  const settings = readLocalSettings(currentGitHubViewer());
  const project = settings?.gitlabProjects.find((candidate) => candidate.toLowerCase() === requestedProject.toLowerCase()) ?? null;
  if (!project) return NextResponse.json({ error: "The selected Gitlab project is not in this user's saved project allowlist." }, { status: 403 });

  try {
    const preflight = await gitlabProjectPreflight(project);
    if (!preflight.canCreateTickets) {
      return NextResponse.json({ error: "Developer access is required to create tickets in this project." }, { status: 409 });
    }
    const labels = await gitlabAllPages<GitlabLabel>(`/projects/${encodeURIComponent(project)}/labels?include_ancestor_groups=true`, 10, true);
    return NextResponse.json({
      project,
      labels: labels
        .map((label) => ({ name: label.name, color: label.color, description: label.description }))
        .sort((left, right) => left.name.localeCompare(right.name)),
    });
  } catch (error) {
    const failure = gitlabApiError(error);
    return NextResponse.json({ error: failure.message }, { status: failure.status });
  }
}
