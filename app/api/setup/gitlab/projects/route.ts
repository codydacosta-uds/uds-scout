import { NextRequest, NextResponse } from "next/server";
import { currentGitHubViewer } from "@/lib/github";
import { gitlabAccessibleProjects, gitlabApiError, type GitlabProject, gitlabProjectPreflight } from "@/lib/gitlab";
import { readLocalSettings } from "@/lib/local-settings";

export const runtime = "nodejs";

type ProjectValidation = Awaited<ReturnType<typeof gitlabProjectPreflight>> | null;

function serializeProject(project: GitlabProject, validation: ProjectValidation) {
  const accessLevel = Math.max(project.permissions?.project_access?.access_level ?? 0, project.permissions?.group_access?.access_level ?? 0);
  return {
    id: project.id,
    name: project.name,
    fullPath: project.path_with_namespace,
    url: project.web_url,
    description: project.description,
    updatedAt: project.last_activity_at,
    canCreateTickets: validation?.canCreateTickets ?? false,
    ticketValidation: validation
      ? validation.canCreateTickets ? "Ticket creation available" : "Developer access is required for ticket creation"
      : accessLevel >= 30 ? "Ticket access is checked when settings are saved" : "Read-only project access",
  };
}

export async function GET(request: NextRequest) {
  try {
    const settings = readLocalSettings(currentGitHubViewer());
    if (settings?.gitlabEnabled === false) return NextResponse.json({ error: "Gitlab is disabled for this workspace." }, { status: 409 });
    const selectedProjects = settings?.gitlabProjects ?? [];

    if (request.nextUrl.searchParams.get("selected") === "true") {
      const validations = await Promise.all(selectedProjects.map((project) => gitlabProjectPreflight(project)));
      return NextResponse.json({
        projects: validations.map((validation) => serializeProject(validation.project, validation)),
        selectedProjects,
        defaultProject: settings?.gitlabDefaultProject ?? null,
      }, { headers: { "Cache-Control": "no-store" } });
    }

    const selected = new Set(selectedProjects.map((project) => project.toLowerCase()));
    const projects = await gitlabAccessibleProjects();
    const preflight = new Map<string, ProjectValidation>();
    const selectedCatalog = projects.filter((project) => selected.has(project.path_with_namespace.toLowerCase()));
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(5, selectedCatalog.length) }, async () => {
      while (cursor < selectedCatalog.length) {
        const project = selectedCatalog[cursor++];
        const result = await gitlabProjectPreflight(project.path_with_namespace).catch(() => null);
        preflight.set(project.path_with_namespace.toLowerCase(), result);
      }
    }));

    return NextResponse.json({
      projects: projects.map((project) => serializeProject(project, preflight.get(project.path_with_namespace.toLowerCase()) ?? null)),
      selectedProjects,
      defaultProject: settings?.gitlabDefaultProject ?? null,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const failure = gitlabApiError(error);
    return NextResponse.json({ error: failure.message }, { status: failure.status, headers: { "Cache-Control": "no-store" } });
  }
}
