"use client";

/* eslint-disable react-hooks/set-state-in-effect -- Browser-local card preferences are loaded after hydration. */

import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, rectSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import Badge from "@cloudscape-design/components/badge";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ContentLayout from "@cloudscape-design/components/content-layout";
import Flashbar from "@cloudscape-design/components/flashbar";
import Grid from "@cloudscape-design/components/grid";
import Header from "@cloudscape-design/components/header";
import Icon from "@cloudscape-design/components/icon";
import Link from "@cloudscape-design/components/link";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Spinner from "@cloudscape-design/components/spinner";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import Table from "@cloudscape-design/components/table";
import { useEffect, useState } from "react";
import type { DrawerSelection } from "./operations-types";
import { EmptyState, MetricCard, pipelineStatus, relativeTime, repositoryHealth, udsCommonStatus } from "./operations-ui";
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

type OverviewCardId = "pull-requests" | "renovate" | "issues" | "pipelines" | "uds-versions" | "reviews" | "zarf" | "pepr" | "uds-packages";

const DEFAULT_OVERVIEW_CARD_ORDER: OverviewCardId[] = [
  "pull-requests",
  "renovate",
  "issues",
  "pipelines",
  "uds-versions",
  "reviews",
  "zarf",
  "pepr",
  "uds-packages",
];

const OVERVIEW_CARD_LABELS: Record<OverviewCardId, string> = {
  "pull-requests": "Unassigned pull requests",
  renovate: "Renovate updates",
  issues: "Repository issues",
  pipelines: "Pipeline status",
  "uds-versions": "UDS versions",
  reviews: "Review requests",
  zarf: "Zarf version",
  pepr: "Pepr version",
  "uds-packages": "UDS Packages repositories",
};

const OVERVIEW_CARD_ORDER_KEY = "d2d-operations:overview-card-order";

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

