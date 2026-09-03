import type { Issue, PipelineRun, PullRequest } from "@/components/types";
import type { SecurityFinding } from "@/components/security-types";

export type MyWorkPull = PullRequest & { repository: string };
export type MyWorkIssue = Issue & { repository: string };
export type MyWorkPipeline = PipelineRun & { repository: string };
export type MyWorkSort = "priority" | "updated" | "repository" | "status";
export type PersonalWorkKind = "pull-request" | "issue" | "workflow" | "security-finding";

export type PersonalWorkReference = {
  version: 1;
  source: "github" | "scout";
  kind: PersonalWorkKind;
  repository: string;
  id: string;
  addedAt: string;
  note?: string;
};

export type PersonalWorkState = {
  version: 1;
  references: PersonalWorkReference[];
  hiddenRecommendations: Record<string, string>;
};

export const MAX_PERSONAL_WORK_REFERENCES = 250;

export const EMPTY_PERSONAL_WORK_STATE: PersonalWorkState = {
  version: 1,
  references: [],
  hiddenRecommendations: {},
};

const WORK_PRIORITY: Record<PullRequest["workflow"]["state"], number> = {
  "waiting-on-me": 0,
  blocked: 1,
  "ready-to-merge": 2,
  "waiting-on-others": 3,
  "needs-review": 4,
  "needs-approval": 5,
  "no-action": 6,
};

export const MY_WORK_SORT_OPTIONS: { label: string; value: MyWorkSort }[] = [
  { label: "Sort: Priority", value: "priority" },
  { label: "Sort: Recently updated", value: "updated" },
  { label: "Sort: Repository", value: "repository" },
  { label: "Sort: Status", value: "status" },
];

const personalWorkStorageKey = (viewer: string) => `uds-scout:${viewer.toLowerCase()}:my-work:v1`;
const legacyHiddenWorkStorageKey = (viewer: string) => `uds-scout:${viewer.toLowerCase()}:hidden-my-work:v1`;

export function personalWorkStorageName(viewer: string) {
  return personalWorkStorageKey(viewer);
}

function validReference(value: unknown): value is PersonalWorkReference {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PersonalWorkReference>;
  const validKind = candidate.kind === "pull-request" || candidate.kind === "issue" || candidate.kind === "workflow" || candidate.kind === "security-finding";
  const validSource = candidate.kind === "security-finding" ? candidate.source === "scout" : candidate.source === "github";
  return candidate.version === 1
    && validKind
    && validSource
    && typeof candidate.repository === "string"
    && Boolean(candidate.repository.trim())
    && (typeof candidate.id === "string" || typeof candidate.id === "number")
    && Boolean(String(candidate.id).trim())
    && typeof candidate.addedAt === "string"
    && Number.isFinite(new Date(candidate.addedAt).getTime())
    && (candidate.note === undefined || typeof candidate.note === "string");
}

function normalizeReference(reference: PersonalWorkReference | (Omit<PersonalWorkReference, "id"> & { id: string | number })): PersonalWorkReference {
  return { ...reference, id: String(reference.id), note: reference.note?.trim().slice(0, 500) || undefined };
}

function validHiddenRecommendations(value: unknown): value is Record<string, string> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && Object.values(value as Record<string, unknown>).every((fingerprint) => typeof fingerprint === "string");
}

export function readPersonalWorkState(viewer: string): PersonalWorkState {
  try {
    const saved = JSON.parse(window.localStorage.getItem(personalWorkStorageKey(viewer)) ?? "null") as unknown;
    if (saved && typeof saved === "object") {
      const candidate = saved as Partial<PersonalWorkState>;
      if (candidate.version === 1 && Array.isArray(candidate.references) && validHiddenRecommendations(candidate.hiddenRecommendations)) {
        const references = candidate.references.filter(validReference).map(normalizeReference);
        return {
          version: 1,
          references: [...new Map(references.map((reference) => [personalWorkReferenceKey(reference), reference])).values()].slice(0, MAX_PERSONAL_WORK_REFERENCES),
          hiddenRecommendations: candidate.hiddenRecommendations,
        };
      }
    }

    const legacyHidden = JSON.parse(window.localStorage.getItem(legacyHiddenWorkStorageKey(viewer)) ?? "{}") as unknown;
    return {
      ...EMPTY_PERSONAL_WORK_STATE,
      hiddenRecommendations: validHiddenRecommendations(legacyHidden) ? legacyHidden : {},
    };
  } catch {
    return { ...EMPTY_PERSONAL_WORK_STATE };
  }
}

export function writePersonalWorkState(viewer: string, state: PersonalWorkState) {
  window.localStorage.setItem(personalWorkStorageKey(viewer), JSON.stringify(state));
}

export function personalWorkReferenceKey(reference: Pick<PersonalWorkReference, "source" | "kind" | "repository" | "id">) {
  return `${reference.source}:${reference.kind}:${reference.repository.toLowerCase()}:${String(reference.id)}`;
}

export function myWorkItemKey(pull: MyWorkPull) {
  return `${pull.repository.toLowerCase()}:${pull.id}`;
}

export function personalWorkReferenceForPull(pull: MyWorkPull, addedAt: string, note?: string): PersonalWorkReference {
  return normalizeReference({ version: 1, source: "github", kind: "pull-request", repository: pull.repository, id: pull.id, addedAt, note });
}

