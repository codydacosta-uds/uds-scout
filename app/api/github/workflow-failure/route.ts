import { NextRequest, NextResponse } from "next/server";
import { apiError, githubRequest, type RawRun } from "@/lib/github";
import { isTrackedRepository } from "@/lib/tracked-repositories";
import type { PipelineFailureDetail } from "@/components/workflow-notes-types";

export const runtime = "nodejs";

type RawJobStep = {
  number: number;
  name: string;
  status: string;
  conclusion: string | null;
};

type RawJob = {
  id: number;
  name: string;
  html_url: string;
  status: string;
  conclusion: string | null;
  steps?: RawJobStep[];
};

type JobsResponse = {
  jobs: RawJob[];
};

function validRepository(value: string) {
  return /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(value);
}

function failed(conclusion: string | null) {
  return ["failure", "timed_out", "action_required", "startup_failure", "cancelled"].includes(conclusion ?? "");
}

export async function GET(request: NextRequest) {
  const repository = request.nextUrl.searchParams.get("repository") ?? "";
  const runId = request.nextUrl.searchParams.get("run") ?? "";
  if (!validRepository(repository) || !/^\d+$/.test(runId)) {
    return NextResponse.json({ error: "Choose a valid tracked repository and workflow run." }, { status: 400 });
  }
  if (!isTrackedRepository(repository)) {
    return NextResponse.json({ error: "That repository is not in the tracked workspace." }, { status: 403 });
  }

  try {
    const [run, jobs] = await Promise.all([
      githubRequest<RawRun>(`/repos/${repository}/actions/runs/${runId}`, 60_000),
      githubRequest<JobsResponse>(`/repos/${repository}/actions/runs/${runId}/jobs?filter=latest&per_page=100`, 60_000),
    ]);
    const response: PipelineFailureDetail = {
      run: {
        id: run.id,
        name: run.name,
        title: run.display_title,
        url: run.html_url,
        status: run.status,
        conclusion: run.conclusion,
        branch: run.head_branch,
        updatedAt: run.updated_at,
      },
      jobs: jobs.jobs.filter((job) => failed(job.conclusion)).map((job) => ({
        id: job.id,
        name: job.name,
        url: job.html_url,
        status: job.status,
        conclusion: job.conclusion,
        failedSteps: (job.steps ?? []).filter((step) => failed(step.conclusion)).map((step) => ({
          number: step.number,
          name: step.name,
          status: step.status,
          conclusion: step.conclusion,
        })),
      })),
    };
    return NextResponse.json(response);
  } catch (error) {
    const detail = apiError(error);
    return NextResponse.json({ error: detail.message }, { status: detail.status });
  }
}
