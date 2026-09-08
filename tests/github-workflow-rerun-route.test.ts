import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  apiError: vi.fn(),
  request: vi.fn(),
  rerun: vi.fn(),
  tracked: vi.fn(),
}));

vi.mock("@/lib/github", () => ({
  apiError: mocks.apiError,
  githubRequest: mocks.request,
  githubWorkflowRerun: mocks.rerun,
}));
vi.mock("@/lib/tracked-repositories", () => ({ isTrackedRepository: mocks.tracked }));

import { GET, POST } from "@/app/api/github/workflow-rerun/route";

const repository = "uds-packages/jenkins";
const run = { id: 123, status: "completed", conclusion: "failure" };
const job = {
  id: 456,
  run_url: `https://api.github.com/repos/${repository}/actions/runs/123`,
  status: "completed",
  conclusion: "failure",
};

function request(body: unknown, origin = "http://127.0.0.1:3001") {
  return new NextRequest("http://127.0.0.1:3001/api/github/workflow-rerun", {
    method: "POST",
    headers: { "content-type": "application/json", host: "127.0.0.1:3001", origin },
    body: JSON.stringify(body),
  });
}

describe("GitHub workflow re-run route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tracked.mockReset().mockReturnValue(true);
    mocks.request.mockReset().mockResolvedValueOnce(run).mockResolvedValueOnce(job);
    mocks.rerun.mockReset().mockResolvedValue(undefined);
    mocks.apiError.mockReset().mockImplementation((error: unknown) => ({ message: error instanceof Error ? error.message : "failed", status: 502 }));
  });

  it("rejects cross-origin and untracked repository mutations", async () => {
    expect((await POST(request({ repository, runId: 123, scope: "workflow" }, "https://attacker.example"))).status).toBe(403);
    mocks.tracked.mockReturnValueOnce(false);
    expect((await POST(request({ repository, runId: 123, scope: "workflow" }))).status).toBe(403);
    expect(mocks.request).not.toHaveBeenCalled();
    expect(mocks.rerun).not.toHaveBeenCalled();
  });

  it("requires fixed workflow or job scopes with numeric identifiers", async () => {
    expect((await POST(request({ repository, runId: 123, scope: "command", command: "anything" }))).status).toBe(400);
    expect((await POST(request({ repository, runId: 123, scope: "job" }))).status).toBe(400);
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it("re-runs a completed failed workflow", async () => {
    const response = await POST(request({ repository, runId: 123, scope: "workflow" }));
    expect(response.status).toBe(200);
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(mocks.rerun).toHaveBeenCalledWith(repository, 123, undefined);
    expect(await response.json()).toEqual({ accepted: true, scope: "workflow", previousAttempt: 1 });
  });

  it("rejects invalid and untracked workflow status polling", async () => {
    const invalid = await GET(new NextRequest("http://127.0.0.1:3001/api/github/workflow-rerun?repository=invalid&run=nope"));
    expect(invalid.status).toBe(400);
    expect(mocks.request).not.toHaveBeenCalled();

    mocks.tracked.mockReturnValueOnce(false);
    const untracked = await GET(new NextRequest(`http://127.0.0.1:3001/api/github/workflow-rerun?repository=${repository}&run=123`));
    expect(untracked.status).toBe(403);
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it("reports GitHub errors while polling workflow status", async () => {
    mocks.request.mockReset().mockRejectedValueOnce(new Error("unavailable"));
    mocks.apiError.mockReturnValueOnce({ message: "GitHub API unavailable", status: 502 });
    const response = await GET(new NextRequest(`http://127.0.0.1:3001/api/github/workflow-rerun?repository=${repository}&run=123`));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "GitHub API unavailable" });
  });

  it("returns fresh workflow and latest-job status for automatic polling", async () => {
    mocks.request.mockReset()
      .mockResolvedValueOnce({ ...run, status: "in_progress", conclusion: null, run_attempt: 2, updated_at: "2026-09-08T18:00:00Z", html_url: "https://github.com/example/run" })
      .mockResolvedValueOnce({ jobs: [{ ...job, name: "verify-test", html_url: "https://github.com/example/job", status: "in_progress", conclusion: null }] });
    const response = await GET(new NextRequest(`http://127.0.0.1:3001/api/github/workflow-rerun?repository=${repository}&run=123`));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ run: { id: 123, status: "in_progress", runAttempt: 2 }, jobs: [{ id: 456, name: "verify-test", status: "in_progress" }] });
  });

  it("verifies that a failed job belongs to the requested run before re-running it", async () => {
    const response = await POST(request({ repository, runId: 123, jobId: 456, scope: "job" }));
    expect(response.status).toBe(200);
    expect(mocks.rerun).toHaveBeenCalledWith(repository, 123, 456);

    vi.clearAllMocks();
    mocks.tracked.mockReturnValue(true);
    mocks.request.mockResolvedValueOnce(run).mockResolvedValueOnce({ ...job, run_url: `https://api.github.com/repos/${repository}/actions/runs/999` });
    const denied = await POST(request({ repository, runId: 123, jobId: 456, scope: "job" }));
    expect(denied.status).toBe(409);
    expect(mocks.rerun).not.toHaveBeenCalled();
  });

  it("refuses runs that are no longer completed failures", async () => {
    mocks.request.mockReset().mockResolvedValueOnce({ ...run, status: "in_progress", conclusion: null });
    const response = await POST(request({ repository, runId: 123, scope: "workflow" }));
    expect(response.status).toBe(409);
    expect(mocks.rerun).not.toHaveBeenCalled();
  });

  it("explains missing GitHub Actions write permission", async () => {
    mocks.rerun.mockRejectedValueOnce(new Error("forbidden"));
    mocks.apiError.mockReturnValueOnce({ message: "GitHub API: Forbidden", status: 403 });
    const response = await POST(request({ repository, runId: 123, scope: "workflow" }));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: expect.stringMatching(/Actions write permission/) });
  });
});
