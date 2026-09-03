import { describe, expect, it } from "vitest";
import type { MyWorkPull } from "@/lib/my-work";
import { addPullsToPersonalWork, addReferencesToPersonalWork, EMPTY_PERSONAL_WORK_STATE, isMyWorkItemHidden, isPullInPersonalWork, myWorkItemFingerprint, myWorkItemKey, personalWorkReferenceKey, removePullsFromPersonalWork, resolvePersonalWorkPulls, sortMyWork, updatePersonalWorkNote } from "@/lib/my-work";

function workPull(overrides: Partial<MyWorkPull> & Pick<MyWorkPull, "id" | "repository">): MyWorkPull {
  return {
    number: overrides.id,
    title: `Pull ${overrides.id}`,
    url: `https://github.test/pull/${overrides.id}`,
    state: "open",
    draft: false,
    createdAt: "2026-08-10T00:00:00Z",
    updatedAt: "2026-08-10T00:00:00Z",
    closedAt: null,
    mergedAt: null,
    author: "engineer",
    authorAvatar: null,
    head: "feature",
    headRepository: overrides.repository,
    base: "main",
    body: null,
    summary: null,
    labels: [],
    assignees: [],
    requestedReviewers: [],
    workflow: {
      state: "waiting-on-others",
      progress: "waiting-reviewer",
      label: "Waiting on reviewer",
      reason: "Waiting for review.",
      blockers: [],
      waitingOn: ["reviewer"],
      approvals: { count: 0, required: 1, reviewers: [], changesRequestedBy: [], decision: "REVIEW_REQUIRED", lastApprovedAt: null },
      checks: { requiredKnown: true, total: 1, required: 1, passed: 1, pending: 0, failing: 0, failingNames: [], rollup: { passed: 1, pending: 0, pendingChecks: [], failing: 0, failingNames: [], failingChecks: [], cancelled: 0, cancelledNames: [], cancelledChecks: [] }, summary: "Required checks passed" },
      mergeable: "MERGEABLE",
      mergeStateStatus: "CLEAN",
      headSha: "abc123",
      assignedToViewer: false,
      authoredByViewer: true,
      reviewRequestedFromViewer: false,
      automation: false,
      renovate: false,
      renovateUpdate: null,
      elevatedAutomation: false,
      ignored: false,
    },
    ...overrides,
  };
}

describe("My work today preferences", () => {
  it("scopes hidden items by repository and pull request", () => {
    const pull = workPull({ id: 42, repository: "uds-packages/jira" });
    const hidden = { [myWorkItemKey(pull)]: myWorkItemFingerprint(pull) };

    expect(isMyWorkItemHidden(pull, hidden)).toBe(true);
    expect(isMyWorkItemHidden({ ...pull, repository: "uds-packages/xray" }, hidden)).toBe(false);
  });

  it("returns hidden work when its actionable state changes", () => {
    const pull = workPull({ id: 42, repository: "uds-packages/jira" });
    const hidden = { [myWorkItemKey(pull)]: myWorkItemFingerprint(pull) };
    const changed = { ...pull, workflow: { ...pull.workflow, state: "ready-to-merge" as const, progress: "ready-to-merge" as const, label: "Ready to merge" } };

    expect(isMyWorkItemHidden(changed, hidden)).toBe(false);
  });

  it("sorts priority work before handoffs and supports repository sorting", () => {
    const handoff = workPull({ id: 1, repository: "uds-packages/xray", updatedAt: "2026-08-12T00:00:00Z" });
    const review = workPull({ id: 2, repository: "uds-packages/jira", workflow: { ...handoff.workflow, state: "waiting-on-me", label: "Waiting on your review" } });

    expect(sortMyWork([handoff, review], "priority").map((pull) => pull.id)).toEqual([2, 1]);
    expect(sortMyWork([handoff, review], "repository").map((pull) => pull.id)).toEqual([2, 1]);
  });

  it("adds stable references without duplicating a pull request", () => {
    const pull = workPull({ id: 42, repository: "uds-packages/jira" });
    const first = addPullsToPersonalWork(EMPTY_PERSONAL_WORK_STATE, [pull], "2026-08-12T12:00:00Z");
    const second = addPullsToPersonalWork(first, [pull], "2026-08-12T13:00:00Z");

    expect(second.references).toHaveLength(1);
    expect(isPullInPersonalWork(pull, second)).toBe(true);
    expect(resolvePersonalWorkPulls(second, [pull])).toEqual([pull]);
  });

  it("keeps identical GitHub ids separate across repositories and removes only selected references", () => {
    const jira = workPull({ id: 42, repository: "uds-packages/jira" });
    const xray = workPull({ id: 42, repository: "uds-packages/xray" });
    const added = addPullsToPersonalWork(EMPTY_PERSONAL_WORK_STATE, [jira, xray], "2026-08-12T12:00:00Z");
    const remaining = removePullsFromPersonalWork(added, [jira]);

    expect(added.references).toHaveLength(2);
    expect(isPullInPersonalWork(jira, remaining)).toBe(false);
    expect(isPullInPersonalWork(xray, remaining)).toBe(true);
  });

  it("keeps work kinds separate and stores a bounded personal note", () => {
    const addedAt = "2026-08-12T12:00:00Z";
    const pull = { version: 1 as const, source: "github" as const, kind: "pull-request" as const, repository: "uds-packages/jira", id: "42", addedAt };
    const issue = { ...pull, kind: "issue" as const };
    const added = addReferencesToPersonalWork(EMPTY_PERSONAL_WORK_STATE, [pull, issue]);
    const noted = updatePersonalWorkNote(added, issue, `  ${"x".repeat(600)}  `);

    expect(added.references).toHaveLength(2);
    expect(personalWorkReferenceKey(pull)).not.toBe(personalWorkReferenceKey(issue));
    expect(noted.references.find((reference) => reference.kind === "issue")?.note).toHaveLength(500);
  });
});
