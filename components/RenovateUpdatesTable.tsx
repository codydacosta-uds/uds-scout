"use client";

import Badge from "@cloudscape-design/components/badge";
import Box from "@cloudscape-design/components/box";
import Link from "@cloudscape-design/components/link";
import SpaceBetween from "@cloudscape-design/components/space-between";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import Table from "@cloudscape-design/components/table";
import type { ReactNode } from "react";
import type { DrawerSelection } from "./operations-types";
import { EmptyState, pullWorkflowStatus, relativeTime } from "./operations-ui";
import type { PullRequest } from "./types";

export type RenovateCheckFilter = "priority" | "all" | "major" | "failed" | "running" | "passed" | "no-checks";
type RenovateCheckCategory = Exclude<RenovateCheckFilter, "priority" | "all" | "major">;

export function isRenovateCheckFilter(value: unknown): value is RenovateCheckFilter {
  return value === "priority" || value === "all" || value === "major" || value === "failed" || value === "running" || value === "passed" || value === "no-checks";
}

export function isMajorRenovateUpdate(pull: PullRequest) {
  return pull.workflow.renovateUpdate?.major === true;
}

export function renovateCheckCategory(pull: PullRequest): RenovateCheckCategory {
  const { total, rollup } = pull.workflow.checks;
  if (rollup.failing || rollup.cancelled) return "failed";
  if (rollup.pending) return "running";
  if (total) return "passed";
  return "no-checks";
}

function renovatePriority(pull: PullRequest) {
  const failed = renovateCheckCategory(pull) === "failed";
  if (failed && isMajorRenovateUpdate(pull)) return 0;
  if (failed) return 1;
  if (isMajorRenovateUpdate(pull)) return 2;
  if (renovateCheckCategory(pull) === "running") return 3;
  if (renovateCheckCategory(pull) === "passed") return 4;
  return 5;
}

export function sortRenovateUpdates(pulls: readonly PullRequest[]) {
  return [...pulls].sort((first, second) => renovatePriority(first) - renovatePriority(second) || new Date(second.createdAt).getTime() - new Date(first.createdAt).getTime());
}

export function renovateCheckCounts(pulls: readonly PullRequest[]) {
  return pulls.reduce<Record<RenovateCheckCategory, number>>((counts, pull) => {
    counts[renovateCheckCategory(pull)] += 1;
    return counts;
  }, { failed: 0, running: 0, passed: 0, "no-checks": 0 });
}

export function renovateCheckFilterOptions(pulls: readonly PullRequest[]) {
  const counts = renovateCheckCounts(pulls);
  const priorityCount = pulls.filter((pull) => isMajorRenovateUpdate(pull) || renovateCheckCategory(pull) === "failed").length;
  return [
    { label: `Priority: failed or major (${priorityCount})`, value: "priority" },
    { label: `All updates (${pulls.length})`, value: "all" },
    { label: `Major version updates (${pulls.filter(isMajorRenovateUpdate).length})`, value: "major" },
    { label: `Failed or cancelled (${counts.failed})`, value: "failed" },
    { label: `Running (${counts.running})`, value: "running" },
    { label: `Passed (${counts.passed})`, value: "passed" },
    { label: `No checks (${counts["no-checks"]})`, value: "no-checks" },
  ] satisfies { label: string; value: RenovateCheckFilter }[];
}

export function filterRenovateUpdatesByCheck(pulls: readonly PullRequest[], filter: RenovateCheckFilter) {
  if (filter === "all") return [...pulls];
  if (filter === "priority") return pulls.filter((pull) => isMajorRenovateUpdate(pull) || renovateCheckCategory(pull) === "failed");
  if (filter === "major") return pulls.filter(isMajorRenovateUpdate);
  return pulls.filter((pull) => renovateCheckCategory(pull) === filter);
}

