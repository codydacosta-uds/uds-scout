import { NextRequest, NextResponse } from "next/server";
import { currentGitHubViewer, githubRequest } from "@/lib/github";
import { gitlabAbsoluteUrl, gitlabApiError, gitlabRequest, gitlabTokenStatus, setSessionGitlabToken, validateGitlabToken, type GitlabViewer } from "@/lib/gitlab";
import { readLocalSettings, writeLocalSettings } from "@/lib/local-settings";

export const runtime = "nodejs";

type GitHubViewer = { login: string };

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
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: "Cross-origin setup requests are not allowed." }, { status: 403 });
  }

  try {
    const body = await request.json() as { token?: unknown; useEnvironment?: unknown };
    const useEnvironment = body.useEnvironment === true;
    const token = typeof body.token === "string" ? body.token.trim() : "";
    let viewer: GitlabViewer;
    let tokenSource: "environment" | "session";

    if (useEnvironment) {
      if (gitlabTokenStatus().source !== "environment") {
        return NextResponse.json({ error: "GITLAB_TOKEN is not available in the server environment." }, { status: 409 });
      }
      viewer = await gitlabRequest<GitlabViewer>("/user", 0, true);
      tokenSource = "environment";
    } else {
      if (!token || token.length > 500) {
        return NextResponse.json({ error: "Enter a valid Gitlab token." }, { status: 400 });
      }
      viewer = await validateGitlabToken(token);
      setSessionGitlabToken(token, viewer.username);
      tokenSource = "session";
    }

    const githubViewer = currentGitHubViewer() ?? (await githubRequest<GitHubViewer>("/user", 0).catch(() => null))?.login ?? null;
    const settings = readLocalSettings(githubViewer);
    if (settings) writeLocalSettings({ ...settings, gitlabEnabled: true }, githubViewer);

    return NextResponse.json({
      tokenSource,
      viewer: {
        username: viewer.username,
        name: viewer.name,
        avatar: gitlabAbsoluteUrl(viewer.avatar_url),
        url: viewer.web_url,
      },
    });
  } catch (error) {
    const failure = gitlabApiError(error);
    return NextResponse.json({ error: failure.message }, { status: failure.status });
  }
}
