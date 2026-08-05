import { NextRequest, NextResponse } from "next/server";
import {
  apiError,
  githubAllPages,
  githubRequest,
  presentPull,
  presentRepo,
  RawPull,
  RawRepo,
  RawRun,
} from "@/lib/github";
import { isTrackedRepository } from "@/lib/tracked-repositories";

export const runtime = "nodejs";

type RunsResponse = { total_count: number; workflow_runs: RawRun[] };
type RawIssue = {
  id: number;
  number: number;
  title: string;
  html_url: string;
  user: { login: string } | null;
  created_at: string;
  updated_at: string;
  labels: ({ name?: string; color?: string } | string)[];
  pull_request?: unknown;
};

function validRepository(value: string) {
  return /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(value);
}

export async function GET(request: NextRequest) {
  const repository = request.nextUrl.searchParams.get("repo") ?? "";
  if (!validRepository(repository)) {
    return NextResponse.json({ error: "Use an owner/repository name." }, { status: 400 });
  }
  if (!isTrackedRepository(repository)) {
    return NextResponse.json({ error: "That repository is not in the tracked workspace." }, { status: 403 });
  }

  try {
    const [details, openPulls, closedPulls, runsResult, issueResults] = await Promise.all([
      githubRequest<RawRepo>(`/repos/${repository}`),
      githubAllPages<RawPull>(`/repos/${repository}/pulls?state=open&sort=updated&direction=desc`, 10),
      githubAllPages<RawPull>(`/repos/${repository}/pulls?state=closed&sort=updated&direction=desc`, 20),
      githubRequest<RunsResponse>(`/repos/${repository}/actions/runs?per_page=30`).catch(() => null),
      githubAllPages<RawIssue>(`/repos/${repository}/issues?state=open&sort=updated&direction=desc`, 10).catch(() => []),
    ]);

    const merged = closedPulls.filter((pull) => pull.merged_at);
    return NextResponse.json({
      repository: presentRepo(details),
      pullStats: {
        open: openPulls.length,
        draft: openPulls.filter((pull) => pull.draft).length,
        closed: closedPulls.length,
        merged: merged.length,
      },
      pulls: {
        open: openPulls.slice(0, 50).map(presentPull),
        closed: closedPulls.slice(0, 50).map(presentPull),
      },
      issues: issueResults
        .filter((issue) => !issue.pull_request)
        .map((issue) => ({
          id: issue.id,
          number: issue.number,
          title: issue.title,
          url: issue.html_url,
          author: issue.user?.login ?? "ghost",
          createdAt: issue.created_at,
          updatedAt: issue.updated_at,
          labels: issue.labels
            .filter((label): label is { name?: string; color?: string } => typeof label !== "string")
            .map((label) => ({ name: label.name ?? "label", color: label.color ?? "6b7280" })),
        })),
      actions: runsResult
        ? {
            total: runsResult.total_count,
            runs: runsResult.workflow_runs.map((run) => ({
              id: run.id,
              name: run.name,
              title: run.display_title,
              url: run.html_url,
              status: run.status,
              conclusion: run.conclusion,
              event: run.event,
              number: run.run_number,
              branch: run.head_branch,
              createdAt: run.created_at,
              updatedAt: run.updated_at,
              actor: run.actor?.login ?? "system",
              actorAvatar: run.actor?.avatar_url ?? null,
            })),
          }
        : null,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    const failure = apiError(error);
    return NextResponse.json({ error: failure.message }, { status: failure.status });
  }
}
