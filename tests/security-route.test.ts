import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  apiError: vi.fn(),
  snapshot: vi.fn(),
  isTracked: vi.fn(),
  tracked: vi.fn(),
}));

vi.mock("@/lib/github", () => ({ apiError: mocks.apiError }));
vi.mock("@/lib/security-service", () => ({ securityRefreshService: () => ({ snapshot: mocks.snapshot }) }));
vi.mock("@/lib/tracked-repositories", () => ({ isTrackedRepository: mocks.isTracked, trackedRepositories: mocks.tracked }));

import { GET } from "@/app/api/security/route";

function request(query = "") {
  return new NextRequest(`http://127.0.0.1:3001/api/security${query}`);
}

describe("Security Intelligence API scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isTracked.mockReturnValue(true);
    mocks.tracked.mockReturnValue(["uds-packages/jenkins", "nswccd-devsecops/sonic-swf-iac"]);
    mocks.snapshot.mockReturnValue({ repositories: [] });
  });

  it("rejects malformed and untracked repository names", async () => {
    mocks.isTracked.mockReturnValue(false);
    expect((await GET(request("?repository=../../etc/passwd"))).status).toBe(403);
    expect((await GET(request("?repository=attacker/repo"))).status).toBe(403);
    expect(mocks.snapshot).not.toHaveBeenCalled();
  });

  it("excludes SONIC from package security intelligence", async () => {
    expect((await GET(request("?repository=nswccd-devsecops/sonic-swf-iac"))).status).toBe(403);
    expect(mocks.snapshot).not.toHaveBeenCalled();
  });

  it("passes only tracked package repositories to the service", async () => {
    const response = await GET(request("?refresh=true"));
    expect(response.status).toBe(200);
    expect(mocks.snapshot).toHaveBeenCalledWith(["uds-packages/jenkins"], true);
  });
});
