import { NextResponse } from "next/server";
import { githubRequest, githubTokenStatus } from "@/lib/github";
import { gitlabAbsoluteUrl, gitlabRequest, gitlabTokenStatus, type GitlabViewer } from "@/lib/gitlab";
import { readLocalSettings } from "@/lib/local-settings";
import { configuredRepositorySource } from "@/lib/tracked-repositories";

export const runtime = "nodejs";

type GitHubViewer = { login: string; name: string | null; avatar_url: string; html_url: string };

export async function GET() {
  const token = githubTokenStatus();
  const viewer = token.configured
    ? await githubRequest<GitHubViewer>("/user", 5 * 60_000).catch(() => null)
    : null;
  const repositories = configuredRepositorySource();
  const gitlabToken = gitlabTokenStatus();
  const gitlabViewer = gitlabToken.configured
    ? await gitlabRequest<GitlabViewer>("/user", 5 * 60_000).catch(() => null)
    : null;
  const settings = readLocalSettings(viewer?.login);
  const configured = token.configured && Boolean(viewer) && repositories.setupCompleted;

  return NextResponse.json({
    configured,
    hasToken: token.configured,
    tokenSource: token.source,
    repositorySource: repositories.source,
    repositories: repositories.repositories,
    viewer: viewer ? { login: viewer.login, name: viewer.name, avatar: viewer.avatar_url, url: viewer.html_url } : null,
    gitlab: {
      hasToken: gitlabToken.configured && Boolean(gitlabViewer),
      tokenSource: gitlabToken.source,
      viewer: gitlabViewer ? { username: gitlabViewer.username, name: gitlabViewer.name, avatar: gitlabAbsoluteUrl(gitlabViewer.avatar_url), url: gitlabViewer.web_url } : null,
      projects: settings?.gitlabProjects ?? [],
      defaultProject: settings?.gitlabDefaultProject ?? null,
    },
  });
}
