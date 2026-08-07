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
import Popover from "@cloudscape-design/components/popover";
import Select from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Spinner from "@cloudscape-design/components/spinner";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import Table from "@cloudscape-design/components/table";
import { useEffect, useState } from "react";
import { renovateReviewDayForDate } from "@/lib/renovate-review";
import type { DrawerSelection } from "./operations-types";
import { EmptyState, MetricCard, pipelineStatus, pullWorkflowStatus, relativeTime, repositoryHealth, udsCommonStatus } from "./operations-ui";
import type { GitLabWorkItems, Overview, PullRequest, RepositoryCatalog } from "./types";

function greetingForHour(hour: number) {
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 17) return "Good afternoon";
  if (hour >= 17 && hour < 22) return "Good evening";
  return "Welcome back";
}

type RenovateCheckFilter = "all" | "failed" | "running" | "passed" | "no-checks";

function renovateCheckCategory(pull: PullRequest): Exclude<RenovateCheckFilter, "all"> {
  const { total, rollup } = pull.workflow.checks;
  if (rollup.failing || rollup.cancelled) return "failed";
  if (rollup.pending) return "running";
  if (total) return "passed";
  return "no-checks";
}

const renovateCheckPriority: Record<Exclude<RenovateCheckFilter, "all">, number> = {
  failed: 0,
  running: 1,
  passed: 2,
  "no-checks": 3,
};

function RenovateCheckStatus({ pull }: { pull: PullRequest }) {
  const { total, rollup } = pull.workflow.checks;
  const pendingChecks = rollup.pendingChecks ?? [];
  const failingChecks = rollup.failingChecks ?? rollup.failingNames.map((name) => ({ name, url: null }));
  const cancelledChecks = rollup.cancelledChecks ?? rollup.cancelledNames.map((name) => ({ name, url: null }));
  const completedSummary = `${rollup.passed} passed${rollup.cancelled ? ` · ${rollup.cancelled} cancelled` : ""}${rollup.pending ? ` · ${rollup.pending} running` : ""}`;
  if (rollup.failing) {
    const firstFailure = failingChecks.find((check) => check.url) ?? failingChecks[0];
    return <SpaceBetween size="xxs"><span title={rollup.failingNames.join(", ")}><Link href={firstFailure?.url ?? `${pull.url}/checks`} external ariaLabel={`Open ${rollup.failing === 1 ? firstFailure?.name ?? "failed check" : "first failed check"} for pull request ${pull.number}`}><StatusIndicator type="error">{rollup.failing} failed</StatusIndicator></Link></span><Box color="text-body-secondary">{completedSummary}</Box></SpaceBetween>;
  }
  if (rollup.cancelled) {
    const firstCancellation = cancelledChecks.find((check) => check.url) ?? cancelledChecks[0];
    return <SpaceBetween size="xxs"><span title={rollup.cancelledNames.join(", ")}><Link href={firstCancellation?.url ?? `${pull.url}/checks`} external ariaLabel={`Open ${rollup.cancelled === 1 ? firstCancellation?.name ?? "cancelled check" : "first cancelled check"} for pull request ${pull.number}`}><StatusIndicator type="stopped">{rollup.cancelled} cancelled</StatusIndicator></Link></span><Box color="text-body-secondary">{rollup.passed} of {total} passed</Box></SpaceBetween>;
  }
  if (rollup.pending) {
    const firstPending = pendingChecks.find((check) => check.url) ?? pendingChecks[0];
    return <SpaceBetween size="xxs"><span title={pendingChecks.map((check) => check.name).join(", ")}><Link href={firstPending?.url ?? `${pull.url}/checks`} external ariaLabel={`Open ${rollup.pending === 1 ? firstPending?.name ?? "running check" : "first running check"} for pull request ${pull.number}`}><StatusIndicator type="in-progress">{rollup.pending} running</StatusIndicator></Link></span><Box color="text-body-secondary">{rollup.passed} of {total} passed</Box></SpaceBetween>;
  }
  if (total) return <StatusIndicator type="success">All {total} passed</StatusIndicator>;
  return <StatusIndicator type="pending">No checks reported</StatusIndicator>;
}

