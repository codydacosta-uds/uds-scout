import { NextRequest, NextResponse } from "next/server";
import { clearSessionGitHubToken, githubTokenStatus } from "@/lib/github";
import { clearSecurityRegistryTokenCache } from "@/lib/security-oci";

export const runtime = "nodejs";
function sameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try { return new URL(origin).host === request.headers.get("host"); } catch { return false; }
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Cross-origin setup requests are not allowed." }, { status: 403 });
  const body = await request.json().catch(() => null) as { provider?: unknown } | null;
  if (body?.provider !== "github") return NextResponse.json({ error: "GitHub is the only supported account." }, { status: 400 });
  const status = githubTokenStatus();
  if (status.source === "environment") return NextResponse.json({ error: "GitHub is configured by an environment variable. Remove it and restart Scout to disconnect." }, { status: 409 });
  clearSessionGitHubToken();
  clearSecurityRegistryTokenCache();
  return NextResponse.json({ disconnected: "github" });
}
