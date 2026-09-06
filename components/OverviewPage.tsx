"use client";

/* eslint-disable react-hooks/set-state-in-effect -- Browser-local card preferences are loaded after hydration. */

import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, rectSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import Badge from "@cloudscape-design/components/badge";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ContentLayout from "@cloudscape-design/components/content-layout";
import Container from "@cloudscape-design/components/container";
import Flashbar from "@cloudscape-design/components/flashbar";
import Grid from "@cloudscape-design/components/grid";
import Header from "@cloudscape-design/components/header";
import Icon from "@cloudscape-design/components/icon";
import Link from "@cloudscape-design/components/link";
import Modal from "@cloudscape-design/components/modal";
import Select from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Spinner from "@cloudscape-design/components/spinner";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import Table from "@cloudscape-design/components/table";
import Textarea from "@cloudscape-design/components/textarea";
import { useEffect, useState } from "react";
import { isMyWorkItemHidden, MY_WORK_SORT_OPTIONS, myWorkItemFingerprint, myWorkItemKey, personalWorkReferenceForIssue, personalWorkReferenceForPull, personalWorkReferenceForSecurityFinding, personalWorkReferenceForWorkflow, personalWorkReferenceKey, removeReferencesFromPersonalWork, updatePersonalWorkNote, type MyWorkPull, type MyWorkSort, type PersonalWorkReference, type PersonalWorkState } from "@/lib/my-work";
import { renovateReviewDayForDate } from "@/lib/renovate-review";

import { PrimaryActionButton } from "./action-ui";
import { InfoPopover as PanelInfo } from "./info-ui";
import type { DrawerSelection } from "./operations-types";
import { EmptyState, MetricCard, pipelineStatus, PullAuthor, pullWorkflowStatus, relativeTime, repositoryAttentionAction, repositoryHealth, udsCommonStatusAction } from "./operations-ui";
import { filterRenovateUpdatesByCheck, isMajorRenovateUpdate, renovateCheckFilterOptions, RenovateUpdatesTable, sortRenovateUpdates, type RenovateCheckFilter } from "./RenovateUpdatesTable";
import type { RepositorySecurity, SecurityFinding, SecurityWorkspace, Vulnerability } from "./security-types";
import type { GitLabWorkItems, Issue, Overview, PipelineRun, PullRequest, RepositoryCatalog, WorkflowFailure } from "./types";

function greetingForHour(hour: number) {
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 17) return "Good afternoon";
  if (hour >= 17 && hour < 22) return "Good evening";
  return "Welcome back";
}

function viewerFirstName(viewer: Overview["viewer"]) {
  const value = viewer.name?.trim().split(/\s+/)[0] || viewer.login.split(/[._-]/)[0];
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function DataFreshness({ generatedAt, refreshing, stale }: { generatedAt: string; refreshing: boolean; stale: boolean }) {
  const generated = new Date(generatedAt);
  const valid = Number.isFinite(generated.getTime());
  const time = valid ? generated.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "unknown";
  const fullTimestamp = valid ? generated.toLocaleString() : "The last update time is unavailable";
  const label = refreshing ? "Refreshing data…" : stale ? `Last update ${time}` : `Updated ${time}`;

  return (
    <span className={`data-freshness${stale ? " data-freshness-stale" : ""}`} role="status" aria-live="polite" aria-atomic="true" title={fullTimestamp}>
      {refreshing ? label : <><span>{stale ? "Last update" : "Updated"} </span><time dateTime={generatedAt} suppressHydrationWarning>{time}</time></>}
    </span>
  );
}

function gitLabWorkItemStatus(status: GitLabWorkItems["items"][number]["status"]) {
  if (!status) return <StatusIndicator type="pending">Not set</StatusIndicator>;
  const category = status.category.toLowerCase();
  if (category === "in_progress") return <StatusIndicator type="in-progress">{status.name}</StatusIndicator>;
  if (category === "done") return <StatusIndicator type="success">{status.name}</StatusIndicator>;
  if (category === "cancelled") return <StatusIndicator type="stopped">{status.name}</StatusIndicator>;
  return <StatusIndicator type="pending">{status.name}</StatusIndicator>;
}

function ToolVersion({ release, generatedAt, className }: {
  release: Overview["tools"][keyof Overview["tools"]];
  generatedAt: string;
  className: string;
}) {
  const publishedAt = release.publishedAt ? new Date(release.publishedAt).getTime() : Number.NaN;
  const age = new Date(generatedAt).getTime() - publishedAt;
  const changedIn24Hours = Boolean(
    release.version &&
    release.previousVersion &&
    release.version !== release.previousVersion &&
    Number.isFinite(age) &&
    age >= 0 &&
    age <= 86_400_000,
  );

  if (!changedIn24Hours) return <span className={className}>{release.version ?? "Unavailable"}</span>;
  return (
    <span className={`${className} tool-version-change`}>
      <span className="tool-version-previous">{release.previousVersion}</span>
      <span className="tool-version-arrow">→</span>
      <span className="tool-version-current">{release.version}</span>
    </span>
  );
}

function VersionComparison({ label, current, target, outdated, aligned, onClick }: {
  label: string;
  current: string;
  target?: string | null;
  outdated: boolean;
  aligned: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className="uds-version-summary-button" onClick={onClick} aria-label={`View ${label} details`}>
      <span className="uds-version-label">{label}</span>
      <span className="uds-version-comparison">
        <span className={`uds-version-value${outdated ? " uds-version-running-outdated" : aligned ? " uds-version-current" : ""}`}>{current}</span>
        {outdated && target ? <span className="uds-version-target">{target}</span> : null}
      </span>
    </button>
  );
}

type OverviewCardId = "pull-requests" | "renovate" | "issues" | "pipelines" | "uds-versions" | "reviews" | "zarf" | "pepr" | "uds-cli" | "uds-packages";

const DEFAULT_OVERVIEW_CARD_ORDER: OverviewCardId[] = [
  "pull-requests",
  "reviews",
  "pipelines",
  "issues",
  "uds-versions",
  "zarf",
  "pepr",
  "uds-cli",
  "renovate",
];

const OVERVIEW_CARD_LABELS: Record<OverviewCardId, string> = {
  "pull-requests": "Waiting on me",
  renovate: "Renovate updates",
  issues: "Assigned issues",
  pipelines: "Pipeline status",
  "uds-versions": "UDS versions",
  reviews: "Ready to merge",
  zarf: "Zarf version",
  pepr: "Pepr version",
  "uds-cli": "UDS CLI version",
  "uds-packages": "UDS Packages repositories",
};

const overviewCardOrderKey = (viewer: string) => `uds-scout:${viewer.toLowerCase()}:overview-card-order`;
const legacyOverviewCardOrderKey = (viewer: string) => `d2d-operations:${viewer.toLowerCase()}:overview-card-order`;
const renovateReviewVisibilityKey = (viewer: string) => `uds-scout:${viewer.toLowerCase()}:renovate-review-visibility`;
const firstRunWelcomeKey = (viewer: string) => `uds-scout:${viewer.toLowerCase()}:overview-welcome:v1`;
const myWorkSortKey = (viewer: string) => `uds-scout:${viewer.toLowerCase()}:my-work-sort:v1`;

function myWorkReason(pull: MyWorkPull, addedByViewerOnly: boolean) {
  if (addedByViewerOnly) return "Added by you for personal follow-up.";
  if (pull.workflow.state === "needs-review" && !pull.assignees.length) return "This human-created pull request needs an owner.";
  if (pull.workflow.state === "waiting-on-others" && pull.workflow.authoredByViewer) return "Your pull request needs review or approval.";
  if (pull.workflow.state === "ready-to-merge") return "Approvals and required checks are complete.";
  return pull.workflow.reason;
}

function myWorkWaitingOn(pull: MyWorkPull) {
  if (pull.workflow.state === "needs-review" && !pull.assignees.length) return { label: "Owner", detail: "Owner" };
  if (pull.workflow.waitingOn.length) {
    return {
      label: pull.workflow.waitingOn.map((person) => person.split("/").at(-1) ?? person).join(", "),
      detail: pull.workflow.waitingOn.join(", "),
    };
  }
  if (pull.workflow.checks.failing || pull.workflow.checks.pending) return { label: "Required checks", detail: "Required checks" };
  if (pull.workflow.progress === "merge-conflict") return { label: "Source branch update", detail: "Source branch update" };
  if (pull.workflow.state === "ready-to-merge") return { label: "Merge decision", detail: "Merge decision" };
  return null;
}

type MyWorkView = "all" | "recommended" | "added" | "pull-request" | "issue" | "workflow" | "security-finding";
type MyWorkStatusType = "error" | "warning" | "success" | "info" | "pending" | "in-progress" | "stopped";

type MyWorkQueueItem = {
  key: string;
  reference: PersonalWorkReference;
  kind: PersonalWorkReference["kind"];
  repository: string;
  title: string;
  detail: string;
  url: string;
  status: string;
  statusType: MyWorkStatusType;
  reason: string;
  waitingOn: string | null;
  updatedAt: string;
  priority: number;
  recommended: boolean;
  addedByViewer: boolean;
  note: string | null;
  pull?: MyWorkPull;
  issue?: Issue & { repository: string };
  run?: PipelineRun & { repository: string };
  failure?: WorkflowFailure;
  security?: { finding: SecurityFinding; vulnerability: Vulnerability; repository: RepositorySecurity };
};

const MY_WORK_VIEW_OPTIONS: { label: string; value: MyWorkView }[] = [
  { label: "All work", value: "all" },
  { label: "Scout recommendations", value: "recommended" },
  { label: "Added by me", value: "added" },
  { label: "Pull requests", value: "pull-request" },
  { label: "Issues", value: "issue" },
  { label: "Workflows", value: "workflow" },
  { label: "Security findings", value: "security-finding" },
];

function myWorkStatusForPull(pull: PullRequest): { status: string; statusType: MyWorkStatusType; priority: number } {
  if (pull.workflow.state === "blocked") return { status: pull.workflow.label, statusType: pull.workflow.checks.failing ? "error" : "warning", priority: 0 };
  if (pull.workflow.state === "waiting-on-me" || pull.workflow.state === "needs-review") return { status: pull.workflow.label, statusType: "warning", priority: 1 };
  if (pull.workflow.state === "ready-to-merge") return { status: pull.workflow.label, statusType: "success", priority: 2 };
  if (pull.workflow.state === "waiting-on-others" || pull.workflow.state === "needs-approval") return { status: pull.workflow.label, statusType: "info", priority: 4 };
  return { status: pull.workflow.label, statusType: "pending", priority: 5 };
}

function pipelineStatusForMyWork(run: PipelineRun) {
  if (run.status !== "completed") return "Running";
  if (run.conclusion === "success") return "Passed";
  if (["failure", "timed_out", "action_required", "startup_failure"].includes(run.conclusion ?? "")) return "Failed";
  return run.conclusion ?? "Unknown";
}

function localDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function dailyRenovateReviewOverride(viewer: string, date: Date) {
  try {
    const saved = JSON.parse(window.localStorage.getItem(renovateReviewVisibilityKey(viewer)) ?? "null") as { date?: unknown; visible?: unknown } | null;
    return saved?.date === localDateKey(date) && typeof saved.visible === "boolean" ? saved.visible : null;
  } catch {
    return null;
  }
}
function SortableOverviewCard({ id, label, customizing, children }: {
  id: OverviewCardId;
  label: string;
  customizing: boolean;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled: !customizing });

  return (
    <div
      ref={setNodeRef}
      className={`overview-card-slot${customizing ? " overview-card-slot-customizing" : ""}${isDragging ? " overview-card-slot-dragging" : ""}`}
      style={{ transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 2 : undefined }}
    >
      {customizing ? (
        <button className="overview-card-drag-handle" type="button" aria-label={`Move ${label}`} {...attributes} {...listeners}>
          <Icon name="drag-indicator" />
        </button>
      ) : null}
      {children}
    </div>
  );
}

