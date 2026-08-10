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
import { useEffect, useState } from "react";
import { renovateReviewDayForDate } from "@/lib/renovate-review";
import { PrimaryActionButton } from "./action-ui";
import { InfoPopover as PanelInfo } from "./info-ui";
import type { DrawerSelection } from "./operations-types";
import { EmptyState, MetricCard, pipelineStatus, pullWorkflowStatus, relativeTime, repositoryAttentionAction, repositoryHealth, udsCommonStatusAction } from "./operations-ui";
import { filterRenovateUpdatesByCheck, isMajorRenovateUpdate, renovateCheckFilterOptions, RenovateUpdatesTable, sortRenovateUpdates, type RenovateCheckFilter } from "./RenovateUpdatesTable";
import type { GitLabWorkItems, Overview, RepositoryCatalog } from "./types";

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
  const [renovateCheckFilter, setRenovateCheckFilter] = useState<RenovateCheckFilter>("priority");
  const [welcomeVisible, setWelcomeVisible] = useState(false);
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
  const workQueue = [...new Map([
    ...overview.myWork.waitingOnMe,
    ...overview.myWork.blocked,
    ...overview.myWork.readyToMerge,
    ...overview.myWork.waitingOnOthers,
    ...overview.myWork.needsOwnership,
  ].map((pull) => [pull.id, pull])).values()];
  const myWorkCount = workQueue.length + overview.myWork.assignedIssues.length;
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

        <div id="my-work-today" className="overview-scroll-target"><Table
          variant="container"
          stickyHeader
          trackBy="id"
          header={<Header variant="h2" description="Next actions, blockers, and handoffs." info={<PanelInfo header="My work today">Includes pull requests waiting on you, blocked work, merge-ready work, your pull requests waiting on others, human-created work needing ownership, and assigned issues. Routine automation and pull requests labeled stale are excluded.</PanelInfo>} actions={<SpaceBetween direction="horizontal" size="s">{overview.myWork.assignedIssues.length ? <Button onClick={() => openDrawer({ type: "my-work", queue: "assigned-issues" })}>{overview.myWork.assignedIssues.length} assigned {overview.myWork.assignedIssues.length === 1 ? "issue" : "issues"}</Button> : null}<button type="button" className={`renovate-review-beacon${showWeeklyRenovateReview ? "" : " renovate-review-beacon-inactive"}`} aria-label={showWeeklyRenovateReview ? "Jump to Renovate review" : "Show Renovate review for today"} title={showWeeklyRenovateReview ? "Jump to Renovate review" : "Show Renovate review for today"} onClick={showWeeklyRenovateReview ? jumpToRenovateReview : () => setRenovateReviewVisibleForToday(true, true)} /></SpaceBetween>}><span className="section-heading section-heading-my-work">My work today <span className="section-heading-count">({myWorkCount})</span></span></Header>}
          items={workQueue}
          columnDefinitions={[
            { id: "work", header: "Work", cell: (item) => <SpaceBetween size="xxs"><Link href={item.url} onFollow={(event) => { event.preventDefault(); openDrawer({ type: "pull-request", pull: item, repository: item.repository }); }}>{item.title}</Link><Box color="text-body-secondary">{item.repository} · #{item.number} · by {item.author}</Box></SpaceBetween> },
            { id: "state", header: "Workflow state", cell: pullWorkflowStatus },
            { id: "why", header: "Why it matters", cell: (item) => item.workflow.reason },
            { id: "waiting", header: "Waiting on", cell: (item) => item.workflow.waitingOn.length ? item.workflow.waitingOn.join(", ") : <Box color="text-body-secondary">—</Box> },
            { id: "updated", header: "Updated", cell: (item) => relativeTime(item.updatedAt, overview.generatedAt) },
          ]}
          empty={<EmptyState title="No action required" detail="Your selected-repository queue is clear." />}
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
          header={<Header variant="h2" counter={`(${overview.repositories.length})`} description="Attention across selected repositories." info={<PanelInfo header="Repository attention">Action required means an observable failure or work waiting on you. Needs attention covers blockers, merge-ready work, and unowned human pull requests. Monitor is non-default-branch activity worth watching. Routine automation and pull requests labeled stale do not elevate repository attention.</PanelInfo>}>Repository status</Header>}
          items={overview.repositories}
          columnDefinitions={[
            { id: "repository", header: "Repository", cell: (item) => <SpaceBetween size="xxs"><Link href={`/repositories/${item.fullName}`} onFollow={(event) => { event.preventDefault(); openDrawer({ type: "repository", repository: item }); }} fontSize="body-m">{item.name}</Link><Box color="text-body-secondary">{item.fullName.split("/")[0]}</Box></SpaceBetween>, sortingField: "name" },
            { id: "health", header: "Attention", cell: (item) => { const action = repositoryAttentionAction(item, overview); return <SpaceBetween size="xxs">{repositoryHealth(item)}{action ? <Button variant="inline-link" ariaLabel={`${action.label} for ${item.fullName}`} onClick={() => openDrawer(action.selection)}>{item.attention.reason}</Button> : <Box color="text-body-secondary">{item.attention.reason}</Box>}</SpaceBetween>; } },
            { id: "workflow", header: "Pull request workflow", cell: (item) => <SpaceBetween size="xxs"><Box>{item.workflowCounts.waitingOnMe} on you · {item.workflowCounts.blocked} blocked</Box><Box color="text-body-secondary">{item.workflowCounts.readyToMerge} ready · {item.workflowCounts.waitingOnOthers} waiting elsewhere</Box></SpaceBetween> },
            { id: "reviews", header: "Your reviews", cell: (item) => item.reviewRequests ? <Button variant="inline-link" onClick={() => openDrawer({ type: "review-requests", repository: item.fullName })}>{item.reviewRequests} requested</Button> : <Box color="text-body-secondary">None</Box> },
            { id: "pipeline", header: "Default branch workflow", cell: (item) => <Button variant="inline-link" onClick={() => openDrawer({ type: "pipelines", repository: item.fullName })}>{pipelineStatus(item.pipeline)}</Button> },
            { id: "renovate", header: "Renovate attention", cell: (item) => item.unassignedRenovatePulls ? <Link href={`/renovate?repository=${encodeURIComponent(item.fullName)}`} onFollow={(event) => { event.preventDefault(); openDrawer({ type: "renovate", repository: item.fullName, unassignedOnly: true }); }}><Badge color="severity-medium">{item.unassignedRenovatePulls} elevated</Badge></Link> : <Box color="text-body-secondary">Informational</Box> },
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