export function personalWorkReferenceForIssue(issue: MyWorkIssue, addedAt: string, note?: string): PersonalWorkReference {
  return normalizeReference({ version: 1, source: "github", kind: "issue", repository: issue.repository, id: issue.id, addedAt, note });
}

export function personalWorkReferenceForWorkflow(run: MyWorkPipeline, addedAt: string, note?: string): PersonalWorkReference {
  return normalizeReference({ version: 1, source: "github", kind: "workflow", repository: run.repository, id: run.id, addedAt, note });
}

export function personalWorkReferenceForSecurityFinding(finding: SecurityFinding, addedAt: string, note?: string): PersonalWorkReference {
  return normalizeReference({ version: 1, source: "scout", kind: "security-finding", repository: finding.repositoryId, id: finding.id, addedAt, note });
}

export function isReferenceInPersonalWork(reference: PersonalWorkReference, state: PersonalWorkState) {
  const key = personalWorkReferenceKey(reference);
  return state.references.some((candidate) => personalWorkReferenceKey(candidate) === key);
}

export function isPullInPersonalWork(pull: MyWorkPull, state: PersonalWorkState) {
  return isReferenceInPersonalWork(personalWorkReferenceForPull(pull, "1970-01-01T00:00:00.000Z"), state);
}

export function addReferencesToPersonalWork(state: PersonalWorkState, additions: PersonalWorkReference[]): PersonalWorkState {
  const references = new Map(state.references.map((reference) => [personalWorkReferenceKey(reference), reference]));
  additions.map(normalizeReference).forEach((reference) => {
    if (!references.has(personalWorkReferenceKey(reference))) references.set(personalWorkReferenceKey(reference), reference);
  });
  return { ...state, references: [...references.values()].slice(0, MAX_PERSONAL_WORK_REFERENCES) };
}

export function addPullsToPersonalWork(state: PersonalWorkState, pulls: MyWorkPull[], addedAt = new Date().toISOString()): PersonalWorkState {
  return addReferencesToPersonalWork(state, pulls.map((pull) => personalWorkReferenceForPull(pull, addedAt)));
}

export function removeReferencesFromPersonalWork(state: PersonalWorkState, removedReferences: PersonalWorkReference[]): PersonalWorkState {
  const removed = new Set(removedReferences.map(personalWorkReferenceKey));
  return { ...state, references: state.references.filter((reference) => !removed.has(personalWorkReferenceKey(reference))) };
}

export function removePullsFromPersonalWork(state: PersonalWorkState, pulls: MyWorkPull[]): PersonalWorkState {
  return removeReferencesFromPersonalWork(state, pulls.map((pull) => personalWorkReferenceForPull(pull, "1970-01-01T00:00:00.000Z")));
}

export function updatePersonalWorkNote(state: PersonalWorkState, reference: PersonalWorkReference, note: string): PersonalWorkState {
  const key = personalWorkReferenceKey(reference);
  return {
    ...state,
    references: state.references.map((candidate) => personalWorkReferenceKey(candidate) === key ? normalizeReference({ ...candidate, note }) : candidate),
  };
}

export function resolvePersonalWorkPulls(state: PersonalWorkState, pulls: MyWorkPull[]) {
  const byKey = new Map(pulls.map((pull) => [personalWorkReferenceKey(personalWorkReferenceForPull(pull, "1970-01-01T00:00:00.000Z")), pull]));
  return state.references.flatMap((reference) => {
    const pull = reference.kind === "pull-request" ? byKey.get(personalWorkReferenceKey(reference)) : undefined;
    return pull ? [pull] : [];
  });
}

export function myWorkItemFingerprint(pull: MyWorkPull) {
  return JSON.stringify({
    headSha: pull.workflow.headSha,
    state: pull.workflow.state,
    progress: pull.workflow.progress,
    label: pull.workflow.label,
    reason: pull.workflow.reason,
    blockers: pull.workflow.blockers,
    waitingOn: pull.workflow.waitingOn,
    reviewDecision: pull.workflow.approvals.decision,
    checks: {
      pending: pull.workflow.checks.pending,
      failing: pull.workflow.checks.failing,
      rollupPending: pull.workflow.checks.rollup.pending,
      rollupFailing: pull.workflow.checks.rollup.failing,
    },
  });
}

export function isMyWorkItemHidden(pull: MyWorkPull, hiddenItems: Record<string, string>) {
  return hiddenItems[myWorkItemKey(pull)] === myWorkItemFingerprint(pull);
}

export function sortMyWork(items: MyWorkPull[], sort: MyWorkSort) {
  return [...items].sort((left, right) => {
    if (sort === "updated") return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
    if (sort === "repository") {
      const repositoryOrder = left.repository.localeCompare(right.repository);
      if (repositoryOrder) return repositoryOrder;
    }
    if (sort === "status") {
      const statusOrder = left.workflow.label.localeCompare(right.workflow.label);
      if (statusOrder) return statusOrder;
    }
    if (sort === "priority") {
      const priorityOrder = WORK_PRIORITY[left.workflow.state] - WORK_PRIORITY[right.workflow.state];
      if (priorityOrder) return priorityOrder;
    }
    return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
  });
}
