import { NextRequest, NextResponse } from "next/server";
import { apiError, githubRequest, githubWorkflowRerun, type RawRun } from "@/lib/github";
import { isTrackedRepository } from "@/lib/tracked-repositories";

export const runtime = "nodejs";

type RerunScope = "job" | "workflow";

type RawJob = {
  id: number;
  run_url: string;
  status: string;
  conclusion: string | null;
};

function sameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === request.headers.get("host");
  } catch {
    return false;
  }
}

function validRepository(value: string) {
  return /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(value);
}

function failed(conclusion: string | null) {
  return ["failure", "timed_out", "action_required", "startup_failure", "cancelled"].includes(conclusion ?? "");
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: "Cross-origin workflow requests are not allowed." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "The re-run request must be valid JSON." }, { status: 400 });
  }

  const candidate = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const repository = typeof candidate.repository === "string" ? candidate.repository.trim() : "";
  const runId = typeof candidate.runId === "number" && Number.isSafeInteger(candidate.runId) ? candidate.runId : 0;
  const jobId = typeof candidate.jobId === "number" && Number.isSafeInteger(candidate.jobId) ? candidate.jobId : 0;
  const scope = candidate.scope as RerunScope;

  if (!validRepository(repository) || runId <= 0 || !["job", "workflow"].includes(scope) || (scope === "job" && jobId <= 0)) {
    return NextResponse.json({ error: "Choose a valid tracked repository, workflow run, and re-run scope." }, { status: 400 });
  }
  if (!isTrackedRepository(repository)) {
    return NextResponse.json({ error: "That repository is not in the tracked workspace." }, { status: 403 });
  }

  try {
    const run = await githubRequest<RawRun>(`/repos/${repository}/actions/runs/${runId}`, 0);
    if (run.id !== runId || run.status !== "completed" || !failed(run.conclusion)) {
      return NextResponse.json({ error: "Only a completed failed or cancelled workflow run can be re-run." }, { status: 409 });
    }

    if (scope === "job") {
      const job = await githubRequest<RawJob>(`/repos/${repository}/actions/jobs/${jobId}`, 0);
      const jobRunId = Number(job.run_url.match(/\/actions\/runs\/(\d+)$/)?.[1] ?? 0);
      if (job.id !== jobId || jobRunId !== runId || job.status !== "completed" || !failed(job.conclusion)) {
        return NextResponse.json({ error: "The selected job is not a completed failure in this workflow run." }, { status: 409 });
      }
    }

    await githubWorkflowRerun(repository, runId, scope === "job" ? jobId : undefined);
    return NextResponse.json({ accepted: true, scope });
  } catch (error) {
    const detail = apiError(error);
    const message = detail.status === 403
      ? "GitHub did not allow this re-run. The token needs Actions write permission for this repository."
      : detail.message;
    return NextResponse.json({ error: message }, { status: detail.status });
  }
}
