import { NextRequest, NextResponse } from "next/server";
import { apiError, clearGitHubCache, currentGitHubViewer, githubAllPages, RawRepo } from "@/lib/github";
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
  try { return new URL(origin).host === request.headers.get("host"); } catch { return false; }
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
    return NextResponse.json({ repositories: repositories.map((repository) => ({ id: repository.id, name: repository.name, fullName: repository.full_name, private: repository.private, description: repository.description, url: repository.html_url, owner: repository.owner.login, updatedAt: repository.updated_at })) });
  } catch (error) {
    const failure = apiError(error);
    return NextResponse.json({ error: failure.message }, { status: failure.status });
  }
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Cross-origin setup requests are not allowed." }, { status: 403 });
  try {
    const viewer = currentGitHubViewer();
    const existing = readLocalSettings(viewer);
    const configured = configuredRepositorySource();
    const body = await request.json() as { repositories?: unknown };
    const requested = configured.source === "environment" ? configured.repositories : Array.isArray(body.repositories) ? [...new Set(body.repositories.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))] : [];
    if (requested.length > MAX_MANAGED_REPOSITORIES) return NextResponse.json({ error: `Choose no more than ${MAX_MANAGED_REPOSITORIES} managed repositories.` }, { status: 400 });
    const available = await availableRepositories();
    const availableNames = new Map(available.map((repository) => [repository.full_name.toLowerCase(), repository.full_name]));
    const invalid = requested.filter((repository) => !availableNames.has(repository.toLowerCase()));
    if (invalid.length) return NextResponse.json({ error: "One or more selected repositories are no longer available." }, { status: 400 });
    const repositories = requested.map((repository) => availableNames.get(repository.toLowerCase())!);
    const renovateReviewDay = existing?.renovateReviewDay ?? DEFAULT_RENOVATE_REVIEW_DAY;
    const workspacePresets = existing?.workspacePresets ?? [];
    writeLocalSettings({ repositories, setupCompleted: true, gitlabEnabled: false, gitlabProjects: [], gitlabDefaultProject: null, renovateReviewDay, workspacePresets }, viewer);
    clearGitHubCache();
    return NextResponse.json({ repositories, renovateReviewDay, workspacePresets: workspacePresetsWithConfig(workspacePresets) });
  } catch (error) {
    const failure = apiError(error);
    return NextResponse.json({ error: failure.message }, { status: failure.status });
  }
}
