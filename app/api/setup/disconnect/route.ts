import { NextRequest, NextResponse } from "next/server";
import { clearSessionGitHubToken, currentGitHubViewer, githubRequest, githubTokenStatus } from "@/lib/github";
import { clearSessionGitlabToken, gitlabTokenStatus } from "@/lib/gitlab";
import { readLocalSettings, writeLocalSettings } from "@/lib/local-settings";

export const runtime = "nodejs";

type GitHubViewer = { login: string };
type Provider = "github" | "gitlab";

function sameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === request.headers.get("host");
  } catch {
    return false;
  }
}

async function githubViewer() {
  const current = currentGitHubViewer();
  if (current) return current;
  if (!githubTokenStatus().configured) return null;
  return (await githubRequest<GitHubViewer>("/user", 0).catch(() => null))?.login ?? null;
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Cross-origin setup requests are not allowed." }, { status: 403 });

  const body = await request.json().catch(() => null) as { provider?: unknown } | null;
  const provider = body?.provider as Provider | undefined;
  if (provider !== "github" && provider !== "gitlab") {
    return NextResponse.json({ error: "Choose a supported account to disconnect." }, { status: 400 });
  }

  if (provider === "github") {
    const status = githubTokenStatus();
    if (status.source === "environment") {
      return NextResponse.json({ error: "GitHub is configured by an environment variable. Remove it and restart Scout to disconnect." }, { status: 409 });
    }
    clearSessionGitHubToken();
    clearSessionGitlabToken();
    return NextResponse.json({ disconnected: "github" });
  }

  const status = gitlabTokenStatus();
  const viewer = await githubViewer();
  const settings = readLocalSettings(viewer);
  if (settings) {
    writeLocalSettings({ ...settings, gitlabEnabled: false, gitlabProjects: [], gitlabDefaultProject: null }, viewer);
  }
  clearSessionGitlabToken();
  return NextResponse.json({ disconnected: "gitlab", environmentAvailable: status.source === "environment" });
}
