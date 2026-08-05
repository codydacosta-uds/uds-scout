import { NextResponse } from "next/server";
import { githubRequest, githubTokenStatus } from "@/lib/github";
import { configuredRepositorySource } from "@/lib/tracked-repositories";

export const runtime = "nodejs";

type GitHubViewer = { login: string; name: string | null; avatar_url: string; html_url: string };

export async function GET() {
  const token = githubTokenStatus();
  const repositories = configuredRepositorySource();
  const viewer = token.configured
    ? await githubRequest<GitHubViewer>("/user", 5 * 60_000).catch(() => null)
    : null;
  const configured = token.configured && Boolean(viewer) && repositories.repositories.length > 0 && repositories.setupCompleted;

  return NextResponse.json({
    configured,
    hasToken: token.configured,
    tokenSource: token.source,
    repositorySource: repositories.source,
    repositories: repositories.repositories,
    viewer: viewer ? { login: viewer.login, name: viewer.name, avatar: viewer.avatar_url, url: viewer.html_url } : null,
  });
}
