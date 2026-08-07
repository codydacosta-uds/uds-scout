import { NextRequest, NextResponse } from "next/server";
import { clearGitHubCache, currentGitHubViewer } from "@/lib/github";
import { readLocalSettings, writeLocalSettings } from "@/lib/local-settings";
import { isRenovateReviewDay } from "@/lib/renovate-review";

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

  const viewer = currentGitHubViewer();
  const settings = readLocalSettings(viewer);
  if (!settings) {
    return NextResponse.json({ error: "Complete workspace setup before saving preferences." }, { status: 409 });
  }

  const body = await request.json().catch(() => null) as { renovateReviewDay?: unknown } | null;
  if (!isRenovateReviewDay(body?.renovateReviewDay)) {
    return NextResponse.json({ error: "Choose a valid Renovate review schedule." }, { status: 400 });
  }

  writeLocalSettings({ ...settings, renovateReviewDay: body.renovateReviewDay }, viewer);
  clearGitHubCache();
  return NextResponse.json({ renovateReviewDay: body.renovateReviewDay });
}