export function PullRequestCheckStatus({ pull, onOpen }: { pull: PullRequest; onOpen: () => void }) {
  const { total, rollup } = pull.workflow.checks;
  const pendingChecks = rollup.pendingChecks ?? [];
  const completedSummary = `${rollup.passed} passed${rollup.cancelled ? ` · ${rollup.cancelled} cancelled` : ""}${rollup.pending ? ` · ${rollup.pending} running` : ""}`;
  if (rollup.failing) {
    return <SpaceBetween size="xxs"><span title={rollup.failingNames.join(", ")}><Link href={pull.url} onFollow={(event) => { event.preventDefault(); onOpen(); }} ariaLabel={`Open ${rollup.failing} failed ${rollup.failing === 1 ? "check" : "checks"} for pull request ${pull.number}`}><StatusIndicator type="error">{rollup.failing} failed</StatusIndicator></Link></span><Box color="text-body-secondary">{completedSummary}</Box></SpaceBetween>;
  }
  if (rollup.cancelled) {
    return <SpaceBetween size="xxs"><span title={rollup.cancelledNames.join(", ")}><Link href={pull.url} onFollow={(event) => { event.preventDefault(); onOpen(); }} ariaLabel={`Open ${rollup.cancelled} cancelled ${rollup.cancelled === 1 ? "check" : "checks"} for pull request ${pull.number}`}><StatusIndicator type="stopped">{rollup.cancelled} cancelled</StatusIndicator></Link></span><Box color="text-body-secondary">{rollup.passed} of {total} passed</Box></SpaceBetween>;
  }
  if (rollup.pending) {
    return <SpaceBetween size="xxs"><span title={pendingChecks.map((check) => check.name).join(", ")}><Link href={pull.url} onFollow={(event) => { event.preventDefault(); onOpen(); }} ariaLabel={`Open ${rollup.pending} running ${rollup.pending === 1 ? "check" : "checks"} for pull request ${pull.number}`}><StatusIndicator type="in-progress">{rollup.pending} running</StatusIndicator></Link></span><Box color="text-body-secondary">{rollup.passed} of {total} passed</Box></SpaceBetween>;
  }
  if (total) return <StatusIndicator type="success">All {total} passed</StatusIndicator>;
  return <StatusIndicator type="pending">No checks reported</StatusIndicator>;
}

function RenovateUpdateLabels({ pull }: { pull: PullRequest }) {
  return (
    <div className="renovate-labels">
      {isMajorRenovateUpdate(pull) ? <Badge color="red">Major version</Badge> : null}
      {pull.labels.map((label) => <Badge color="grey" key={label.name}>{label.name}</Badge>)}
      {!pull.labels.length && !isMajorRenovateUpdate(pull) ? <Box color="text-body-secondary">Unlabeled</Box> : null}
    </div>
  );
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

export function RenovateUpdatesTable({ items, referenceTime, openDrawer, header, filter, emptyDetail }: {
  items: PullRequest[];
  referenceTime: string;
  openDrawer: (selection: DrawerSelection) => void;
  header?: ReactNode;
  filter?: ReactNode;
  emptyDetail: string;
}) {
  return (
    <Table
      variant="container"
      stickyHeader
      trackBy="id"
      filter={filter}
      header={header}
      items={items}
      columnDefinitions={[
        { id: "update", header: "Update", cell: (item) => <div className={isMajorRenovateUpdate(item) ? "renovate-major-update" : undefined}><SpaceBetween size="xxs"><Link href={item.url} onFollow={(event) => { event.preventDefault(); openDrawer({ type: "pull-request", pull: item, repository: item.repository }); }}>{item.title}</Link><Box color="text-body-secondary">{item.repository} · #{item.number} · by {item.author}</Box></SpaceBetween></div> },
        { id: "labels", header: "Version impact / labels", cell: (item) => <RenovateUpdateLabels pull={item} /> },
        { id: "pipeline", header: "Pipeline / checks", cell: (item) => <PullRequestCheckStatus pull={item} onOpen={() => openDrawer({ type: "pull-request", pull: item, repository: item.repository, focus: "failed-checks" })} /> },
        { id: "approvals", header: "Approvals", cell: (item) => <RenovateApprovalStatus pull={item} /> },
        { id: "state", header: "PR status", cell: pullWorkflowStatus },
        { id: "opened", header: "Opened", cell: (item) => relativeTime(item.createdAt, referenceTime) },
      ]}
      empty={<EmptyState title="No matching Renovate updates" detail={emptyDetail} />}
    />
  );
}