function RenovateApprovalStatus({ pull }: { pull: PullRequest }) {
  const { count, required, decision, changesRequestedBy } = pull.workflow.approvals;
  if (changesRequestedBy.length) return <StatusIndicator type="error">Changes requested</StatusIndicator>;
  if (decision === "APPROVED" || (required !== null && required > 0 && count >= required)) return <StatusIndicator type="success">{required ? `${count}/${required} approved` : `${count} approved`}</StatusIndicator>;
  if (required === 0) return <StatusIndicator type="pending">Not required</StatusIndicator>;
  if (required !== null) return <StatusIndicator type="warning">{count}/{required} approved</StatusIndicator>;
  if (decision === "REVIEW_REQUIRED") return <StatusIndicator type="warning">Review required</StatusIndicator>;
  if (count) return <StatusIndicator type="info">{count} approved</StatusIndicator>;
  return <StatusIndicator type="pending">No review state</StatusIndicator>;
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

function PanelInfo({ header, children }: { header: string; children: React.ReactNode }) {
  return (
    <Popover
      header={header}
      content={children}
      dismissButton
      dismissAriaLabel="Close information"
      position="right"
      size="medium"
      triggerType="custom"
    >
      <Button variant="icon" iconName="status-info" ariaLabel={`About ${header}`} />
    </Popover>
  );
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

export function OverviewPage({ overview, refreshing, refreshError, gitLabWorkItems, gitLabLoading, gitLabError, repositoryCatalog, repositoryCatalogLoading, repositoryCatalogError, refresh, openDrawer, navigate }: {
  overview: Overview;
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
  const [renovateCheckFilter, setRenovateCheckFilter] = useState<RenovateCheckFilter>("all");
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
  const udsWarningLabel = overview.udsCommon.needsAttention
    ? "UDS Common versions need alignment"
    : overview.udsCore.comparison === "behind"
      ? "UDS Core version needs alignment"
      : null;

  useEffect(() => {
    const updateLocalTime = () => {
      const now = new Date();
      setGreeting(greetingForHour(now.getHours()));
      setShowWeeklyRenovateReview(overview.preferences.renovateReviewDay !== "hidden" && renovateReviewDayForDate(now) === overview.preferences.renovateReviewDay);
    };
    updateLocalTime();
    const timer = window.setInterval(updateLocalTime, 60_000);
    return () => window.clearInterval(timer);
  }, [overview.preferences.renovateReviewDay]);

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
    document.getElementById("renovate-review")?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
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
  const workQueue = [...new Map([
    ...overview.myWork.waitingOnMe,
    ...overview.myWork.blocked,
    ...overview.myWork.readyToMerge,
    ...overview.myWork.waitingOnOthers,
    ...overview.myWork.needsOwnership,
  ].map((pull) => [pull.id, pull])).values()];
  const myWorkCount = workQueue.length + overview.myWork.assignedIssues.length;
  const scheduledRenovateUpdates = [...overview.renovate.pulls].sort((first, second) => renovateCheckPriority[renovateCheckCategory(first)] - renovateCheckPriority[renovateCheckCategory(second)] || new Date(second.createdAt).getTime() - new Date(first.createdAt).getTime());
  const renovateCheckCounts = scheduledRenovateUpdates.reduce<Record<Exclude<RenovateCheckFilter, "all">, number>>((counts, pull) => {
    counts[renovateCheckCategory(pull)] += 1;
    return counts;
  }, { failed: 0, running: 0, passed: 0, "no-checks": 0 });
  const renovateCheckFilterOptions = [
    { label: `All pipeline states (${scheduledRenovateUpdates.length})`, value: "all" },
    { label: `Failed or cancelled (${renovateCheckCounts.failed})`, value: "failed" },
    { label: `Running (${renovateCheckCounts.running})`, value: "running" },
    { label: `Passed (${renovateCheckCounts.passed})`, value: "passed" },
    { label: `No checks (${renovateCheckCounts["no-checks"]})`, value: "no-checks" },
  ];
  const selectedRenovateCheckFilter = renovateCheckFilterOptions.find((option) => option.value === renovateCheckFilter) ?? renovateCheckFilterOptions[0];
  const visibleRenovateUpdates = renovateCheckFilter === "all" ? scheduledRenovateUpdates : scheduledRenovateUpdates.filter((pull) => renovateCheckCategory(pull) === renovateCheckFilter);
  const routineRenovateTotal = Math.max(0, overview.renovate.total - overview.renovate.unassignedTotal);

  if (!overview.repositories.length) {
    return (
      <ContentLayout header={<Header variant="h1" actions={<SpaceBetween direction="horizontal" size="s"><DataFreshness generatedAt={overview.generatedAt} refreshing={refreshing} stale={Boolean(refreshError)} /><Button iconName="refresh" variant="icon" ariaLabel="Refresh data" loading={refreshing} onClick={refresh} /></SpaceBetween>}>{greeting}, {viewerFirstName(overview.viewer)}!</Header>}>
        <Container><EmptyState title="No repositories selected" detail="Choose repositories in Workspace settings. UDS Scout will not aggregate other repositories available to your GitHub token." /><Box textAlign="center"><span className="workspace-primary-action"><Button onClick={() => navigate("/settings/repositories")} variant="primary">Manage GitHub repositories</Button></span></Box></Container>
      </ContentLayout>
    );
  }

  const cards: Record<OverviewCardId, React.ReactNode> = {
    "pull-requests": <MetricCard title="Waiting on me" value={overview.myWork.waitingOnMe.length} description={overview.myWork.waitingOnMe.length ? "Reviews or changes need your attention." : "No reviews or changes need you."} onDetails={() => openDrawer({ type: "my-work", queue: "waiting-on-me" })} indicator={overview.myWork.waitingOnMe.length ? { type: "warning", label: "Needs you" } : undefined} />,
    renovate: showWeeklyRenovateReview ? (
      <MetricCard
        title="Renovate review"
        value={overview.renovate.total}
        description={renovateCheckCounts.failed
          ? `${renovateCheckCounts.failed} ${renovateCheckCounts.failed === 1 ? "update has" : "updates have"} failed or cancelled checks.`
          : overview.renovate.total
            ? `${overview.renovate.total} open ${overview.renovate.total === 1 ? "update is" : "updates are"} scheduled for review today.`
            : "No open updates need review today."}
        info={<PanelInfo header="Renovate review">Today is the configured review day, so this card counts all open Renovate updates and the review table evaluates every check reported for each latest commit, including non-required checks. Outside the review day, the card returns to showing only elevated blockers and direct requests.</PanelInfo>}
        onDetails={jumpToRenovateReview}
        warningHighlight={overview.renovate.total > 0}
        indicator={renovateCheckCounts.failed
          ? { type: "error", label: `${renovateCheckCounts.failed} ${renovateCheckCounts.failed === 1 ? "update has" : "updates have"} failed or cancelled checks` }
          : overview.renovate.total
            ? { type: "warning", label: "Scheduled review available" }
            : undefined}
      />
    ) : (
      <MetricCard title="Renovate attention" value={overview.renovate.unassignedTotal} description={overview.renovate.unassignedTotal ? routineRenovateTotal ? `${routineRenovateTotal} routine ${routineRenovateTotal === 1 ? "update can" : "updates can"} wait.` : "Elevated updates need manual attention." : `${overview.renovate.total} routine ${overview.renovate.total === 1 ? "update can" : "updates can"} wait.`} info={<PanelInfo header="Renovate attention">Routine updates stay informational. UDS Scout elevates only observable blockers, direct assignments or review requests, failing required checks, conflicts, and configured priority labels. Pull requests labeled stale are excluded.</PanelInfo>} onDetails={() => openDrawer({ type: "renovate", unassignedOnly: true })} indicator={overview.renovate.unassignedTotal ? { type: "warning", label: "Manual action required" } : undefined} />
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
    <ContentLayout
      header={
        <Header
          variant="h1"
          description="Scout tells you what matters across all your repositories. GitHub only tells you what's happening inside one. Go Fight Win!"
          actions={<SpaceBetween direction="horizontal" size="s"><DataFreshness generatedAt={overview.generatedAt} refreshing={refreshing} stale={Boolean(refreshError)} />{customizeCardsOpen ? <span className="customize-cards-done"><Button iconName="check" variant="primary" onClick={() => setCustomizeCardsOpen(false)}>Done</Button></span> : <Button iconName="drag-indicator" onClick={() => setCustomizeCardsOpen(true)}>Customize cards</Button>}<Button iconName="refresh" variant="icon" ariaLabel="Refresh data" loading={refreshing} onClick={refresh} /></SpaceBetween>}
        >
          {greeting}, {viewerFirstName(overview.viewer)}!
        </Header>
      }
    >
      <SpaceBetween size="l">
        {overview.capabilities.sonic && overview.udsCommon.needsAttention ? (
          <Flashbar items={[{
            type: "warning",
            header: `${overview.udsCommon.needsAttention} ${overview.udsCommon.needsAttention === 1 ? "repository needs" : "repositories need"} UDS Common attention`,
            content: `The latest UDS Common release is ${overview.udsCommon.latestVersion ?? "unavailable"}. Review outdated, missing, or unverifiable task includes.`,
            action: <div className="pipeline-alert-action"><Button onClick={() => openDrawer({ type: "uds-common" })}>View UDS Common status</Button></div>,
          }]} />
        ) : null}

        {customizeCardsOpen ? (
          <Flashbar items={[{
            type: "info",
            header: "Rearrange overview cards",
            content: "Drag a card by its handle to move it. Keyboard users can focus a handle, press Space, and use the arrow keys.",
            action: <div className="flashbar-centered-action"><Button onClick={() => updateCardOrder(DEFAULT_OVERVIEW_CARD_ORDER)}>Reset order</Button></div>,
          }]} />
        ) : null}

        <Table
          variant="container"
          stickyHeader
          trackBy="id"
          header={<Header variant="h2" description="Next actions, blockers, and handoffs." info={<PanelInfo header="My work today">Includes pull requests waiting on you, blocked work, merge-ready work, your pull requests waiting on others, human-created work needing ownership, and assigned issues. Routine automation and pull requests labeled stale are excluded.</PanelInfo>} actions={overview.myWork.assignedIssues.length || showWeeklyRenovateReview ? <SpaceBetween direction="horizontal" size="s">{overview.myWork.assignedIssues.length ? <Button onClick={() => openDrawer({ type: "my-work", queue: "assigned-issues" })}>{overview.myWork.assignedIssues.length} assigned {overview.myWork.assignedIssues.length === 1 ? "issue" : "issues"}</Button> : null}{showWeeklyRenovateReview ? <button type="button" className="renovate-review-beacon" aria-label="Jump to Renovate review" title="Renovate review is available" onClick={jumpToRenovateReview} /> : null}</SpaceBetween> : undefined}><span className="section-heading section-heading-my-work">My work today <span className="section-heading-count">({myWorkCount})</span></span></Header>}
          items={workQueue}
          columnDefinitions={[
            { id: "work", header: "Work", cell: (item) => <SpaceBetween size="xxs"><Link href={item.url} onFollow={(event) => { event.preventDefault(); openDrawer({ type: "pull-request", pull: item, repository: item.repository }); }}>{item.title}</Link><Box color="text-body-secondary">{item.repository} · #{item.number} · by {item.author}</Box></SpaceBetween> },
            { id: "state", header: "Workflow state", cell: pullWorkflowStatus },
            { id: "why", header: "Why it matters", cell: (item) => item.workflow.reason },
            { id: "waiting", header: "Waiting on", cell: (item) => item.workflow.waitingOn.length ? item.workflow.waitingOn.join(", ") : <Box color="text-body-secondary">—</Box> },
            { id: "updated", header: "Updated", cell: (item) => relativeTime(item.updatedAt, overview.generatedAt) },
          ]}
          empty={<EmptyState title="No action required" detail="Your selected-repository queue is clear." />}
        />

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
            <Table
              variant="container"
              stickyHeader
              trackBy="id"
              filter={<div className="renovate-review-filter"><Select selectedOption={selectedRenovateCheckFilter} options={renovateCheckFilterOptions} onChange={({ detail }) => setRenovateCheckFilter(detail.selectedOption.value as RenovateCheckFilter)} /></div>}
              header={<Header variant="h2" description="Failed or cancelled checks first, then running, passed, and updates with no checks." info={<PanelInfo header="Renovate review">This scheduled queue includes all open Renovate pull requests. Use the pipeline filter to focus on failures, running checks, passed checks, or updates with no reported checks.</PanelInfo>} actions={<Button onClick={() => navigate("/renovate")}>Open full list</Button>}><span className="section-heading">Renovate review <span className="section-heading-count">({visibleRenovateUpdates.length}{renovateCheckFilter === "all" ? "" : ` of ${scheduledRenovateUpdates.length}`})</span></span></Header>}
              items={visibleRenovateUpdates}
              columnDefinitions={[
                { id: "update", header: "Update", cell: (item) => <SpaceBetween size="xxs"><Link href={item.url} onFollow={(event) => { event.preventDefault(); openDrawer({ type: "pull-request", pull: item, repository: item.repository }); }}>{item.title}</Link><Box color="text-body-secondary">{item.repository} · #{item.number} · by {item.author}</Box></SpaceBetween> },
                { id: "labels", header: "Type / labels", cell: (item) => item.labels.length ? <div className="renovate-labels">{item.labels.map((label) => <Badge color="grey" key={label.name}>{label.name}</Badge>)}</div> : <Box color="text-body-secondary">Unlabeled</Box> },
                { id: "pipeline", header: "Pipeline / checks", cell: (item) => <RenovateCheckStatus pull={item} /> },
                { id: "approvals", header: "Approvals", cell: (item) => <RenovateApprovalStatus pull={item} /> },
                { id: "state", header: "PR status", cell: pullWorkflowStatus },
                { id: "opened", header: "Opened", cell: (item) => relativeTime(item.createdAt, overview.generatedAt) },
              ]}
              empty={<EmptyState title="No matching Renovate updates" detail={renovateCheckFilter === "all" ? "Tracked dependencies are current. Nothing needs review." : "No updates match this pipeline state."} />}
            />
          </div>
        ) : null}

        <Table
          variant="container"
          stickyHeader
          stripedRows
          trackBy="id"
          header={<Header variant="h2" counter={`(${overview.repositories.length})`} description="Attention across selected repositories." info={<PanelInfo header="Repository attention">Action required means an observable failure or work waiting on you. Needs attention covers blockers, merge-ready work, and unowned human pull requests. Monitor is non-default-branch activity worth watching. Routine automation and pull requests labeled stale do not elevate repository attention.</PanelInfo>}>Repository status</Header>}
          items={overview.repositories}
          columnDefinitions={[
            { id: "repository", header: "Repository", cell: (item) => <SpaceBetween size="xxs"><Link href={`/repositories/${item.fullName}`} onFollow={(event) => { event.preventDefault(); openDrawer({ type: "repository", repository: item }); }} fontSize="body-m">{item.name}</Link><Box color="text-body-secondary">{item.fullName.split("/")[0]}</Box></SpaceBetween>, sortingField: "name" },
            { id: "health", header: "Attention", cell: (item) => <SpaceBetween size="xxs">{repositoryHealth(item)}<Box color="text-body-secondary">{item.attention.reason}</Box></SpaceBetween> },
            { id: "workflow", header: "Pull request workflow", cell: (item) => <SpaceBetween size="xxs"><Box>{item.workflowCounts.waitingOnMe} on you · {item.workflowCounts.blocked} blocked</Box><Box color="text-body-secondary">{item.workflowCounts.readyToMerge} ready · {item.workflowCounts.waitingOnOthers} waiting elsewhere</Box></SpaceBetween> },
            { id: "reviews", header: "Your reviews", cell: (item) => item.reviewRequests ? <Button variant="inline-link" onClick={() => openDrawer({ type: "review-requests", repository: item.fullName })}>{item.reviewRequests} requested</Button> : <Box color="text-body-secondary">None</Box> },
            { id: "pipeline", header: "Default branch workflow", cell: (item) => <Button variant="inline-link" onClick={() => openDrawer({ type: "pipelines", repository: item.fullName })}>{pipelineStatus(item.pipeline)}</Button> },
            { id: "renovate", header: "Renovate attention", cell: (item) => item.unassignedRenovatePulls ? <Link href={`/renovate?repository=${encodeURIComponent(item.fullName)}`} onFollow={(event) => { event.preventDefault(); openDrawer({ type: "renovate", repository: item.fullName, unassignedOnly: true }); }}><Badge color="severity-medium">{item.unassignedRenovatePulls} elevated</Badge></Link> : <Box color="text-body-secondary">Informational</Box> },
            { id: "uds-common", header: "UDS Common", cell: (item) => item.udsCommon ? <Button variant="inline-link" onClick={() => openDrawer({ type: "uds-common", repository: item.fullName })}>{udsCommonStatus(item.udsCommon)}</Button> : <Box color="text-body-secondary">Not applicable</Box> },
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
              description={gitLabWorkItems ? `Open work assigned to ${gitLabWorkItems.viewer.username}, newest created first.` : "Open work assigned to you in SONIC Gitlab."}
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
            : <EmptyState title="No open work assigned" detail="Your SONIC Gitlab work item queue is clear." />}
        /> : null}

      </SpaceBetween>
    </ContentLayout>
  );
}
