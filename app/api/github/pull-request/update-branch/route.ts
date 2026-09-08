import { NextRequest, NextResponse } from "next/server";
import { githubMutation, githubRequest, GitHubApiError } from "@/lib/github";
import { isTrackedRepository } from "@/lib/tracked-repositories";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "The update request must be valid JSON." }, { status: 400 }); }
  const value = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const repository = typeof value.repository === "string" ? value.repository.trim() : "";
  const number = typeof value.number === "number" && Number.isInteger(value.number) ? value.number : 0;
  if (!isTrackedRepository(repository) || number < 1) return NextResponse.json({ error: "Choose a tracked pull request." }, { status: 400 });
  try {
    const pull = await githubRequest<{ state?: string; merged?: boolean; base?: { ref?: string }; mergeable_state?: string }>(`/repos/${repository}/pulls/${number}`, 0);
    if (pull.state !== "open" || pull.merged || pull.base?.ref !== "main") return NextResponse.json({ error: "This pull request is no longer eligible for a main-branch update." }, { status: 409 });
    if (pull.mergeable_state !== "behind") return NextResponse.json({ error: "GitHub no longer reports this pull request as behind main." }, { status: 409 });
    await githubMutation(`/repos/${repository}/pulls/${number}/update-branch`, "PUT", { update_method: "merge" });
    return NextResponse.json({ updated: true });
  } catch (error) {
    const message = error instanceof GitHubApiError ? error.message : "GitHub could not update this pull request branch.";
    return NextResponse.json({ error: message }, { status: error instanceof GitHubApiError ? Math.max(error.status, 400) : 502 });
  }
}
