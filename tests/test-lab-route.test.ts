import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  isManaged: vi.fn(),
  prepare: vi.fn(),
  reset: vi.fn(),
  cleanup: vi.fn(),
  deploy: vi.fn(),
  branches: vi.fn(),
  catalog: vi.fn(),
  images: vi.fn(),
  plan: vi.fn(),
  session: vi.fn(),
}));

vi.mock("@/lib/repository-constants", () => ({ TEST_LAB_ENABLED: true }));
vi.mock("@/lib/test-lab", () => ({
  isManagedTestRepository: mocks.isManaged,
  prepareTestLabSession: mocks.prepare,
  resetTestLabSession: mocks.reset,
  startTestLabCleanup: mocks.cleanup,
  startTestLabDeployment: mocks.deploy,
  testLabBranches: mocks.branches,
  testLabCatalog: mocks.catalog,
  testLabImages: mocks.images,
  testLabPlan: mocks.plan,
  testLabSession: mocks.session,
}));

import { GET, POST } from "@/app/api/test-lab/route";

const plan = {
  repository: "uds-packages/jenkins",
  branch: "main",
  sha: "a".repeat(40),
  flavors: ["amd64"],
  deployOnly: { safe: true, blockers: [] },
  workflow: { safe: true, blockers: [] },
  bundle: { name: "jenkins", version: "1.0.0" },
};

function post(body: unknown, origin = "http://127.0.0.1:3001") {
  return new NextRequest("http://127.0.0.1:3001/api/test-lab", {
    method: "POST",
    headers: { "content-type": "application/json", host: "127.0.0.1:3001", origin },
    body: JSON.stringify(body),
  });
}

function get(query = "") {
  return new NextRequest(`http://127.0.0.1:3001/api/test-lab${query}`);
}

describe("Test Lab API boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isManaged.mockReturnValue(true);
    mocks.plan.mockResolvedValue(plan);
    mocks.session.mockResolvedValue({ clusterReachable: true, state: "idle" });
    mocks.deploy.mockResolvedValue({ state: "deploying" });
    mocks.prepare.mockResolvedValue({ state: "prepared" });
    mocks.catalog.mockReturnValue({ repositories: [] });
  });

  it("serves catalog data and blocks unmanaged repository details", async () => {
    expect((await GET(get())).status).toBe(200);
    mocks.isManaged.mockReturnValueOnce(false);
    expect((await GET(get("?repository=attacker/repo"))).status).toBe(403);
    expect(mocks.branches).not.toHaveBeenCalled();
  });

  it("accepts mutations only from loopback application origins", async () => {
    const response = await POST(post({ action: "cleanup" }, "https://example.com"));
    expect(response.status).toBe(403);
    expect(mocks.cleanup).not.toHaveBeenCalled();
  });

  it("refuses to create a cluster when the authoritative cluster is unreachable", async () => {
    mocks.session.mockResolvedValueOnce({ clusterReachable: false, state: "idle" });
    const response = await POST(post({ action: "run-test", repository: plan.repository, branch: "main", workflow: "build-deploy-test", flavor: "amd64" }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: expect.stringMatching(/will not create a cluster/i) });
    expect(mocks.prepare).not.toHaveBeenCalled();
  });

  it("requires an allowlisted workflow and exact declared flavor", async () => {
    const invalidWorkflow = await POST(post({ action: "run-test", repository: plan.repository, branch: "main", workflow: "arbitrary", flavor: "amd64" }));
    expect(invalidWorkflow.status).toBe(400);

    const invalidFlavor = await POST(post({ action: "run-test", repository: plan.repository, branch: "main", workflow: "build-deploy-test", flavor: "fips" }));
    expect(invalidFlavor.status).toBe(400);
    expect(mocks.prepare).not.toHaveBeenCalled();
  });

  it("passes the validated SHA-bound plan and flavor to preparation", async () => {
    const response = await POST(post({ action: "run-test", repository: plan.repository, branch: "main", workflow: "build-deploy-test", flavor: "amd64" }));
    expect(response.status).toBe(200);
    expect(mocks.prepare).toHaveBeenCalledWith(plan, "build-deploy-test", "amd64");
    expect(mocks.deploy).toHaveBeenCalledTimes(1);
  });

  it("does not prepare a workflow marked unsafe by server validation", async () => {
    mocks.plan.mockResolvedValueOnce({ ...plan, workflow: { safe: false, blockers: ["Unsafe task."] } });
    const response = await POST(post({ action: "run-test", repository: plan.repository, branch: "main", workflow: "build-deploy-test", flavor: "amd64" }));
    expect(response.status).toBe(409);
    expect(mocks.prepare).not.toHaveBeenCalled();
  });

  it("exposes status and images through explicit read-only queries", async () => {
    mocks.images.mockResolvedValueOnce({ items: [] });
    expect((await GET(get("?status=true"))).status).toBe(200);
    expect((await GET(get("?images=true"))).status).toBe(200);
    expect(mocks.session).toHaveBeenCalledTimes(1);
    expect(mocks.images).toHaveBeenCalledTimes(1);
  });

  it("dispatches only the fixed cleanup and reset actions", async () => {
    mocks.cleanup.mockResolvedValueOnce({ state: "cleaning" });
    mocks.reset.mockResolvedValueOnce({ state: "complete" });
    expect((await POST(post({ action: "cleanup" }))).status).toBe(200);
    expect((await POST(post({ action: "reset" }))).status).toBe(200);
    expect((await POST(post({ action: "shell", command: "id" }))).status).toBe(400);
    expect(mocks.cleanup).toHaveBeenCalledTimes(1);
    expect(mocks.reset).toHaveBeenCalledTimes(1);
  });

  it("rejects a flavor when the selected branch declares none", async () => {
    mocks.plan.mockResolvedValueOnce({ ...plan, flavors: [] });
    const response = await POST(post({ action: "run-test", repository: plan.repository, branch: "main", workflow: "deploy-only", flavor: "amd64" }));
    expect(response.status).toBe(400);
    expect(mocks.prepare).not.toHaveBeenCalled();
  });
});