export function OverviewPage({ overview, gitLabWorkItems, gitLabLoading, gitLabError, repositoryCatalog, repositoryCatalogLoading, repositoryCatalogError, refresh, openDrawer, navigate }: {
  overview: Overview;
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

  useEffect(() => {
    const updateGreeting = () => setGreeting(greetingForHour(new Date().getHours()));
    updateGreeting();
    const timer = window.setInterval(updateGreeting, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(OVERVIEW_CARD_ORDER_KEY) ?? "[]") as unknown;
      if (!Array.isArray(saved)) return;
      const valid = saved.filter((id): id is OverviewCardId => typeof id === "string" && DEFAULT_OVERVIEW_CARD_ORDER.includes(id as OverviewCardId));
      const unique = [...new Set(valid)];
      setCardOrder([...unique, ...DEFAULT_OVERVIEW_CARD_ORDER.filter((id) => !unique.includes(id))]);
    } catch {
      // Keep the default order when browser preferences are unavailable or invalid.
    }
  }, []);

  const updateCardOrder = (next: OverviewCardId[]) => {
    setCardOrder(next);
    window.localStorage.setItem(OVERVIEW_CARD_ORDER_KEY, JSON.stringify(next));
  };

  const handleCardDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const previousIndex = cardOrder.indexOf(active.id as OverviewCardId);
    const nextIndex = cardOrder.indexOf(over.id as OverviewCardId);
    if (previousIndex < 0 || nextIndex < 0) return;
    updateCardOrder(arrayMove(cardOrder, previousIndex, nextIndex));
  };

  const cards: Record<OverviewCardId, React.ReactNode> = {
    "pull-requests": <MetricCard title="Unassigned pull requests" value={overview.unassignedPullRequests.length} description="Non-Renovate changes with no assignee." onDetails={() => openDrawer({ type: "open-pulls", unassignedOnly: true })} />,
    renovate: <MetricCard title="Renovate updates" value={overview.renovate.unassignedTotal} description="Unassigned dependency updates awaiting review." onDetails={() => openDrawer({ type: "renovate", unassignedOnly: true })} status={overview.renovate.unassignedTotal ? <StatusIndicator type="warning">Review available updates</StatusIndicator> : <StatusIndicator type="success">No unassigned updates</StatusIndicator>} />,
    issues: <MetricCard title="Repository issues" value={overview.metrics.issueCount} description="Open issues, excluding pull requests." onDetails={() => openDrawer({ type: "issues" })} />,
    pipelines: <MetricCard title="Pipeline status" value={overview.metrics.pipelineFailures ? `${overview.metrics.pipelineFailures} failing` : "Passing"} description={`${passingPipelines} of ${overview.metrics.repositories} latest pipelines are passing.`} onDetails={() => openDrawer({ type: "pipelines" })} attention={overview.metrics.pipelineFailures > 0} status={overview.metrics.pipelineFailures ? <StatusIndicator type="error">Action required</StatusIndicator> : <StatusIndicator type="success">No failures detected</StatusIndicator>} />,
    "uds-versions": overview.capabilities.sonic ? (
      <MetricCard
        title="UDS versions"
        value={<span className="uds-version-pair"><VersionComparison label="UDS Core" current={overview.udsCore.version ?? "Unavailable"} target={overview.udsCore.upstreamVersion} outdated={overview.udsCore.comparison === "behind"} aligned={overview.udsCore.comparison === "current"} onClick={() => openDrawer({ type: "uds-core" })} /><VersionComparison label="UDS Common" current={commonDisplayedVersion} target={overview.udsCommon.latestVersion} outdated={commonOutdated} aligned={!commonOutdated && Boolean(overview.udsCommon.latestVersion)} onClick={() => openDrawer({ type: "uds-common" })} /></span>}
        description="Tracked Core and Common versions across your repositories."
        onDetails={() => openDrawer({ type: "uds-versions" })}
        status={overview.udsCommon.needsAttention ? <StatusIndicator type="warning">Common versions need alignment</StatusIndicator> : overview.udsCore.comparison === "behind" ? <StatusIndicator type="warning">Core version needs alignment</StatusIndicator> : overview.udsCore.comparison === "ahead" ? <StatusIndicator type="info">Core differs from upstream</StatusIndicator> : <StatusIndicator type="success">Versions aligned</StatusIndicator>}
      />
    ) : (
      <MetricCard
        title="UDS versions"
        value={<span className="uds-version-pair"><VersionComparison label="UDS Core" current={overview.udsCore.upstreamVersion ?? "Unavailable"} outdated={false} aligned={Boolean(overview.udsCore.upstreamVersion)} onClick={() => openDrawer({ type: "uds-core" })} /><VersionComparison label="UDS Common" current={overview.udsCommon.latestVersion ?? "Unavailable"} outdated={false} aligned={Boolean(overview.udsCommon.latestVersion)} onClick={() => openDrawer({ type: "uds-common" })} /></span>}
        description="Latest UDS Core and UDS Common releases."
        onDetails={() => openDrawer({ type: "uds-versions" })}
      />
    ),
    reviews: <MetricCard title="Review requests" value={overview.reviewRequests.length} description="Pull requests specifically waiting for your review." onDetails={() => openDrawer({ type: "review-requests" })} status={overview.reviewRequests.length ? <StatusIndicator type="info">Your review requested</StatusIndicator> : <StatusIndicator type="success">No reviews waiting</StatusIndicator>} />,
    zarf: <MetricCard title="Zarf version" value={<span className="metric-value-zarf">{overview.tools.zarf.version ?? "Unavailable"}</span>} description="Latest zarf-dev/zarf release." onDetails={() => openDrawer({ type: "tool-release", tool: "zarf" })} />,
    pepr: <MetricCard title="Pepr version" value={<span className="metric-value-pepr">{overview.tools.pepr.version ?? "Unavailable"}</span>} description="Latest defenseunicorns/pepr release." onDetails={() => openDrawer({ type: "tool-release", tool: "pepr" })} />,
    "uds-packages": <MetricCard
      title="UDS Packages repositories"
      value={repositoryCatalog ? <span className="metric-value-uds-packages">{repositoryCatalog.metrics.total}</span> : repositoryCatalogLoading ? <Spinner /> : "Unavailable"}
      description="Private and public repositories in uds-packages."
      onDetails={() => navigate("/uds-packages")}
      status={repositoryCatalogError
        ? <StatusIndicator type="warning">Catalog refresh unavailable</StatusIndicator>
        : repositoryCatalog
          ? <StatusIndicator type="info">{repositoryCatalog.metrics.private} private · {repositoryCatalog.metrics.public} public</StatusIndicator>
          : <StatusIndicator type="pending">Loading repository catalog</StatusIndicator>}
    />,
  };

  return (
    <ContentLayout
      header={
        <Header
          variant="h1"
          description="If it feels manual or repetitive, automate it."
          actions={<SpaceBetween direction="horizontal" size="s">{customizeCardsOpen ? <span className="customize-cards-done"><Button iconName="check" variant="primary" onClick={() => setCustomizeCardsOpen(false)}>Done</Button></span> : <Button iconName="drag-indicator" onClick={() => setCustomizeCardsOpen(true)}>Customize cards</Button>}<Button iconName="refresh" variant="icon" ariaLabel="Refresh data" onClick={refresh} /></SpaceBetween>}
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

        <DndContext sensors={cardDragSensors} collisionDetection={closestCenter} onDragEnd={handleCardDragEnd}>
          <SortableContext items={cardOrder} strategy={rectSortingStrategy}>
            <Grid gridDefinition={cardOrder.map(() => ({ colspan: { default: 12, xs: 6, l: 4 } }))}>
              {cardOrder.map((id) => <SortableOverviewCard id={id} label={OVERVIEW_CARD_LABELS[id]} customizing={customizeCardsOpen} key={id}>{cards[id]}</SortableOverviewCard>)}
            </Grid>
          </SortableContext>
        </DndContext>

        <Table
          variant="container"
          stickyHeader
          stripedRows
          trackBy="id"
          header={<Header variant="h2" counter={`(${overview.repositories.length})`} description="Current work and operational state by repository.">Repository status</Header>}
          items={overview.repositories}
          columnDefinitions={[
            { id: "repository", header: "Repository", cell: (item) => <SpaceBetween size="xxs"><Link href={`/repositories/${item.fullName}`} onFollow={(event) => { event.preventDefault(); openDrawer({ type: "repository", repository: item }); }} fontSize="body-m">{item.name}</Link><Box color="text-body-secondary">{item.fullName.split("/")[0]}</Box></SpaceBetween>, sortingField: "name" },
            { id: "health", header: "Operational status", cell: repositoryHealth },
            { id: "pulls", header: "Unassigned pull requests", cell: (item) => item.unassignedPullRequests },
            { id: "renovate", header: "Unassigned Renovate", cell: (item) => item.unassignedRenovatePulls ? <Link href={`/renovate?repository=${encodeURIComponent(item.fullName)}`} onFollow={(event) => { event.preventDefault(); openDrawer({ type: "renovate", repository: item.fullName, unassignedOnly: true }); }}><Badge color="severity-medium">{item.unassignedRenovatePulls} pending</Badge></Link> : <Box color="text-body-secondary">None</Box> },
            { id: "reviews", header: "Your reviews", cell: (item) => item.reviewRequests ? <Button variant="inline-link" onClick={() => openDrawer({ type: "review-requests", repository: item.fullName })}>{item.reviewRequests} requested</Button> : <Box color="text-body-secondary">None</Box> },
            { id: "issues", header: "Issues", cell: (item) => <Button variant="inline-link" onClick={() => openDrawer({ type: "repository", repository: item })}>{item.issueCount}</Button> },
            { id: "pipeline", header: "Latest pipeline", cell: (item) => <Button variant="inline-link" onClick={() => openDrawer({ type: "repository", repository: item })}>{pipelineStatus(item.pipeline)}</Button> },
            { id: "uds-common", header: "UDS Common", cell: (item) => item.udsCommon ? <Button variant="inline-link" onClick={() => openDrawer({ type: "uds-common", repository: item.fullName })}>{udsCommonStatus(item.udsCommon)}</Button> : <Box color="text-body-secondary">Not applicable</Box> },
          ]}
          empty={<EmptyState title="No repositories configured" detail="Add repositories to the tracked repository configuration." />}
        />

        {overview.capabilities.gitlab && gitLabError && gitLabWorkItems ? (
          <Flashbar items={[{
            type: "warning",
            header: "GitLab work items could not be refreshed",
            content: "Showing the last successfully loaded GitLab work item list.",
          }]} />
        ) : null}

        {overview.capabilities.gitlab ? <Table
          variant="container"
          stickyHeader
          stripedRows
          trackBy="id"
          loading={gitLabLoading && !gitLabWorkItems}
          loadingText="Loading assigned GitLab work items"
          header={
            <Header
              variant="h2"
              counter={gitLabWorkItems ? `(${gitLabWorkItems.items.length})` : undefined}
              description={gitLabWorkItems ? `Open work assigned to ${gitLabWorkItems.viewer.username}, newest created first.` : "Open work assigned to you in SONIC GitLab."}
              actions={gitLabWorkItems ? <Button href={gitLabWorkItems.dashboardUrl} external>Open GitLab board</Button> : undefined}
            >
              My GitLab work items
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
            { id: "labels", header: "Labels", cell: (item) => item.labels.length ? <SpaceBetween direction="horizontal" size="xxs">{item.labels.map((label) => <Badge key={label}>{label}</Badge>)}</SpaceBetween> : <Box color="text-body-secondary">None</Box> },
            { id: "due", header: "Due", cell: (item) => item.dueDate ?? <Box color="text-body-secondary">No due date</Box>, sortingField: "dueDate" },
            { id: "created", header: "Created", cell: (item) => relativeTime(item.createdAt, gitLabWorkItems?.generatedAt ?? overview.generatedAt), sortingField: "createdAt" },
            { id: "updated", header: "Updated", cell: (item) => relativeTime(item.updatedAt, gitLabWorkItems?.generatedAt ?? overview.generatedAt), sortingField: "updatedAt" },
          ]}
          empty={gitLabError
            ? <EmptyState title="GitLab work items are unavailable" detail={gitLabError} />
            : <EmptyState title="No open work assigned" detail="Your SONIC GitLab work item queue is clear." />}
        /> : null}

      </SpaceBetween>
    </ContentLayout>
  );
}
