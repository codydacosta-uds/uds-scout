import { NextResponse } from "next/server";
import { githubRequest, githubTokenStatus } from "@/lib/github";
import { readLocalSettings } from "@/lib/local-settings";
import { DEFAULT_RENOVATE_REVIEW_DAY } from "@/lib/renovate-review";
import { workspacePresetsWithConfig } from "@/lib/repository-constants";
import { configuredRepositorySource } from "@/lib/tracked-repositories";

export const runtime = "nodejs";
type GitHubViewer = { login: string; name: string | null; avatar_url: string; html_url: string };

export async function GET() {
  const token = githubTokenStatus();
  const viewer = token.configured ? await githubRequest<GitHubViewer>("/user", 5 * 60_000).catch(() => null) : null;
  const repositories = configuredRepositorySource();
  const settings = readLocalSettings(viewer?.login);
  const configured = token.configured && Boolean(viewer) && repositories.setupCompleted;
  return NextResponse.json({
    configured, hasToken: token.configured, tokenSource: token.source, repositorySource: repositories.source,
    repositories: repositories.repositories,
    viewer: viewer ? { login: viewer.login, name: viewer.name, avatar: viewer.avatar_url, url: viewer.html_url } : null,
    renovateReviewDay: settings?.renovateReviewDay ?? DEFAULT_RENOVATE_REVIEW_DAY,
    workspacePresets: workspacePresetsWithConfig(settings?.workspacePresets),
    gitlab: { hasToken: false, tokenSource: null, environmentAvailable: false, viewer: null, projects: [], defaultProject: null },
  });
}
