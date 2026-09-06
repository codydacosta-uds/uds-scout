import { NextRequest, NextResponse } from "next/server";
import { clearSessionGitHubToken, githubRequest, githubTokenStatus } from "@/lib/github";
import { resetLocalSettings } from "@/lib/local-settings";
import { clearSecurityRegistryTokenCache } from "@/lib/security-oci";

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
  if (!sameOrigin(request)) return NextResponse.json({ error: "Cross-origin setup requests are not allowed." }, { status: 403 });

  const tokenStatus = githubTokenStatus();
  const viewer = tokenStatus.configured
    ? await githubRequest<GitHubViewer>("/user", 0).catch(() => null)
    : null;

  resetLocalSettings(viewer?.login);
  clearSessionGitHubToken();
  clearSecurityRegistryTokenCache();

  return NextResponse.json({
    reset: true,
    environmentTokensRemain: Boolean(process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN),
  });
}
