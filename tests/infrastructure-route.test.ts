import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  apiError: vi.fn(),
  request: vi.fn(),
  isTracked: vi.fn(),
}));

vi.mock("@/lib/github", () => ({ apiError: mocks.apiError, githubRequest: mocks.request }));
vi.mock("@/lib/tracked-repositories", () => ({ isTrackedRepository: mocks.isTracked }));

import { GET } from "@/app/api/github/infrastructure/route";

describe("Infrastructure Explorer API scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.apiError.mockReturnValue({ message: "failed", status: 502 });
  });

  it("rejects direct access when SONIC is not selected in the workspace", async () => {
    mocks.isTracked.mockReturnValue(false);
    const response = await GET();

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: expect.stringMatching(/SONIC repository is selected/) });
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it("starts source analysis only when SONIC is selected", async () => {
    mocks.isTracked.mockReturnValue(true);
    mocks.request.mockResolvedValue({ sha: "tree-sha", tree: [], truncated: true });
    const response = await GET();

    expect(response.status).toBe(502);
    expect(mocks.request).toHaveBeenCalledWith("/repos/nswccd-devsecops/sonic-swf-iac/git/trees/main?recursive=1", 300_000);
  });
});
