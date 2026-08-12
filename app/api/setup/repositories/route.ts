import { NextRequest, NextResponse } from "next/server";
import { apiError, clearGitHubCache, currentGitHubViewer, githubAllPages, RawRepo } from "@/lib/github";
import { gitlabAccessibleProjects, gitlabApiError, GitLabApiError, gitlabProjectPreflight, gitlabTokenStatus } from "@/lib/gitlab";
import { readLocalSettings, writeLocalSettings } from "@/lib/local-settings";
import { DEFAULT_RENOVATE_REVIEW_DAY } from "@/lib/renovate-review";
import { workspacePresetsWithConfig } from "@/lib/repository-constants";
import { configuredRepositorySource } from "@/lib/tracked-repositories";

export const runtime = "nodejs";

const MAX_MANAGED_REPOSITORIES = 25;
const REPOSITORIES_PATH = "/user/repos?affiliation=owner,collaborator,organization_member&sort=updated&direction=desc";

function sameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === request.headers.get("host");
  } catch {
    return false;
  }
}

async function availableRepositories() {
  const [affiliated, udsPackages] = await Promise.all([
    githubAllPages<RawRepo>(REPOSITORIES_PATH, 20),
    githubAllPages<RawRepo>("/orgs/uds-packages/repos?type=all&sort=updated&direction=desc", 10).catch(() => []),
  ]);
  return [...new Map([...affiliated, ...udsPackages].map((repository) => [repository.full_name.toLowerCase(), repository])).values()];
}

export async function GET() {
  try {
    const repositories = await availableRepositories();
    return NextResponse.json({
      repositories: repositories.map((repository) => ({
        id: repository.id,
        name: repository.name,
        fullName: repository.full_name,
        private: repository.private,
        description: repository.description,
        url: repository.html_url,
        owner: repository.owner.login,
        updatedAt: repository.updated_at,
      })),
    });
  } catch (error) {
    const failure = apiError(error);
    return NextResponse.json({ error: failure.message }, { status: failure.status });
  }
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: "Cross-origin setup requests are not allowed." }, { status: 403 });
  }
  try {
    const viewer = currentGitHubViewer();
    const existing = readLocalSettings(viewer);
    const configured = configuredRepositorySource();
    const body = await request.json() as { repositories?: unknown; gitlabEnabled?: unknown; gitlabProjects?: unknown; gitlabDefaultProject?: unknown };
    const requested = configured.source === "environment"
      ? configured.repositories
      : Array.isArray(body.repositories)
        ? [...new Set(body.repositories.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))]
        : [];
    if (requested.length > MAX_MANAGED_REPOSITORIES) {
      return NextResponse.json({ error: `Choose no more than ${MAX_MANAGED_REPOSITORIES} managed repositories.` }, { status: 400 });
    }

    const available = await availableRepositories();
    const availableNames = new Map(available.map((repository) => [repository.full_name.toLowerCase(), repository.full_name]));
    const invalid = requested.filter((repository) => !availableNames.has(repository.toLowerCase()));
    if (invalid.length) {
      return NextResponse.json({ error: "One or more selected repositories are no longer available." }, { status: 400 });
    }

    const repositories = requested.map((repository) => availableNames.get(repository.toLowerCase())!);
    const requestedGitlabProjects = Array.isArray(body.gitlabProjects)
      ? [...new Set(body.gitlabProjects.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))]
      : existing?.gitlabProjects ?? [];
    if (requestedGitlabProjects.length > 50) {
      return NextResponse.json({ error: "Choose no more than 50 Gitlab projects." }, { status: 400 });
    }
    const requestedDefault = typeof body.gitlabDefaultProject === "string"
      ? body.gitlabDefaultProject.trim() || null
      : body.gitlabDefaultProject === null
        ? null
        : existing?.gitlabDefaultProject ?? null;
    if (requestedDefault && !requestedGitlabProjects.some((project) => project.toLowerCase() === requestedDefault.toLowerCase())) {
      return NextResponse.json({ error: "The default ticket project must be selected for Gitlab work items." }, { status: 400 });
    }

    let gitlabProjects: string[] = [];
    let gitlabDefaultProject: string | null = null;
    if (requestedGitlabProjects.length || requestedDefault) {
      if (!gitlabTokenStatus().configured) {
        return NextResponse.json({ error: "Connect a Gitlab token before selecting Gitlab projects." }, { status: 400 });
      }
      const availableGitlabProjects = await gitlabAccessibleProjects();
      const availableGitlabNames = new Map(availableGitlabProjects.map((project) => [project.path_with_namespace.toLowerCase(), project.path_with_namespace]));
      const invalidGitlabProjects = requestedGitlabProjects.filter((project) => !availableGitlabNames.has(project.toLowerCase()));
      if (invalidGitlabProjects.length) {
        return NextResponse.json({ error: "One or more selected Gitlab projects are no longer accessible." }, { status: 400 });
      }
      gitlabProjects = requestedGitlabProjects.map((project) => availableGitlabNames.get(project.toLowerCase())!);
      const projectValidation = new Map<string, Awaited<ReturnType<typeof gitlabProjectPreflight>> | null>();
      let validationCursor = 0;
      await Promise.all(Array.from({ length: Math.min(5, gitlabProjects.length) }, async () => {
        while (validationCursor < gitlabProjects.length) {
          const project = gitlabProjects[validationCursor++];
          const validation = await gitlabProjectPreflight(project, true).catch(() => null);
          projectValidation.set(project.toLowerCase(), validation);
        }
      }));
      const unreadableProject = gitlabProjects.find((project) => !projectValidation.get(project.toLowerCase())?.canReadWorkItems);
      if (unreadableProject) {
        return NextResponse.json({ error: `Gitlab could not validate work-item access for ${unreadableProject}.` }, { status: 409 });
      }
      if (requestedDefault) {
        gitlabDefaultProject = availableGitlabNames.get(requestedDefault.toLowerCase()) ?? null;
        const preflight = gitlabDefaultProject ? projectValidation.get(gitlabDefaultProject.toLowerCase()) : null;
        if (!preflight?.canCreateTickets) {
          return NextResponse.json({ error: "The default Gitlab project requires Developer access before it can receive tickets." }, { status: 409 });
        }
      }
    }

    const renovateReviewDay = existing?.renovateReviewDay ?? DEFAULT_RENOVATE_REVIEW_DAY;
    const workspacePresets = existing?.workspacePresets ?? [];
    const gitlabEnabled = typeof body.gitlabEnabled === "boolean" ? body.gitlabEnabled : existing?.gitlabEnabled ?? true;
    writeLocalSettings({ repositories, setupCompleted: true, gitlabEnabled, gitlabProjects, gitlabDefaultProject, renovateReviewDay, workspacePresets }, viewer);
    clearGitHubCache();
    return NextResponse.json({ repositories, gitlabProjects, gitlabDefaultProject, renovateReviewDay, workspacePresets: workspacePresetsWithConfig(workspacePresets) });
  } catch (error) {
    const failure = error instanceof GitLabApiError ? gitlabApiError(error) : apiError(error);
    return NextResponse.json({ error: failure.message }, { status: failure.status });
  }
}
