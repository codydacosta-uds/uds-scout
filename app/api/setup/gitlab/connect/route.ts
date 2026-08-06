import { NextRequest, NextResponse } from "next/server";
import { gitlabAbsoluteUrl, gitlabApiError, setSessionGitlabToken, validateGitlabToken } from "@/lib/gitlab";

export const runtime = "nodejs";

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
    const body = await request.json() as { token?: unknown };
    const token = typeof body.token === "string" ? body.token.trim() : "";
    if (!token || token.length > 500) {
      return NextResponse.json({ error: "Enter a valid Gitlab token." }, { status: 400 });
    }

    const viewer = await validateGitlabToken(token);
    setSessionGitlabToken(token, viewer.username);
    return NextResponse.json({
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