export function OverviewPage({ overview, securityWorkspace, personalWorkState, onPersonalWorkStateChange, refreshing, refreshError, gitLabWorkItems, gitLabLoading, gitLabError, repositoryCatalog, repositoryCatalogLoading, repositoryCatalogError, refresh, openDrawer, navigate }: {
  overview: Overview;
  securityWorkspace: SecurityWorkspace | null;
  personalWorkState: PersonalWorkState;
  onPersonalWorkStateChange: (state: PersonalWorkState, confirmation?: string) => void;
  refreshing: boolean;
  refreshError: string | null;
  gitLabWorkItems: GitLabWorkItems | null;
  gitLabLoading: boolean;
  gitLabError: string | null;
  repositoryCatalog: RepositoryCatalog | null;
  repositoryCatalogLoading: boolean;
  repositoryCatalogError: string | null;
  refresh: () => void;
  openDrawer: (selection: DrawerSelection) => void;
  navigate: (href: string) => void;
}) {
  const [greeting, setGreeting] = useState("Welcome back");
  const [showWeeklyRenovateReview, setShowWeeklyRenovateReview] = useState(false);
  const [renovateCheckFilter, setRenovateCheckFilter] = useState<RenovateCheckFilter>("priority");
  const [welcomeVisible, setWelcomeVisible] = useState(false);
  const [myWorkSort, setMyWorkSort] = useState<MyWorkSort>("priority");
  const [myWorkView, setMyWorkView] = useState<MyWorkView>("all");
  const [selectedMyWork, setSelectedMyWork] = useState<MyWorkQueueItem[]>([]);
  const [noteReference, setNoteReference] = useState<PersonalWorkReference | null>(null);
  const [noteValue, setNoteValue] = useState("");
  const [hiddenMyWorkOpen, setHiddenMyWorkOpen] = useState(false);
  const [cardOrder, setCardOrder] = useState<OverviewCardId[]>(DEFAULT_OVERVIEW_CARD_ORDER);
  const [customizeCardsOpen, setCustomizeCardsOpen] = useState(false);
  const cardDragSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const passingPipelines = overview.repositories.filter((repository) => repository.pipeline?.conclusion === "success").length;
  const commonOutdated = overview.udsCommon.repositories.some((repository) => repository.status === "outdated");
  const commonReferencedVersions = [...new Set(overview.udsCommon.repositories.flatMap((repository) => repository.versions))];
  const commonDisplayedVersion = commonOutdated
    ? commonReferencedVersions.length === 1 ? commonReferencedVersions[0] : "Mixed versions"
    : overview.udsCommon.latestVersion ?? "Unavailable";
  const securityByRepository = new Map((securityWorkspace?.repositories ?? []).map((item) => [item.repositoryId.toLowerCase(), item]));
  const udsWarningLabel = overview.udsCommon.needsAttention
    ? "UDS Common versions need alignment"
    : overview.udsCore.comparison === "behind"
      ? "UDS Core version needs alignment"
      : null;

  useEffect(() => {
    const updateLocalTime = () => {
      const now = new Date();
      setGreeting(greetingForHour(now.getHours()));
      const scheduled = overview.preferences.renovateReviewDay !== "hidden" && renovateReviewDayForDate(now) === overview.preferences.renovateReviewDay;
      setShowWeeklyRenovateReview(dailyRenovateReviewOverride(overview.viewer.login, now) ?? scheduled);
    };
    updateLocalTime();
    const timer = window.setInterval(updateLocalTime, 60_000);
    return () => window.clearInterval(timer);
  }, [overview.preferences.renovateReviewDay, overview.viewer.login]);

  useEffect(() => {
    try {
      setWelcomeVisible(window.localStorage.getItem(firstRunWelcomeKey(overview.viewer.login)) !== "acknowledged");
    } catch {
      setWelcomeVisible(true);
    }
  }, [overview.viewer.login]);

  useEffect(() => {
    const requestedView = new URLSearchParams(window.location.search).get("myWork");
    if (MY_WORK_VIEW_OPTIONS.some((option) => option.value === requestedView)) setMyWorkView(requestedView as MyWorkView);
  }, []);

  useEffect(() => {
    try {
      const savedSort = window.localStorage.getItem(myWorkSortKey(overview.viewer.login));
      setMyWorkSort(MY_WORK_SORT_OPTIONS.some((option) => option.value === savedSort) ? savedSort as MyWorkSort : "priority");
    } catch {
      setMyWorkSort("priority");
    }
  }, [overview.viewer.login]);

  useEffect(() => {
    try {
      const savedValue = window.localStorage.getItem(overviewCardOrderKey(overview.viewer.login))
        ?? window.localStorage.getItem(legacyOverviewCardOrderKey(overview.viewer.login))
        ?? "[]";
      const saved = JSON.parse(savedValue) as unknown;
      if (!Array.isArray(saved)) return;
      const valid = saved.filter((id): id is OverviewCardId => typeof id === "string" && DEFAULT_OVERVIEW_CARD_ORDER.includes(id as OverviewCardId));
      const unique = [...new Set(valid)];
      if (!unique.length) {
        setCardOrder(DEFAULT_OVERVIEW_CARD_ORDER);
        return;
      }
      if (!unique.includes("uds-cli")) {
        const peprIndex = unique.indexOf("pepr");
        unique.splice(peprIndex >= 0 ? peprIndex + 1 : unique.length, 0, "uds-cli");
      }
      setCardOrder([...unique, ...DEFAULT_OVERVIEW_CARD_ORDER.filter((id) => !unique.includes(id))]);
    } catch {
      // Keep the default order when browser preferences are unavailable or invalid.
    }
  }, [overview.viewer.login]);

  const updateCardOrder = (next: OverviewCardId[]) => {
    setCardOrder(next);
    window.localStorage.setItem(overviewCardOrderKey(overview.viewer.login), JSON.stringify(next));
  };

  const handleCardDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const previousIndex = cardOrder.indexOf(active.id as OverviewCardId);
    const nextIndex = cardOrder.indexOf(over.id as OverviewCardId);
    if (previousIndex < 0 || nextIndex < 0) return;
    updateCardOrder(arrayMove(cardOrder, previousIndex, nextIndex));
  };

  const jumpToRenovateReview = () => {
    setRenovateCheckFilter("priority");
    document.getElementById("renovate-review")?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  };

  const dismissWelcome = () => {
    try {
      window.localStorage.setItem(firstRunWelcomeKey(overview.viewer.login), "acknowledged");
    } catch {
      // Keep the welcome dismissed for this view when browser storage is unavailable.
    }
    setWelcomeVisible(false);
  };

  const startWithMyWork = () => {
    dismissWelcome();
    window.setTimeout(() => document.getElementById("my-work-today")?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" }), 50);
  };

  const updateMyWorkSort = (sort: MyWorkSort) => {
    setMyWorkSort(sort);
    try {
      window.localStorage.setItem(myWorkSortKey(overview.viewer.login), sort);
    } catch {
      // Keep the selected sort for this view when browser storage is unavailable.
    }
  };

  const removeSelectedMyWork = (items: MyWorkQueueItem[]) => {
    const withoutPersonalReferences = removeReferencesFromPersonalWork(personalWorkState, items.map((item) => item.reference));
    const hiddenRecommendations = { ...withoutPersonalReferences.hiddenRecommendations };
    items.forEach((item) => {
      if (item.recommended && item.pull) hiddenRecommendations[myWorkItemKey(item.pull)] = myWorkItemFingerprint(item.pull);
    });
    onPersonalWorkStateChange(
      { ...withoutPersonalReferences, hiddenRecommendations },
      `${items.length} ${items.length === 1 ? "item was" : "items were"} removed from My work today.`,
    );
    setSelectedMyWork([]);
  };

  const editSelectedMyWorkNote = (item: MyWorkQueueItem) => {
    setNoteReference(item.reference);
    setNoteValue(item.note ?? "");
  };

  const saveMyWorkNote = () => {
    if (!noteReference) return;
    const referenceExists = personalWorkState.references.some((reference) => personalWorkReferenceKey(reference) === personalWorkReferenceKey(noteReference));
    const stateWithReference = referenceExists ? personalWorkState : { ...personalWorkState, references: [...personalWorkState.references, noteReference] };
    onPersonalWorkStateChange(updatePersonalWorkNote(stateWithReference, noteReference, noteValue), "The personal follow-up note was saved.");
    setNoteReference(null);
    setNoteValue("");
  };

  const restoreMyWorkItem = (pull: MyWorkPull) => {
    const hiddenRecommendations = { ...personalWorkState.hiddenRecommendations };
    delete hiddenRecommendations[myWorkItemKey(pull)];
    onPersonalWorkStateChange({ ...personalWorkState, hiddenRecommendations }, "The recommendation was restored to My work today.");
  };

  const restoreAllMyWork = (pulls: MyWorkPull[]) => {
    const hiddenRecommendations = { ...personalWorkState.hiddenRecommendations };
    pulls.forEach((pull) => delete hiddenRecommendations[myWorkItemKey(pull)]);
    onPersonalWorkStateChange({ ...personalWorkState, hiddenRecommendations }, `${pulls.length} ${pulls.length === 1 ? "recommendation was" : "recommendations were"} restored to My work today.`);
    setHiddenMyWorkOpen(false);
  };

  const setRenovateReviewVisibleForToday = (visible: boolean, scrollToReview = false) => {
    try {
      window.localStorage.setItem(renovateReviewVisibilityKey(overview.viewer.login), JSON.stringify({ date: localDateKey(new Date()), visible }));
    } catch {
      // Keep the manual visibility choice for this view when browser storage is unavailable.
    }
    setShowWeeklyRenovateReview(visible);
    if (visible && scrollToReview) window.setTimeout(jumpToRenovateReview, 50);
  };

  const activeBriefingSince = new Date(new Date(overview.generatedAt).getTime() - 86_400_000).toISOString();
  const briefingItems = overview.briefing.items.filter((item) => new Date(item.timestamp).getTime() >= new Date(activeBriefingSince).getTime());
  const briefingWaiting = briefingItems.filter((item) => item.type === "review-request" || item.type === "pull-assigned").length;
  const briefingProgress = briefingItems.filter((item) => item.type === "pull-approved" || item.type === "pull-merged" || item.type === "ready-to-merge").length;
  const briefingFailures = briefingItems.filter((item) => item.type === "workflow-failure").length;
  const briefingRecoveries = briefingItems.filter((item) => item.type === "workflow-recovery").length;
  const primaryFailure = overview.workflowFailures[0];
  const primaryFailureContext = primaryFailure
    ? primaryFailure.blocksPullRequest
      ? `${primaryFailure.repository.split("/").pop()} is blocking PR #${primaryFailure.blocksPullRequest}.`
      : primaryFailure.defaultBranch
        ? `The default branch for ${primaryFailure.repository.split("/").pop()} is failing.`
        : `${primaryFailure.branch ?? "A non-default branch"} is failing in ${primaryFailure.repository.split("/").pop()}.`
    : passingPipelines ? "Default branch workflows are passing." : "No workflow failures need attention.";
  const recommendedWorkItems = [...new Map([
    ...overview.myWork.waitingOnMe,
    ...overview.myWork.blocked,
    ...overview.myWork.readyToMerge,
    ...overview.myWork.waitingOnOthers,
    ...overview.myWork.needsOwnership,
  ].map((pull) => [myWorkItemKey(pull), pull])).values()];
  const recommendedMyWorkKeys = new Set(recommendedWorkItems.map(myWorkItemKey));
  const referencesByKey = new Map(personalWorkState.references.map((reference) => [personalWorkReferenceKey(reference), reference]));
  const referenceForPull = (pull: MyWorkPull) => personalWorkReferenceForPull(pull, overview.generatedAt);
  const referenceForIssue = (issue: Issue & { repository: string }) => personalWorkReferenceForIssue(issue, overview.generatedAt);
  const referenceForRun = (run: PipelineRun & { repository: string }) => personalWorkReferenceForWorkflow(run, overview.generatedAt);
  const pullByReference = new Map(overview.pullRequests.map((pull) => [personalWorkReferenceKey(referenceForPull(pull)), pull]));
  const issueByReference = new Map(overview.issues.map((issue) => [personalWorkReferenceKey(referenceForIssue(issue)), issue]));
  const runByReference = new Map(overview.pipelineRuns.map((run) => [personalWorkReferenceKey(referenceForRun(run)), run]));
  const securityByReference = new Map((securityWorkspace?.repositories ?? []).flatMap((repository) => repository.findings.map((finding) => [personalWorkReferenceKey(personalWorkReferenceForSecurityFinding(finding, overview.generatedAt)), { finding, repository }] as const)));
  const personalMyWorkKeys = new Set(personalWorkState.references.map(personalWorkReferenceKey));

  const pullQueueItem = (pull: MyWorkPull, recommended: boolean): MyWorkQueueItem => {
    const generatedReference = referenceForPull(pull);
    const reference = referencesByKey.get(personalWorkReferenceKey(generatedReference)) ?? generatedReference;
    const status = myWorkStatusForPull(pull);
    const waitingOn = myWorkWaitingOn(pull);
    const addedByViewer = referencesByKey.has(personalWorkReferenceKey(generatedReference));
    return { key: personalWorkReferenceKey(generatedReference), reference, kind: "pull-request", repository: pull.repository, title: pull.title, detail: `Pull request #${pull.number} · by ${pull.author}`, url: pull.url, ...status, reason: reference.note || myWorkReason(pull, addedByViewer && !recommended), waitingOn: waitingOn?.label ?? null, updatedAt: pull.updatedAt, recommended, addedByViewer, note: reference.note ?? null, pull };
  };
  const personalQueueItems = personalWorkState.references.flatMap((reference): MyWorkQueueItem[] => {
    if (reference.kind === "pull-request") {
      const pull = pullByReference.get(personalWorkReferenceKey(reference));
      return pull ? [pullQueueItem(pull, recommendedMyWorkKeys.has(myWorkItemKey(pull)))] : [];
    }
    if (reference.kind === "issue") {
      const issue = issueByReference.get(personalWorkReferenceKey(reference));
      return issue ? [{ key: personalWorkReferenceKey(reference), reference, kind: "issue", repository: issue.repository, title: issue.title, detail: `Issue #${issue.number} · by ${issue.author}`, url: issue.url, status: "Open issue", statusType: "warning", reason: reference.note || "Added by you for personal follow-up.", waitingOn: issue.assignees?.length ? issue.assignees.join(", ") : "Owner", updatedAt: issue.updatedAt, priority: 3, recommended: false, addedByViewer: true, note: reference.note ?? null, issue }] : [];
    }
    if (reference.kind === "workflow") {
      const run = runByReference.get(personalWorkReferenceKey(reference));
      if (!run) return [];
      const failed = pipelineStatusForMyWork(run) === "Failed";
      const failure = overview.workflowFailures.find((candidate) => candidate.repository === run.repository && candidate.id === run.id);
      return [{ key: personalWorkReferenceKey(reference), reference, kind: "workflow", repository: run.repository, title: run.title, detail: `${run.name} #${run.number}`, url: run.url, status: pipelineStatusForMyWork(run), statusType: run.status !== "completed" ? "in-progress" : failed ? "error" : run.conclusion === "success" ? "success" : "stopped", reason: reference.note || (failed ? "Workflow execution requires investigation." : run.status !== "completed" ? "Workflow execution is still running." : "Added by you for personal follow-up."), waitingOn: run.status !== "completed" ? "Workflow completion" : failed ? "Investigation" : null, updatedAt: run.updatedAt, priority: failed ? 0 : run.status !== "completed" ? 2 : 5, recommended: false, addedByViewer: true, note: reference.note ?? null, run, failure }];
    }
    const securityItem = securityByReference.get(personalWorkReferenceKey(reference));
    if (!securityItem) return [];
    const { finding, repository } = securityItem;
    const vulnerability = repository.vulnerabilities[finding.vulnerabilityId];
    if (!vulnerability) return [];
    return [{ key: personalWorkReferenceKey(reference), reference, kind: "security-finding", repository: finding.repositoryId, title: `${vulnerability.id}: ${vulnerability.summary}`, detail: `${finding.affectedPackage} ${finding.installedVersion ?? "version unknown"}`, url: vulnerability.references[0] ?? `/repositories/${finding.repositoryId}?tab=security`, status: `${finding.severity.charAt(0).toUpperCase()}${finding.severity.slice(1)} severity`, statusType: finding.severity === "critical" ? "error" : finding.severity === "high" || finding.severity === "medium" ? "warning" : "info", reason: reference.note || (finding.fixedVersion ? `Update to ${finding.fixedVersion}.` : "Review the advisory; no fixed version is reported."), waitingOn: finding.fixedVersion ? "Package update" : "Maintainer decision", updatedAt: finding.lastSeenAt, priority: finding.severity === "critical" ? 0 : finding.severity === "high" ? 1 : 3, recommended: false, addedByViewer: true, note: reference.note ?? null, security: { finding, vulnerability, repository } }];
  });
  const hiddenWorkItems = recommendedWorkItems.filter((pull) => !personalMyWorkKeys.has(personalWorkReferenceKey(referenceForPull(pull))) && isMyWorkItemHidden(pull, personalWorkState.hiddenRecommendations));
  const recommendedQueueItems = recommendedWorkItems.filter((pull) => !isMyWorkItemHidden(pull, personalWorkState.hiddenRecommendations) || personalMyWorkKeys.has(personalWorkReferenceKey(referenceForPull(pull)))).map((pull) => pullQueueItem(pull, true));
  const workQueue = [...new Map([...recommendedQueueItems, ...personalQueueItems].map((item) => [item.key, item])).values()];
  const filteredWorkItems = workQueue.filter((item) => myWorkView === "all" || myWorkView === "recommended" && item.recommended || myWorkView === "added" && item.addedByViewer || item.kind === myWorkView);
  const visibleWorkItems = [...filteredWorkItems].sort((left, right) => myWorkSort === "updated" ? new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime() : myWorkSort === "repository" ? left.repository.localeCompare(right.repository) || new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime() : myWorkSort === "status" ? left.status.localeCompare(right.status) || new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime() : left.priority - right.priority || new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
  const selectedMyWorkKeys = new Set(selectedMyWork.map((item) => item.key));
  const selectedCurrentMyWork = visibleWorkItems.filter((item) => selectedMyWorkKeys.has(item.key));
  const selectedMyWorkSort = MY_WORK_SORT_OPTIONS.find((option) => option.value === myWorkSort) ?? MY_WORK_SORT_OPTIONS[0];
  const selectedMyWorkView = MY_WORK_VIEW_OPTIONS.find((option) => option.value === myWorkView) ?? MY_WORK_VIEW_OPTIONS[0];
  const myWorkCount = workQueue.length + overview.myWork.assignedIssues.length;
  const currentMyWorkFingerprints = JSON.stringify(recommendedWorkItems.map((pull) => [myWorkItemKey(pull), myWorkItemFingerprint(pull)]));

  useEffect(() => {
    const current = new Map(JSON.parse(currentMyWorkFingerprints) as [string, string][]);
    const changedKeys = Object.keys(personalWorkState.hiddenRecommendations).filter((key) => current.has(key) && current.get(key) !== personalWorkState.hiddenRecommendations[key]);
    if (!changedKeys.length) return;
    const hiddenRecommendations = { ...personalWorkState.hiddenRecommendations };
    changedKeys.forEach((key) => delete hiddenRecommendations[key]);
    onPersonalWorkStateChange({ ...personalWorkState, hiddenRecommendations });
  }, [currentMyWorkFingerprints, onPersonalWorkStateChange, personalWorkState]);

  const trackedRepositoryNames = new Set(overview.repositories.map((repository) => repository.fullName.toLowerCase()));
  const lifecycleSignature = JSON.stringify(personalWorkState.references.map((reference) => {
    const key = personalWorkReferenceKey(reference);
    if (!trackedRepositoryNames.has(reference.repository.toLowerCase())) return [key, "untracked"];
    if (reference.kind === "pull-request") return [key, pullByReference.has(key) ? "open" : "closed"];
    if (reference.kind === "issue") return [key, issueByReference.has(key) ? "open" : "closed"];
    if (reference.kind === "workflow") return [key, runByReference.has(key) ? "active" : "missing"];
    const securityRepository = securityWorkspace?.repositories.find((repository) => repository.repositoryId.toLowerCase() === reference.repository.toLowerCase());
    if (!securityRepository || securityRepository.state !== "ready") return [key, "pending"];
    return [key, securityByReference.has(key) ? "open" : "resolved"];
  }));

  useEffect(() => {
    const lifecycle = new Map(JSON.parse(lifecycleSignature) as [string, string][]);
    const references = personalWorkState.references.filter((reference) => !["untracked", "closed", "missing", "resolved"].includes(lifecycle.get(personalWorkReferenceKey(reference)) ?? "pending"));
    if (references.length === personalWorkState.references.length) return;
    onPersonalWorkStateChange({ ...personalWorkState, references });
  }, [lifecycleSignature, onPersonalWorkStateChange, personalWorkState]);

  const openMyWorkItem = (item: MyWorkQueueItem) => {
    if (item.pull) return openDrawer({ type: "pull-request", pull: item.pull, repository: item.repository });
    if (item.issue) return openDrawer({ type: "issue", issue: item.issue, repository: item.repository });
    if (item.run) return openDrawer(item.failure ? { type: "workflow-failure", failure: item.failure } : { type: "pipeline-run", run: item.run, repository: item.repository });
    if (item.security) {
      const { finding, vulnerability, repository } = item.security;
      const occurrences = repository.findings.filter((candidate) => candidate.vulnerabilityId === finding.vulnerabilityId);
      const exposure = repository.applications.find((application) => application.id === finding.applicationId)?.exposure;
      return openDrawer({ type: "security-finding", repository: item.repository, finding, vulnerability, occurrences, exposure });
    }
  };

  const scheduledRenovateUpdates = sortRenovateUpdates(overview.renovate.pulls);
  const majorRenovateTotal = scheduledRenovateUpdates.filter(isMajorRenovateUpdate).length;
  const renovatePipelineFilterOptions = renovateCheckFilterOptions(scheduledRenovateUpdates);
  const selectedRenovateCheckFilter = renovatePipelineFilterOptions.find((option) => option.value === renovateCheckFilter) ?? renovatePipelineFilterOptions[0];
  const visibleRenovateUpdates = filterRenovateUpdatesByCheck(scheduledRenovateUpdates, renovateCheckFilter);
  if (!overview.repositories.length) {
    return (
      <ContentLayout header={<Header variant="h1" actions={<SpaceBetween direction="horizontal" size="s"><DataFreshness generatedAt={overview.generatedAt} refreshing={refreshing} stale={Boolean(refreshError)} /><Button iconName="refresh" variant="icon" ariaLabel="Refresh data" loading={refreshing} onClick={refresh} /></SpaceBetween>}>{greeting}, {viewerFirstName(overview.viewer)}!</Header>}>
        <Container><EmptyState title="No repositories selected" detail="Choose repositories in Workspace settings. UDS Scout will not aggregate other repositories available to your GitHub token." /><Box textAlign="center"><PrimaryActionButton onClick={() => navigate("/settings/repositories")}>Manage GitHub repositories</PrimaryActionButton></Box></Container>
      </ContentLayout>
    );
  }

  const cards: Record<OverviewCardId, React.ReactNode> = {
    "pull-requests": <MetricCard title="Waiting on me" value={overview.myWork.waitingOnMe.length} description={overview.myWork.waitingOnMe.length ? "Reviews or changes need your attention." : "No reviews or changes need you."} onDetails={() => openDrawer({ type: "my-work", queue: "waiting-on-me" })} indicator={overview.myWork.waitingOnMe.length ? { type: "warning", label: "Needs you" } : undefined} />,
    renovate: (
      <MetricCard
        title="Major Renovate updates"
        value={majorRenovateTotal}
        description={majorRenovateTotal
          ? `${majorRenovateTotal} of ${overview.renovate.total} open ${overview.renovate.total === 1 ? "update includes" : "updates include"} a major version change.`
          : overview.renovate.total
            ? `No major changes detected across ${overview.renovate.total} open ${overview.renovate.total === 1 ? "update" : "updates"}.`
            : "No open Renovate updates."}
        info={<PanelInfo header="Major Renovate updates">This card counts only pull requests that Renovate identifies as major or that contain an explicit leading-version increase. View details opens a focused list of those pull requests, with a link to the full Renovate table.</PanelInfo>}
        onDetails={() => openDrawer({ type: "renovate", majorOnly: true })}
        errorValue={majorRenovateTotal > 0}
        indicator={majorRenovateTotal ? { type: "warning", label: "Major version review available" } : undefined}
      />
    ),
    issues: <MetricCard title="Issues assigned to me" value={overview.myWork.assignedIssues.length} description={overview.myWork.assignedIssues.length ? "Assigned issues need follow-up." : "No assigned issues need action."} onDetails={() => openDrawer({ type: "my-work", queue: "assigned-issues" })} />,
    pipelines: <MetricCard title="Workflow failures" value={overview.metrics.pipelineFailures ? `${overview.metrics.pipelineFailures} unresolved` : "None"} description={primaryFailureContext} onDetails={() => openDrawer({ type: "pipelines" })} attention={overview.workflowFailures.some((failure) => failure.defaultBranch || failure.blocksPullRequest)} indicator={overview.metrics.pipelineFailures ? { type: "error", label: "Needs investigation" } : undefined} />,
    "uds-versions": overview.capabilities.sonic ? (
      <MetricCard
        title="UDS versions"
        value={<span className="uds-version-pair"><VersionComparison label="UDS Core" current={overview.udsCore.version ?? "Unavailable"} target={overview.udsCore.upstreamVersion} outdated={overview.udsCore.comparison === "behind"} aligned={overview.udsCore.comparison === "current"} onClick={() => openDrawer({ type: "uds-core" })} /><VersionComparison label="UDS Common" current={commonDisplayedVersion} target={overview.udsCommon.latestVersion} outdated={commonOutdated} aligned={!commonOutdated && Boolean(overview.udsCommon.latestVersion)} onClick={() => openDrawer({ type: "uds-common" })} /></span>}
        description="Core and Common alignment."
        onDetails={() => openDrawer({ type: "uds-versions" })}
        indicator={udsWarningLabel ? { type: "warning", label: udsWarningLabel } : overview.udsCore.comparison === "ahead" ? { type: "info", label: "Core differs from upstream" } : { type: "success", label: "Versions aligned" }}
      />
    ) : (
      <MetricCard
        title="UDS versions"
        value={<span className="uds-version-pair"><VersionComparison label="UDS Core" current={overview.udsCore.upstreamVersion ?? "Unavailable"} outdated={false} aligned={Boolean(overview.udsCore.upstreamVersion)} onClick={() => openDrawer({ type: "uds-core" })} /><VersionComparison label="UDS Common" current={overview.udsCommon.latestVersion ?? "Unavailable"} outdated={false} aligned={Boolean(overview.udsCommon.latestVersion)} onClick={() => openDrawer({ type: "uds-common" })} /></span>}
        description="Latest Core and Common releases."
        onDetails={() => openDrawer({ type: "uds-versions" })}
      />
    ),
    reviews: <MetricCard title="Ready to merge" value={overview.myWork.readyToMerge.length} description={overview.myWork.readyToMerge.length ? "Approvals and required checks are complete." : "No approved pull requests are waiting to merge."} onDetails={() => openDrawer({ type: "my-work", queue: "ready-to-merge" })} successHighlight={overview.myWork.readyToMerge.length > 0} indicator={overview.myWork.readyToMerge.length ? { type: "success", label: "Ready" } : undefined} />,
    zarf: <MetricCard title="Zarf version" value={<ToolVersion release={overview.tools.zarf} generatedAt={overview.generatedAt} className="metric-value-zarf" />} description="Latest release." onDetails={() => openDrawer({ type: "tool-release", tool: "zarf" })} />,
    pepr: <MetricCard title="Pepr version" value={<ToolVersion release={overview.tools.pepr} generatedAt={overview.generatedAt} className="metric-value-pepr" />} description="Latest release." onDetails={() => openDrawer({ type: "tool-release", tool: "pepr" })} />,
    "uds-cli": <MetricCard title="UDS CLI version" value={<ToolVersion release={overview.tools.udsCli} generatedAt={overview.generatedAt} className="metric-value-uds-cli" />} description="Latest release." onDetails={() => openDrawer({ type: "tool-release", tool: "udsCli" })} />,
    "uds-packages": <MetricCard
      title="UDS Packages repositories"
      value={repositoryCatalog ? <span className="metric-value-uds-packages">{repositoryCatalog.metrics.total}</span> : repositoryCatalogLoading ? <Spinner /> : "Unavailable"}
      description={repositoryCatalog ? `${repositoryCatalog.metrics.private} private · ${repositoryCatalog.metrics.public} public` : "Private and public repositories in uds-packages."}
      onDetails={() => navigate("/uds-packages")}
      indicator={repositoryCatalogError ? { type: "warning", label: "Catalog refresh unavailable" } : repositoryCatalog ? { type: "info", label: "Catalog available" } : { type: "pending", label: "Loading repository catalog" }}
    />,
  };

  return (
    <>
    <ContentLayout
      header={
        <Header
          variant="h1"
          description="Scout tells you what matters across all your repositories. GitHub only tells you what's happening inside one. Go Fight Win!"
          actions={<SpaceBetween direction="horizontal" size="s"><DataFreshness generatedAt={overview.generatedAt} refreshing={refreshing} stale={Boolean(refreshError)} />{customizeCardsOpen ? <PrimaryActionButton iconName="check" onClick={() => setCustomizeCardsOpen(false)}>Done</PrimaryActionButton> : <Button iconName="drag-indicator" onClick={() => setCustomizeCardsOpen(true)}>Customize cards</Button>}<Button iconName="refresh" variant="icon" ariaLabel="Refresh data" loading={refreshing} onClick={refresh} /></SpaceBetween>}
        >
          {greeting}, {viewerFirstName(overview.viewer)}!
        </Header>
      }
    >
      <SpaceBetween size="l">
        {customizeCardsOpen ? (
          <Flashbar items={[{
            type: "info",
            header: "Rearrange overview cards",
            content: "Drag a card by its handle to move it. Keyboard users can focus a handle, press Space, and use the arrow keys.",
            action: <div className="flashbar-centered-action"><Button onClick={() => updateCardOrder(DEFAULT_OVERVIEW_CARD_ORDER)}>Reset order</Button></div>,
          }]} />
        ) : null}

        <div id="my-work-today" className="overview-scroll-target"><Table
          variant="container"
          className="my-work-table"
          stickyHeader
          wrapLines
          trackBy="key"
          selectionType="multi"
          selectedItems={selectedCurrentMyWork}
          onSelectionChange={({ detail }) => setSelectedMyWork([...detail.selectedItems])}
          ariaLabels={{ selectionGroupLabel: "Select work items", itemSelectionLabel: ({ selectedItems }, item) => `${selectedItems.includes(item) ? "Deselect" : "Select"} ${item.title}` }}
          header={<Header variant="h2" info={<PanelInfo header="My work today">This browser-local personal queue combines Scout recommendations with pull requests, issues, workflows, and security findings you add from other views. Select one or more items to remove them or add a private follow-up note. Scout recommendations can return when their actionable state changes; closed pull requests, closed issues, resolved findings, and unavailable old workflow runs leave the queue when Scout confirms their state.</PanelInfo>} actions={<button type="button" className={`renovate-review-beacon${showWeeklyRenovateReview ? "" : " renovate-review-beacon-inactive"}`} aria-label={showWeeklyRenovateReview ? "Jump to Renovate review" : "Show Renovate review for today"} title={showWeeklyRenovateReview ? "Jump to Renovate review" : "Show Renovate review for today"} onClick={showWeeklyRenovateReview ? jumpToRenovateReview : () => setRenovateReviewVisibleForToday(true, true)} />}><span className="section-heading section-heading-my-work">My work today <span className="section-heading-count">({myWorkCount})</span></span></Header>}
          filter={<div className="my-work-toolbar"><div className="my-work-filters"><div className="my-work-sort"><Select ariaLabel="Filter My work today" selectedOption={selectedMyWorkView} options={MY_WORK_VIEW_OPTIONS} onChange={({ detail }) => { setMyWorkView(detail.selectedOption.value as MyWorkView); setSelectedMyWork([]); }} /></div><div className="my-work-sort"><Select ariaLabel="Sort My work today" selectedOption={selectedMyWorkSort} options={MY_WORK_SORT_OPTIONS} onChange={({ detail }) => updateMyWorkSort(detail.selectedOption.value as MyWorkSort)} /></div></div><div className="my-work-toolbar-actions">{selectedCurrentMyWork.length === 1 ? <Button onClick={() => editSelectedMyWorkNote(selectedCurrentMyWork[0])}>{selectedCurrentMyWork[0].note ? "Edit note" : "Add note"}</Button> : null}{selectedCurrentMyWork.length ? <Button onClick={() => removeSelectedMyWork(selectedCurrentMyWork)}>{`Remove selected (${selectedCurrentMyWork.length})`}</Button> : null}{hiddenWorkItems.length ? <Button onClick={() => setHiddenMyWorkOpen(true)}>{hiddenWorkItems.length} hidden</Button> : null}{overview.myWork.assignedIssues.length ? <Button onClick={() => openDrawer({ type: "my-work", queue: "assigned-issues" })}>{overview.myWork.assignedIssues.length} assigned {overview.myWork.assignedIssues.length === 1 ? "issue" : "issues"}</Button> : null}</div></div>}
          items={visibleWorkItems}
          columnDefinitions={[
            { id: "work", header: "Work item", width: "29%", minWidth: 280, cell: (item) => <SpaceBetween size="xxs"><Link href={item.url} onFollow={(event) => { event.preventDefault(); openMyWorkItem(item); }}>{item.title}</Link><Box color="text-body-secondary">{item.repository} · {item.detail}{item.addedByViewer ? " · added by me" : ""}</Box></SpaceBetween> },
            { id: "state", header: "Status", width: "21%", minWidth: 220, cell: (item) => <StatusIndicator type={item.statusType}>{item.status}</StatusIndicator> },
            { id: "why", header: "Why it is here", width: "25%", minWidth: 250, cell: (item) => item.reason },
            { id: "waiting", header: "Waiting on", width: "15%", minWidth: 150, cell: (item) => item.waitingOn ?? <Box color="text-body-secondary">—</Box> },
            { id: "updated", header: "Last updated", width: "10%", minWidth: 100, cell: (item) => relativeTime(item.updatedAt, overview.generatedAt) },
          ]}
          empty={workQueue.length
            ? <EmptyState title="No work matches this filter" detail="Choose another work type or queue source." />
            : hiddenWorkItems.length ? <EmptyState title="No visible recommendations" detail="All current recommendations are hidden from your personal queue." />
              : <EmptyState title="No action required" detail="Your selected-repository queue is clear." />}
        /></div>

        {briefingItems.length ? (
          <Container header={<Header variant="h2" description="Changes detected in the last 24 hours." actions={<Button onClick={() => openDrawer({ type: "briefing", since: activeBriefingSince })}>View details</Button>}><span className="section-heading section-heading-briefing">Since yesterday <span className="section-heading-count">({briefingItems.length})</span></span></Header>}>
            <div className="briefing-summary-grid">
              <SpaceBetween size="xxs"><Box variant="awsui-key-label">WAITING ON YOU</Box><Box variant="awsui-value-large">{briefingWaiting}</Box></SpaceBetween>
              <SpaceBetween size="xxs"><Box variant="awsui-key-label">PR PROGRESS</Box><Box variant="awsui-value-large">{briefingProgress}</Box></SpaceBetween>
              <SpaceBetween size="xxs"><Box variant="awsui-key-label">WORKFLOW CHANGES</Box><Box variant="awsui-value-large">{briefingFailures + briefingRecoveries}</Box></SpaceBetween>
              <SpaceBetween size="xxs"><Box variant="awsui-key-label">ASSIGNED ISSUES</Box><Box variant="awsui-value-large">{briefingItems.filter((item) => item.type === "issue-assigned").length}</Box></SpaceBetween>
            </div>
          </Container>
        ) : null}

        <DndContext sensors={cardDragSensors} collisionDetection={closestCenter} onDragEnd={handleCardDragEnd}>
          <SortableContext items={cardOrder} strategy={rectSortingStrategy}>
            <Grid gridDefinition={cardOrder.map(() => ({ colspan: { default: 12, xs: 6, l: 4 } }))}>
              {cardOrder.map((id) => <SortableOverviewCard id={id} label={OVERVIEW_CARD_LABELS[id]} customizing={customizeCardsOpen} key={id}>{cards[id]}</SortableOverviewCard>)}
            </Grid>
          </SortableContext>
        </DndContext>

        {showWeeklyRenovateReview ? (
          <div id="renovate-review" className="renovate-review-section">
            <RenovateUpdatesTable
              referenceTime={overview.generatedAt}
              openDrawer={openDrawer}
              filter={<div className="renovate-review-filter"><Select selectedOption={selectedRenovateCheckFilter} options={renovatePipelineFilterOptions} onChange={({ detail }) => setRenovateCheckFilter(detail.selectedOption.value as RenovateCheckFilter)} /></div>}
              header={<Header variant="h2" description="Major version updates first, then failed or cancelled, running, passed, and updates with no checks." info={<PanelInfo header="Renovate review">This queue includes all open Renovate pull requests. It appears on the scheduled review day or when shown manually for today.</PanelInfo>} actions={<SpaceBetween direction="horizontal" size="s"><Button onClick={() => setRenovateReviewVisibleForToday(false)}>Hide review</Button><Button onClick={() => navigate("/renovate?view=all")}>Open full list</Button></SpaceBetween>}><span className="section-heading">Renovate review <span className="section-heading-count">({visibleRenovateUpdates.length}{renovateCheckFilter === "all" ? "" : ` of ${scheduledRenovateUpdates.length}`})</span></span></Header>}
              items={visibleRenovateUpdates}
              emptyDetail={renovateCheckFilter === "priority" ? "No failed or major-version updates are open." : renovateCheckFilter === "all" ? "Tracked dependencies are current. Nothing needs review." : renovateCheckFilter === "major" ? "No major version updates are open." : "No updates match this pipeline state."}
            />
          </div>
        ) : null}

        <Table
          variant="container"
          stickyHeader
          stripedRows
          trackBy="id"
          header={<Header variant="h2" counter={`(${overview.repositories.length})`} description="Attention across selected repositories." info={<PanelInfo header="Repository attention">Action required means an observable failure or work waiting on you. Needs attention covers blockers, merge-ready work, and unowned human pull requests. Security appears as an additional repository context signal, with incomplete visibility kept explicit. Routine automation and pull requests labeled stale do not elevate repository attention.</PanelInfo>}>Repository status</Header>}
          items={overview.repositories}
          columnDefinitions={[
            { id: "repository", header: "Repository", cell: (item) => <SpaceBetween size="xxs"><Link href={`/repositories/${item.fullName}`} onFollow={(event) => { event.preventDefault(); openDrawer({ type: "repository", repository: item }); }} fontSize="body-m">{item.name}</Link><Box color="text-body-secondary">{item.fullName.split("/")[0]}</Box></SpaceBetween>, sortingField: "name" },
            { id: "health", header: "Attention", cell: (item) => { const action = repositoryAttentionAction(item, overview); return <SpaceBetween size="xxs">{repositoryHealth(item)}{action ? <Button variant="inline-link" ariaLabel={`${action.label} for ${item.fullName}`} onClick={() => openDrawer(action.selection)}>{item.attention.reason}</Button> : <Box color="text-body-secondary">{item.attention.reason}</Box>}</SpaceBetween>; } },
            { id: "workflow", header: "Pull request workflow", cell: (item) => <SpaceBetween size="xxs"><Box>{item.workflowCounts.waitingOnMe} on you · {item.workflowCounts.blocked} blocked</Box><Box color="text-body-secondary">{item.workflowCounts.readyToMerge} ready · {item.workflowCounts.waitingOnOthers} waiting elsewhere</Box></SpaceBetween> },
            { id: "reviews", header: "Your reviews", cell: (item) => item.reviewRequests ? <Button variant="inline-link" onClick={() => openDrawer({ type: "review-requests", repository: item.fullName })}>{item.reviewRequests} requested</Button> : <Box color="text-body-secondary">None</Box> },
            { id: "pipeline", header: "Default branch workflow", cell: (item) => <Button variant="inline-link" onClick={() => openDrawer({ type: "pipelines", repository: item.fullName })}>{pipelineStatus(item.pipeline)}</Button> },
            { id: "renovate", header: "Renovate attention", cell: (item) => item.unassignedRenovatePulls ? <Link href={`/renovate?repository=${encodeURIComponent(item.fullName)}`} onFollow={(event) => { event.preventDefault(); openDrawer({ type: "renovate", repository: item.fullName, unassignedOnly: true }); }}><Badge color="severity-medium">{item.unassignedRenovatePulls} elevated</Badge></Link> : <Box color="text-body-secondary">Informational</Box> },
            { id: "security", header: "Security context", cell: (item) => {
              const security = securityByRepository.get(item.fullName.toLowerCase());
              if (!security || security.state === "queued" || security.state === "refreshing" || security.state === "pending") return <StatusIndicator type="in-progress">Analyzing</StatusIndicator>;
              if (!security.applicable) return <Box color="text-body-secondary">Not applicable</Box>;
              const hasCoverage = security.applications.some((application) => application.coverage !== "unknown") || security.artifacts.some((artifact) => artifact.securityCoverage.container !== "unavailable");
              const complete = security.applications.every((application) => application.coverage === "full") && security.artifacts.every((artifact) => artifact.securityCoverage.container === "full");
              const appFindings = security.findings.filter((finding) => finding.category === "application");
              const highImpactAppCves = new Set(appFindings.filter((finding) => finding.severity === "critical" || finding.severity === "high").map((finding) => finding.vulnerabilityId));
              const otherAppCves = new Set(appFindings.filter((finding) => finding.severity !== "critical" && finding.severity !== "high").map((finding) => finding.vulnerabilityId));
              const appCritical = appFindings.some((finding) => finding.severity === "critical");
              const severeDependencies = new Set(security.findings.filter((finding) => finding.category !== "application" && (finding.severity === "critical" || finding.severity === "high")).map((finding) => finding.vulnerabilityId));
              const label = highImpactAppCves.size ? `${highImpactAppCves.size} high-impact app CVE${highImpactAppCves.size === 1 ? "" : "s"}` : otherAppCves.size ? `${otherAppCves.size} other app ${otherAppCves.size === 1 ? "advisory" : "advisories"}` : severeDependencies.size ? `${severeDependencies.size} high-impact dependency CVE${severeDependencies.size === 1 ? "" : "s"}` : !hasCoverage ? "Visibility unavailable" : !complete ? "Visibility limited" : "No immediate action";
              return <Button variant="inline-link" onClick={() => navigate(`/repositories/${item.fullName}?tab=security`)}>{appCritical ? <StatusIndicator type="error">{label}</StatusIndicator> : highImpactAppCves.size ? <StatusIndicator type="warning">{label}</StatusIndicator> : otherAppCves.size || severeDependencies.size ? <StatusIndicator type="info">{label}</StatusIndicator> : !complete ? <StatusIndicator type="pending">{label}</StatusIndicator> : <StatusIndicator type="success">{label}</StatusIndicator>}</Button>;
            } },
            { id: "uds-common", header: "UDS Common", cell: (item) => item.udsCommon ? udsCommonStatusAction(item.udsCommon, () => openDrawer({ type: "uds-common", repository: item.fullName })) : <Box color="text-body-secondary">Not applicable</Box> },
          ]}
          empty={<EmptyState title="No repositories configured" detail="Add repositories to the tracked repository configuration." />}
        />

        {overview.capabilities.gitlab && gitLabError && gitLabWorkItems ? (
          <Flashbar items={[{
            type: "warning",
            header: "Gitlab work items could not be refreshed",
            content: "Showing the last successfully loaded Gitlab work item list.",
          }]} />
        ) : null}

        {overview.capabilities.gitlab ? <Table
          variant="container"
          stickyHeader
          stripedRows
          trackBy="id"
          loading={gitLabLoading && !gitLabWorkItems}
          loadingText="Loading assigned Gitlab work items"
          header={
            <Header
              variant="h2"
              counter={gitLabWorkItems ? `(${gitLabWorkItems.items.length})` : undefined}
              description={gitLabWorkItems ? `Open work assigned to ${gitLabWorkItems.viewer.username}, newest created first.` : "Open work assigned to you in Gitlab."}
              actions={<SpaceBetween direction="horizontal" size="s"><Button onClick={() => navigate("/gitlab/tickets")}>Create tickets</Button>{gitLabWorkItems ? <Button href={gitLabWorkItems.dashboardUrl} external>Open Gitlab board</Button> : null}</SpaceBetween>}
            >
              My Gitlab work items
            </Header>
          }
          items={gitLabWorkItems?.items ?? []}
          columnDefinitions={[
            {
              id: "work-item",
              header: "Work item",
              cell: (item) => <SpaceBetween size="xxs"><Link href={item.url} external fontSize="body-m">{item.title}</Link><Box color="text-body-secondary">{item.reference} · {item.type.replace(/_/g, " ")}{item.confidential ? " · confidential" : ""}</Box></SpaceBetween>,
              sortingField: "title",
            },
            { id: "project", header: "Project", cell: (item) => item.project, sortingField: "project" },
            { id: "status", header: "Status", cell: (item) => gitLabWorkItemStatus(item.status) },
            { id: "labels", header: "Labels", cell: (item) => item.labels.length ? <SpaceBetween direction="horizontal" size="xxs">{item.labels.map((label) => <Badge key={label}>{label}</Badge>)}</SpaceBetween> : <Box color="text-body-secondary">None</Box> },
            { id: "due", header: "Due", cell: (item) => item.dueDate ?? <Box color="text-body-secondary">No due date</Box>, sortingField: "dueDate" },
            { id: "created", header: "Created", cell: (item) => relativeTime(item.createdAt, gitLabWorkItems?.generatedAt ?? overview.generatedAt), sortingField: "createdAt" },
            { id: "updated", header: "Updated", cell: (item) => relativeTime(item.updatedAt, gitLabWorkItems?.generatedAt ?? overview.generatedAt), sortingField: "updatedAt" },
          ]}
          empty={gitLabError
            ? <EmptyState title="Gitlab work items are unavailable" detail={gitLabError} />
            : <EmptyState title="No open work assigned" detail="Your Gitlab work item queue is clear." />}
        /> : null}

      </SpaceBetween>
    </ContentLayout>
    <Modal
      visible={Boolean(noteReference)}
      onDismiss={() => { setNoteReference(null); setNoteValue(""); }}
      closeAriaLabel="Close follow-up note"
      size="medium"
      header="Follow-up note"
      footer={<Box float="right"><SpaceBetween direction="horizontal" size="xs"><Button onClick={() => { setNoteReference(null); setNoteValue(""); }}>Cancel</Button><PrimaryActionButton onClick={saveMyWorkNote}>Save note</PrimaryActionButton></SpaceBetween></Box>}
    >
      <SpaceBetween size="s">
        <Box color="text-body-secondary">Saved only for {overview.viewer.login} in this browser. Use GitHub or Notion for shared or durable context.</Box>
        <Textarea value={noteValue} onChange={({ detail }) => setNoteValue(detail.value.slice(0, 500))} placeholder="What do you need to follow up on?" rows={4} ariaLabel="Follow-up note" />
        <Box color="text-body-secondary">{noteValue.length} / 500</Box>
      </SpaceBetween>
    </Modal>
    <Modal
      visible={hiddenMyWorkOpen}
      onDismiss={() => setHiddenMyWorkOpen(false)}
      closeAriaLabel="Close hidden work"
      size="large"
      header={`Hidden work (${hiddenWorkItems.length})`}
      footer={<Box float="right"><SpaceBetween direction="horizontal" size="xs"><Button onClick={() => setHiddenMyWorkOpen(false)}>Close</Button>{hiddenWorkItems.length ? <Button onClick={() => restoreAllMyWork(hiddenWorkItems)}>Restore all</Button> : null}</SpaceBetween></Box>}
    >
      <SpaceBetween size="m">
        <Box color="text-body-secondary">These recommendations are hidden only for {overview.viewer.login} in this browser. A pull request returns automatically when its actionable state changes.</Box>
        <Table
          variant="embedded"
          trackBy={myWorkItemKey}
          items={hiddenWorkItems}
          columnDefinitions={[
            { id: "work", header: "Work item", cell: (item) => <SpaceBetween size="xxs"><Link href={item.url} onFollow={(event) => { event.preventDefault(); setHiddenMyWorkOpen(false); openDrawer({ type: "pull-request", pull: item, repository: item.repository }); }}>{item.title}</Link><Box color="text-body-secondary">{item.repository} · #{item.number} · by <PullAuthor pull={item} /></Box></SpaceBetween> },
            { id: "state", header: "Status", cell: pullWorkflowStatus },
            { id: "action", header: "Scope", cell: (item) => <Button variant="inline-link" onClick={() => restoreMyWorkItem(item)}>Restore</Button> },
          ]}
          empty={<EmptyState title="No hidden work" detail="Your current recommendations are visible in My work today." />}
        />
      </SpaceBetween>
    </Modal>
    <Modal
      visible={welcomeVisible}
      onDismiss={dismissWelcome}
      closeAriaLabel="Close welcome"
      size="medium"
      header="Welcome to UDS Scout"
      footer={<Box float="right"><SpaceBetween direction="horizontal" size="xs"><Button onClick={dismissWelcome}>Explore dashboard</Button><PrimaryActionButton onClick={startWithMyWork}>Start with My work today</PrimaryActionButton></SpaceBetween></Box>}
    >
      <div className="first-run-welcome">
        {/* eslint-disable-next-line @next/next/no-img-element -- The local mascot is presented without a decorative container. */}
        <img className="first-run-welcome-logo" src="/doug-lg.svg" alt="Doug, the UDS Scout mascot" />
        <SpaceBetween size="m">
          <Box>Scout reduces the status gathering that comes with maintaining packages, so you can focus on the next decision.</Box>
          <SpaceBetween size="xs">
            <Box variant="strong">Start with what needs action</Box>
            <Box color="text-body-secondary">Check <Box variant="strong" display="inline">My work today</Box> first when it has items, then review dashboard panels marked red or yellow.</Box>
          </SpaceBetween>
          <div className="first-run-renovate-tip">
            <button type="button" className="first-run-renovate-logo" aria-label="Show Renovate review for today" onClick={() => { dismissWelcome(); setRenovateReviewVisibleForToday(true, true); }} />
            <Box color="text-body-secondary">Select the Renovate logo at any time to open a focused review of failed or major-version updates.</Box>
          </div>
        </SpaceBetween>
      </div>
    </Modal>
    </>
  );
}
