import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  currentViewer: vi.fn(),
  allPages: vi.fn(),
  apiError: vi.fn(),
  mutation: vi.fn(),
  preflight: vi.fn(),
  readSettings: vi.fn(),
}));

vi.mock("@/lib/github", () => ({ currentGitHubViewer: mocks.currentViewer }));
vi.mock("@/lib/gitlab", () => ({
  gitlabAllPages: mocks.allPages,
  gitlabApiError: mocks.apiError,
  gitlabMutation: mocks.mutation,
  gitlabProjectPreflight: mocks.preflight,
}));
vi.mock("@/lib/local-settings", () => ({ readLocalSettings: mocks.readSettings }));

import { POST } from "@/app/api/gitlab/tickets/route";

function request(body: unknown, origin = "http://127.0.0.1:3001") {
  return new NextRequest("http://127.0.0.1:3001/api/gitlab/tickets", {
    method: "POST",
    headers: { "content-type": "application/json", host: "127.0.0.1:3001", origin },
    body: JSON.stringify(body),
  });
}

function draft(index = 1, labels: string[] = []) {
  return { clientId: `draft-${index}`, title: `Ticket ${index}`, description: "Details", labels };
}

describe("GitLab ticket route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.currentViewer.mockReturnValue("engineer");
    mocks.readSettings.mockReturnValue({ gitlabProjects: ["group/allowed"] });
    mocks.preflight.mockResolvedValue({ canCreateTickets: true });
    mocks.allPages.mockResolvedValue([{ name: "Security" }, { name: "Bug" }]);
    mocks.apiError.mockImplementation((error: unknown) => ({ message: error instanceof Error ? error.message : "failed", status: 502 }));
    mocks.mutation.mockResolvedValue({ id: 1, iid: 2, title: "Ticket", web_url: "https://gitlab.example/ticket" });
  });

  it("rejects cross-origin mutations before reading settings or contacting GitLab", async () => {
    const response = await POST(request({ project: "group/allowed", tickets: [draft()] }, "https://attacker.example"));
    expect(response.status).toBe(403);
    expect(mocks.preflight).not.toHaveBeenCalled();
    expect(mocks.mutation).not.toHaveBeenCalled();
  });

  it("enforces the server-side batch limit and unique identifiers", async () => {
    const tooMany = await POST(request({ project: "group/allowed", tickets: Array.from({ length: 21 }, (_, index) => draft(index)) }));
    expect(tooMany.status).toBe(400);
    const duplicate = await POST(request({ project: "group/allowed", tickets: [draft(), draft()] }));
    expect(duplicate.status).toBe(400);
    expect(mocks.preflight).not.toHaveBeenCalled();
  });

  it("rejects projects outside the current user's saved allowlist", async () => {
    const response = await POST(request({ project: "group/other", tickets: [draft()] }));
    expect(response.status).toBe(403);
    expect(mocks.preflight).not.toHaveBeenCalled();
  });

  it("revalidates Developer access and selected labels before every batch", async () => {
    mocks.preflight.mockResolvedValueOnce({ canCreateTickets: false });
    const denied = await POST(request({ project: "group/allowed", tickets: [draft()] }));
    expect(denied.status).toBe(409);
    expect(mocks.mutation).not.toHaveBeenCalled();

    mocks.preflight.mockResolvedValueOnce({ canCreateTickets: true });
    const invalidLabel = await POST(request({ project: "group/allowed", tickets: [draft(1, ["not-allowed"])] }));
    expect(invalidLabel.status).toBe(409);
    expect(mocks.mutation).not.toHaveBeenCalled();
  });

  it("canonicalizes labels and uses exactly one allowlisted project", async () => {
    const response = await POST(request({ project: "GROUP/ALLOWED", tickets: [draft(1, ["security"])] }));
    expect(response.status).toBe(200);
    expect(mocks.preflight).toHaveBeenCalledWith("group/allowed", true);
    expect(mocks.mutation).toHaveBeenCalledWith("/projects/group%2Fallowed/issues", expect.objectContaining({ labels: "Security", issue_type: "issue" }));
    expect(await response.json()).toMatchObject({ project: "group/allowed", created: [{ clientId: "draft-1" }], failed: [] });
  });

  it("reports each result and never retries a failed creation", async () => {
    mocks.mutation
      .mockRejectedValueOnce(new Error("creation rejected"))
      .mockResolvedValueOnce({ id: 2, iid: 3, title: "Ticket 2", web_url: "https://gitlab.example/2" });
    const response = await POST(request({ project: "group/allowed", tickets: [draft(1), draft(2)] }));
    const body = await response.json();
    expect(mocks.mutation).toHaveBeenCalledTimes(2);
    expect(body.created).toHaveLength(1);
    expect(body.failed).toEqual([{ clientId: "draft-1", title: "Ticket 1", error: "creation rejected" }]);
  });
});
