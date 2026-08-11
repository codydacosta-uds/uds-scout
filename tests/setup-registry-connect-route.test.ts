import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  clearCache: vi.fn(),
  status: vi.fn(),
  setCredentials: vi.fn(),
  validate: vi.fn(),
  snapshot: vi.fn(),
  tracked: vi.fn(),
}));

vi.mock("@/lib/security-oci", () => ({ clearSecurityRegistryTokenCache: mocks.clearCache }));
vi.mock("@/lib/security-registry-auth", () => ({
  defenseRegistryCredentialStatus: mocks.status,
  setSessionDefenseRegistryCredentials: mocks.setCredentials,
  validateDefenseRegistryCredentials: mocks.validate,
}));
vi.mock("@/lib/security-service", () => ({ securityRefreshService: () => ({ snapshot: mocks.snapshot }) }));
vi.mock("@/lib/tracked-repositories", () => ({ trackedRepositories: mocks.tracked }));

import { POST } from "@/app/api/setup/registry/connect/route";

const PASSWORD = "test-registry-credential-that-must-stay-server-side";

function request(body: unknown, origin = "http://localhost:3001") {
  return new NextRequest("http://localhost:3001/api/setup/registry/connect", {
    method: "POST",
    headers: { "content-type": "application/json", host: "localhost:3001", origin },
    body: JSON.stringify(body),
  });
}

describe("registry credential route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.status.mockReturnValue({ configured: false, source: null });
    mocks.validate.mockResolvedValue({ host: "registry.defenseunicorns.com" });
    mocks.tracked.mockReturnValue(["uds-packages/jenkins"]);
  });

  it("rejects cross-origin credential submission", async () => {
    const response = await POST(request({ username: "engineer", password: PASSWORD }, "https://attacker.example"));
    expect(response.status).toBe(403);
    expect(mocks.validate).not.toHaveBeenCalled();
  });

  it("keeps validated credentials in server memory and out of the response", async () => {
    const response = await POST(request({ username: " engineer ", password: PASSWORD }));
    const text = await response.text();
    expect(response.status).toBe(200);
    expect(mocks.setCredentials).toHaveBeenCalledWith("engineer", PASSWORD);
    expect(mocks.clearCache).toHaveBeenCalledTimes(1);
    expect(mocks.snapshot).toHaveBeenCalledWith(["uds-packages/jenkins"], true);
    expect(text).not.toContain(PASSWORD);
    expect(text).not.toContain("engineer");
  });

  it("does not allow browser credentials to replace environment-managed credentials", async () => {
    mocks.status.mockReturnValueOnce({ configured: true, source: "environment" });
    const response = await POST(request({ username: "engineer", password: PASSWORD }));
    expect(response.status).toBe(409);
    expect(mocks.validate).not.toHaveBeenCalled();
  });
});
