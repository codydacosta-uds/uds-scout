import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  apiError: vi.fn(),
  setToken: vi.fn(),
  validateToken: vi.fn(),
}));

vi.mock("@/lib/github", () => ({
  apiError: mocks.apiError,
  setSessionGitHubToken: mocks.setToken,
  validateGitHubToken: mocks.validateToken,
}));

import { POST } from "@/app/api/setup/connect/route";

const SECRET = "test-credential-value-that-must-never-leave-the-server";

function request(body: unknown, origin = "http://localhost:3001") {
  return new NextRequest("http://localhost:3001/api/setup/connect", {
    method: "POST",
    headers: { "content-type": "application/json", host: "localhost:3001", origin },
    body: JSON.stringify(body),
  });
}

describe("GitHub setup token route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.apiError.mockReturnValue({ message: "GitHub rejected the token.", status: 401 });
    mocks.validateToken.mockResolvedValue({
      login: "engineer",
      name: "Engineer",
      avatar_url: "https://avatars.githubusercontent.com/u/1",
      html_url: "https://github.com/engineer",
    });
  });

  it("rejects cross-origin token submission", async () => {
    const response = await POST(request({ token: SECRET }, "https://attacker.example"));
    expect(response.status).toBe(403);
    expect(mocks.validateToken).not.toHaveBeenCalled();
  });

  it("stores a validated token in server memory but never returns it", async () => {
    const response = await POST(request({ token: `  ${SECRET}  ` }));
    const text = await response.text();
    expect(response.status).toBe(200);
    expect(mocks.validateToken).toHaveBeenCalledWith(SECRET);
    expect(mocks.setToken).toHaveBeenCalledWith(SECRET, "engineer");
    expect(text).not.toContain(SECRET);
    expect(text).not.toMatch(/token/i);
  });

  it("rejects empty and oversized credentials without validating them", async () => {
    expect((await POST(request({ token: " " }))).status).toBe(400);
    expect((await POST(request({ token: "x".repeat(501) }))).status).toBe(400);
    expect(mocks.validateToken).not.toHaveBeenCalled();
  });
});
