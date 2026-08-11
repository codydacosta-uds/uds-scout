"use client";


import Badge from "@cloudscape-design/components/badge";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Container from "@cloudscape-design/components/container";
import Drawer from "@cloudscape-design/components/drawer";
import ExpandableSection from "@cloudscape-design/components/expandable-section";
import Header from "@cloudscape-design/components/header";
import KeyValuePairs from "@cloudscape-design/components/key-value-pairs";
import Link from "@cloudscape-design/components/link";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Spinner from "@cloudscape-design/components/spinner";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import { useEffect, useRef, useState } from "react";
import { InfrastructureNodeDrawer } from "./InfrastructureExplorer";
import { ReleaseNotes } from "./ReleaseNotes";
import { WorkflowNotes } from "./WorkflowNotes";
import { isMajorRenovateUpdate, PullRequestCheckStatus, sortRenovateUpdates } from "./RenovateUpdatesTable";
import type { PipelineFailureDetail } from "./workflow-notes-types";
import type { InfrastructureExplorerData } from "./infrastructure-types";
import type { DrawerSelection } from "./operations-types";
import {
  DrawerKeyValueList,
  DrawerPrimaryButton,
  EmptyState,
  pipelineStatus,
  pullWorkflowStatus,
  PullAuthor,
  PullPeople,
  relativeTime,
  repositoryAttentionAction,
  repositoryHealth,
  runStatus,
  udsCommonStatusAction,
  UdsCoreVersion,
} from "./operations-ui";
import type { SecuritySeverity } from "./security-types";
import type { Overview, PullRequest } from "./types";

function markdownText(value: string) {
  return value
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/?(?:details|summary|p|div|table|thead|tbody|tr|th|td)[^>]*>/gi, "")
    .replace(/^\s*#{1,6}\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/[*_~`]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function markdownTableCells(line: string) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => markdownText(cell.trim()));
}

function parsePullBody(body: string) {
  const lines = body.split(/\r?\n/);
  for (let index = 0; index < lines.length - 2; index += 1) {
    if (!lines[index].trim().startsWith("|") || !lines[index + 1].trim().startsWith("|")) continue;
    const headers = markdownTableCells(lines[index]);
    const separators = markdownTableCells(lines[index + 1]);
    if (headers.length < 2 || separators.length !== headers.length || !separators.every((cell) => /^:?-{3,}:?$/.test(cell))) continue;

    let end = index + 2;
    const rows: string[][] = [];
    while (end < lines.length && lines[end].trim().startsWith("|")) {
      const cells = markdownTableCells(lines[end]);
      if (cells.some(Boolean)) rows.push(headers.map((_, cellIndex) => cells[cellIndex] ?? "Not specified"));
      end += 1;
    }
    if (!rows.length) continue;

    const remaining = markdownText([...lines.slice(0, index), ...lines.slice(end)].join("\n"))
      .replace(/^This PR contains the following updates?:?\s*/i, "")
      .trim();
    return { headers, rows, remaining };
  }
  return null;
}

function pullChangeDetails(headers: string[], row: string[]) {
  return headers.slice(1).flatMap((header, index) => {
    const value = row[index + 1] || "Not specified";
    if (/change|version/i.test(header)) {
      const versions = value.split(/\s*(?:→|->)\s*/);
      if (versions.length === 2) {
        return [
          { label: "Current version", value: versions[0] },
          { label: "Target version", value: versions[1] },
        ];
      }
    }
    return [{ label: header || `Detail ${index + 1}`, value }];
  });
}

function PullRequestDescription({ pull }: { pull: PullRequest }) {
  const body = pull.body ?? pull.summary;
  if (!body) {
    return <Container header={<Header variant="h3">Description</Header>}><Box color="text-body-secondary">No pull request description is available. Open GitHub to inspect the changed files.</Box></Container>;
  }

  const table = parsePullBody(body);
  if (!table) {
    return <Container header={<Header variant="h3">Description</Header>}><div className="pull-request-description">{markdownText(body)}</div></Container>;
  }

  const dependencyTable = table.headers.some((header) => /package|dependency/i.test(header));
  const details = (
    <SpaceBetween size="m">
      <div className="pull-request-change-list">
        {table.rows.map((row, rowIndex) => (
          <div className="pull-request-change" key={`${row[0]}-${rowIndex}`}>
            <Box variant="h4">{row[0] || `Change ${rowIndex + 1}`}</Box>
            <KeyValuePairs columns={1} items={pullChangeDetails(table.headers, row)} />
          </div>
        ))}
      </div>
      {table.remaining ? <ExpandableSection headerText="Additional PR details"><div className="pull-request-description">{table.remaining}</div></ExpandableSection> : null}
    </SpaceBetween>
  );

  return dependencyTable
    ? <ExpandableSection variant="container" headerText={`Dependency changes (${table.rows.length})`}>{details}</ExpandableSection>
    : <Container header={<Header variant="h3" counter={`(${table.rows.length})`}>Structured changes</Header>}>{details}</Container>;
}

function securitySeverityBadge(severity: SecuritySeverity) {
  if (severity === "critical") return <Badge color="red">Critical</Badge>;
  if (severity === "high") return <Badge color="severity-high">High</Badge>;
  if (severity === "medium") return <Badge color="severity-medium">Medium</Badge>;
  if (severity === "low") return <Badge color="grey">Low</Badge>;
  return <Badge color="grey">Unknown</Badge>;
}

function CenteredDrawerEmptyState({ title, detail }: { title: string; detail: string }) {
  return <div className="drawer-empty-state"><EmptyState title={title} detail={detail} /></div>;
}

function DrawerPullOption({ pull, repository, generatedAt, onOpen, children }: {
  pull: PullRequest;
  repository: string;
  generatedAt: string;
  onOpen: () => void;
  children?: React.ReactNode;
}) {
  return (
    <Container>
      <SpaceBetween size="xxs">
        <Link href={pull.url} onFollow={(event) => { event.preventDefault(); onOpen(); }}>{pull.title}</Link>
        <Box color="text-body-secondary">{repository} · #{pull.number} · by {pull.author} · opened {relativeTime(pull.createdAt, generatedAt)}</Box>
        {children}
      </SpaceBetween>
    </Container>
  );
}

type PullCheckReference = { name: string; url: string | null };

function workflowRunId(url: string | null | undefined) {
  return url?.match(/\/actions\/runs\/(\d+)/)?.[1] ?? null;
}

function FailureWorkingNotes({ viewer, noteKey, durableHref }: {
  viewer: string;
  noteKey: string;
  durableHref: string;
}) {
  return <Container header={<Header variant="h3">Failure working notes</Header>}><WorkflowNotes viewer={viewer} noteKey={noteKey} durableHref={durableHref} /></Container>;
}

function SelectedPipelineFailure({ repository, runId, checkName, noteKey, durableHref, viewer, notesOpen, attentionPulse }: {
  repository: string;
  runId: string | null;
  checkName: string;
  noteKey: string;
  durableHref: string;
  viewer: string;
  notesOpen: boolean;
  attentionPulse: number;
}) {
  const [detail, setDetail] = useState<PipelineFailureDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!runId) return;
    const controller = new AbortController();
    fetch(`/api/github/workflow-failure?repository=${encodeURIComponent(repository)}&run=${encodeURIComponent(runId)}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const data = await response.json() as PipelineFailureDetail & { error?: string };
        if (!response.ok) throw new Error(data.error ?? "Workflow failure details could not be loaded.");
        return data;
      })
      .then(setDetail)
      .catch((reason) => {
        if (reason.name !== "AbortError") setError(reason instanceof Error ? reason.message : "Workflow failure details could not be loaded.");
      });
    return () => controller.abort();
  }, [repository, runId]);

  const exactJob = detail?.jobs.find((job) => job.name.toLowerCase() === checkName.toLowerCase()) ?? null;
  const visibleJobs = exactJob ? [exactJob] : detail?.jobs ?? [];

  return (
    <SpaceBetween size="m">
      {runId && !detail && !error ? <Box color="text-body-secondary"><Spinner /> Loading failed job and step details</Box> : null}
      {error ? <StatusIndicator type="warning">{error}</StatusIndicator> : null}
      {detail ? exactJob ? (
        <SpaceBetween size="s">
          {exactJob.failedSteps.length ? <SpaceBetween size="xxs">{exactJob.failedSteps.map((step) => <div className="drawer-failed-step" key={`${exactJob.id}-${step.number}`}><StatusIndicator type={step.conclusion === "cancelled" ? "stopped" : "error"}>{step.conclusion === "cancelled" ? "Cancelled step" : "Failed step"}</StatusIndicator><Box>{step.name}</Box></div>)}</SpaceBetween> : <Box color="text-body-secondary">GitHub did not identify a failed step for this job.</Box>}
          <SpaceBetween direction="horizontal" size="s"><Link href={exactJob.url} external>Open job</Link><Link href={detail.run.url} external>Open workflow run</Link></SpaceBetween>
        </SpaceBetween>
      ) : (
        <SpaceBetween size="s">
          {visibleJobs.length ? visibleJobs.map((job) => (
            <div className="drawer-failed-job" key={job.id}>
              <div className="drawer-pipeline-heading"><StatusIndicator type={job.conclusion === "cancelled" ? "stopped" : "error"}>{job.conclusion === "cancelled" ? "Cancelled" : "Failed"}</StatusIndicator><Link href={job.url} external>{job.name}</Link></div>
              {job.failedSteps.length ? <SpaceBetween size="xxs">{job.failedSteps.map((step) => <div className="drawer-failed-step" key={`${job.id}-${step.number}`}><StatusIndicator type={step.conclusion === "cancelled" ? "stopped" : "error"}>{step.conclusion === "cancelled" ? "Cancelled step" : "Failed step"}</StatusIndicator><Box>{step.name}</Box></div>)}</SpaceBetween> : null}
            </div>
          )) : <Box color="text-body-secondary">GitHub did not return a failed job for this run.</Box>}
          <Link href={detail.run.url} external>Open workflow run</Link>
        </SpaceBetween>
      ) : null}
      {notesOpen ? <div className={`drawer-notes-scroll-target${attentionPulse ? ` drawer-failure-details-attention-${attentionPulse % 2 ? "a" : "b"}` : ""}`}><Container header={<Header variant="h3">Working notes</Header>}><WorkflowNotes viewer={viewer} noteKey={noteKey} durableHref={durableHref} /></Container></div> : null}
    </SpaceBetween>
  );
}

function PullRequestFailureWorkspace({ pull, repository, overview, focusOnOpen }: {
  pull: PullRequest;
  repository: string;
  overview: Overview;
  focusOnOpen: boolean;
}) {
  const failingChecks = pull.workflow.checks.rollup.failingChecks ?? pull.workflow.checks.rollup.failingNames.map((name) => ({ name, url: null }));
  const cancelledChecks = pull.workflow.checks.rollup.cancelledChecks ?? pull.workflow.checks.rollup.cancelledNames.map((name) => ({ name, url: null }));
  const pendingChecks = pull.workflow.checks.rollup.pendingChecks ?? [];
  const actionableChecks = [
    ...failingChecks.map((check) => ({ ...check, status: "failed" as const })),
    ...cancelledChecks.map((check) => ({ ...check, status: "cancelled" as const })),
  ];
  const [selectedKey, setSelectedKey] = useState(() => actionableChecks[0] ? `${actionableChecks[0].status}:${actionableChecks[0].name}:${actionableChecks[0].url ?? ""}` : "");
  const [attentionPulse, setAttentionPulse] = useState(0);
  const [expanded, setExpanded] = useState(focusOnOpen);
  const notesOpen = true;
  const sectionRef = useRef<HTMLDivElement>(null);
  const detailsRef = useRef<HTMLDivElement>(null);
  const selectedCheck = actionableChecks.find((check) => `${check.status}:${check.name}:${check.url ?? ""}` === selectedKey) ?? actionableChecks[0] ?? null;
  const relatedFailures = overview.workflowFailures.filter((failure) => failure.repository === repository && failure.blocksPullRequest === pull.number);
  const matchedFailure = selectedCheck ? relatedFailures.find((failure) => {
    const checkRun = workflowRunId(selectedCheck.url);
    const failureRun = workflowRunId(failure.url);
    return checkRun && failureRun ? checkRun === failureRun : failure.name.toLowerCase() === selectedCheck.name.toLowerCase();
  }) ?? (relatedFailures.length === 1 ? relatedFailures[0] : null) : null;
  const selectedRunId = workflowRunId(selectedCheck?.url) ?? (matchedFailure ? String(matchedFailure.id) : null);
  const selectedJobId = selectedCheck?.url?.match(/\/job\/(\d+)/)?.[1] ?? null;
  const selectedNoteKey = selectedCheck ? `${repository}:pipeline:${selectedRunId ?? pull.workflow.headSha ?? pull.number}:failure:${selectedJobId ?? selectedCheck.name}` : null;
  const checkUrl = (check: PullCheckReference) => check.url ?? `${pull.url}/checks`;
  const scrollBehavior = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" as const : "smooth" as const;
  const scrollToSelectedFailure = () => detailsRef.current?.scrollIntoView({ behavior: scrollBehavior(), block: "start" });

  useEffect(() => {
    if (!focusOnOpen) return;
    const timer = window.setTimeout(() => sectionRef.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" }), 120);
    return () => window.clearTimeout(timer);
  }, [focusOnOpen]);

  if (!actionableChecks.length && !pendingChecks.length) return null;

  return (
    <div ref={sectionRef} className="drawer-failed-checks-scroll-target"><ExpandableSection variant="container" headerText={`Failed pipeline checks (${actionableChecks.length + pendingChecks.length})`} expanded={expanded} onChange={({ detail }) => setExpanded(detail.expanded)}>
      <SpaceBetween size="m">
        {actionableChecks.length ? <div className="drawer-failure-list">{actionableChecks.map((check) => {
          const key = `${check.status}:${check.name}:${check.url ?? ""}`;
          const runId = workflowRunId(check.url);
          const failure = relatedFailures.find((candidate) => runId && workflowRunId(candidate.url) === runId) ?? null;
          return (
            <div className={`drawer-failure-option${key === selectedKey ? " drawer-failure-option-selected" : ""}`} key={key}>
              <div className="drawer-pipeline-heading">
                <StatusIndicator type={check.status === "failed" ? "error" : "stopped"}>{check.status === "failed" ? "Failed" : "Cancelled"}</StatusIndicator>
                <Button variant="inline-link" onClick={() => { setSelectedKey(key); setAttentionPulse((value) => value + 1); scrollToSelectedFailure(); }}>{check.name}</Button>
                <Button variant="icon" iconName="edit" ariaLabel={`Open working notes for ${check.name}`} onClick={() => { setSelectedKey(key); setAttentionPulse((value) => value + 1); scrollToSelectedFailure(); }} />
              </div>
              {failure?.failedJob || failure?.failedStep ? <Box color="text-body-secondary">{failure.failedJob ?? "Failed job"}{failure.failedStep ? ` · ${failure.failedStep}` : ""}</Box> : <Box color="text-body-secondary">Select to view failed job and step details.</Box>}
              <Link href={checkUrl(check)} external>Open check or workflow run</Link>
            </div>
          );
        })}</div> : null}

        {pendingChecks.length ? <ExpandableSection variant="inline" headerText={`${pendingChecks.length} running ${pendingChecks.length === 1 ? "check" : "checks"}`}>{pendingChecks.map((check) => <div className="drawer-check-result" key={`running-${check.name}-${check.url ?? ""}`}><StatusIndicator type="in-progress">Running</StatusIndicator><Link href={checkUrl(check)} external>{check.name}</Link></div>)}</ExpandableSection> : null}

        {selectedCheck && selectedNoteKey ? (
          <div ref={detailsRef} className="drawer-failure-details">
            <SpaceBetween size="xs">
              <Header variant="h3"><span className="drawer-selected-failure-heading">{selectedCheck.name}</span></Header>
              <SelectedPipelineFailure key={`${selectedNoteKey}:${selectedCheck.name}`} repository={repository} runId={selectedRunId} checkName={selectedCheck.name} noteKey={selectedNoteKey} durableHref={pull.url} viewer={overview.viewer.login} notesOpen={notesOpen} attentionPulse={attentionPulse} />
            </SpaceBetween>
          </div>
        ) : null}
      </SpaceBetween>
    </ExpandableSection></div>
  );
}

export function OperationsDrawer({ selection, overview, infrastructure, onSelect, navigate }: {
  selection: DrawerSelection;
  overview: Overview;
  infrastructure: InfrastructureExplorerData | null;
  onSelect: (selection: DrawerSelection) => void;
  navigate: (href: string) => void;
}) {
  if (selection.type === "infrastructure-node" && infrastructure) {
    return <InfrastructureNodeDrawer node={selection.node} data={infrastructure} onSelect={(node) => onSelect({ type: "infrastructure-node", node })} />;
  }

  if (selection.type === "security-finding") {
    const { finding, vulnerability } = selection;
    const advisoryUrl = vulnerability.references[0] ?? null;
    const contexts = [...new Map(selection.occurrences.map((occurrence) => {
      const context = `${occurrence.affectedPackage} ${occurrence.installedVersion ?? "version unknown"} · ${occurrence.component}${occurrence.flavor ? ` · ${occurrence.flavor}` : ""}`;
      return [context.toLowerCase(), context];
    })).values()];
    const footer = <SpaceBetween direction="horizontal" size="xs">{advisoryUrl ? <DrawerPrimaryButton href={advisoryUrl} external>Open advisory</DrawerPrimaryButton> : <DrawerPrimaryButton onClick={() => navigate(`/repositories/${selection.repository}?tab=security`)}>Open repository security</DrawerPrimaryButton>}{advisoryUrl ? <Button onClick={() => navigate(`/repositories/${selection.repository}?tab=security`)}>Open repository security</Button> : null}</SpaceBetween>;
    return (
      <Drawer header={vulnerability.id} footer={footer}>
        <SpaceBetween size="l">
          <SpaceBetween size="xs">
            {securitySeverityBadge(vulnerability.severity)}
            <Box variant="h3">{vulnerability.summary}</Box>
          </SpaceBetween>
          <DrawerKeyValueList items={[
            { label: "Repository", value: selection.repository },
            { label: "Affected version", value: finding.installedVersion ?? "Version unknown" },
            { label: "Fixed version", value: finding.fixedVersion ?? "No fixed version reported" },
            { label: "Finding type", value: finding.category === "application" ? "Direct application advisory" : finding.category.replace("container-", "Container ") },
            ...(selection.exposure ? [{ label: "Exposure", value: selection.exposure.charAt(0).toUpperCase() + selection.exposure.slice(1) }] : []),
            { label: "Source", value: finding.sources.join(", ") },
            { label: "First seen", value: relativeTime(finding.firstSeenAt, overview.generatedAt) },
            { label: "Last checked", value: relativeTime(finding.lastSeenAt, overview.generatedAt) },
          ]} />
          {vulnerability.aliases.length ? <Container header={<Header variant="h3">Identifiers</Header>}><SpaceBetween direction="horizontal" size="xs">{vulnerability.aliases.map((alias) => <Badge key={alias}>{alias}</Badge>)}</SpaceBetween></Container> : null}
          <Container header={<Header variant="h3" counter={`(${contexts.length})`}>Affected package contexts</Header>}>
            <SpaceBetween size="xs">
              {contexts.slice(0, 8).map((context) => <Box key={context}>{context}</Box>)}
              {contexts.length > 8 ? <Box color="text-body-secondary">{contexts.length - 8} additional contexts are represented in the repository findings table.</Box> : null}
            </SpaceBetween>
          </Container>
          {selection.pull ? <Container header={<Header variant="h3">Related update</Header>}><SpaceBetween size="xs">{pullWorkflowStatus(selection.pull)}<Box>{selection.pull.title}</Box><Button variant="inline-link" onClick={() => onSelect({ type: "pull-request", pull: selection.pull!, repository: selection.repository })}>Open PR #{selection.pull.number}</Button></SpaceBetween></Container> : finding.fixedVersion ? <StatusIndicator type="warning">No matching open update pull request was found</StatusIndicator> : null}
          {vulnerability.description && vulnerability.description !== vulnerability.summary ? <ExpandableSection variant="container" headerText="Advisory details"><Box>{vulnerability.description}</Box></ExpandableSection> : null}
        </SpaceBetween>
      </Drawer>
    );
  }

  if (selection.type === "pull-request") {
    const { pull } = selection;
    const checkIssueCount = pull.workflow.checks.rollup.failing + pull.workflow.checks.rollup.cancelled;
    const checkActivityCount = checkIssueCount + pull.workflow.checks.rollup.pending;
    const checkResultsUrl = checkActivityCount ? `${pull.url}/checks` : null;
    const checkRollup = pull.workflow.checks.rollup;
    const readinessParts = [pull.draft ? "Draft" : pull.workflow.mergeable === "MERGEABLE" ? "Mergeable" : pull.workflow.mergeable === "CONFLICTING" ? "Merge conflicts" : "Mergeability pending"];
    if (checkRollup.failing) readinessParts.push(`${checkRollup.failing} ${checkRollup.failing === 1 ? "check" : "checks"} failed`);
    else if (checkRollup.cancelled) readinessParts.push(`${checkRollup.cancelled} ${checkRollup.cancelled === 1 ? "check" : "checks"} cancelled`);
    else if (checkRollup.pending) readinessParts.push(`${checkRollup.pending} ${checkRollup.pending === 1 ? "check" : "checks"} running`);
    else if (pull.workflow.checks.total) readinessParts.push(`${checkRollup.passed} ${checkRollup.passed === 1 ? "check" : "checks"} passed`);
    else readinessParts.push("No checks reported");
    const readinessType = pull.workflow.mergeable === "CONFLICTING" || checkRollup.failing ? "error" : pull.draft || pull.workflow.mergeable === "UNKNOWN" || checkRollup.cancelled || checkRollup.pending ? "warning" : "success";
    const readinessStatus = <StatusIndicator type={readinessType}>{readinessParts.join(" · ")}</StatusIndicator>;
    const summaryItems: { label: React.ReactNode; value: React.ReactNode }[] = [
      { label: "Repository", value: selection.repository ?? "Unknown" },
      { label: "Author", value: <PullAuthor pull={pull} /> },
      { label: "Readiness", value: checkIssueCount ? <Button variant="inline-link" ariaLabel="Open failed pipeline checks" onClick={() => onSelect({ ...selection, focus: "failed-checks", focusRequest: Date.now() })}>{readinessStatus}</Button> : readinessStatus },
    ];
    if (pull.workflow.approvals.required !== null && pull.workflow.approvals.count < pull.workflow.approvals.required) summaryItems.push({ label: "Approvals needed", value: `${pull.workflow.approvals.count} of ${pull.workflow.approvals.required} received` });
    if (pull.assignees.length) summaryItems.push({ label: "Assigned to", value: <PullPeople people={pull.assignees} /> });
    if (pull.requestedReviewers.length) summaryItems.push({ label: "Review requested from", value: <PullPeople people={pull.requestedReviewers} /> });
    if (pull.workflow.waitingOn.length) summaryItems.push({ label: "Waiting on", value: pull.workflow.waitingOn.join(", ") });
    summaryItems.push({ label: "Updated", value: relativeTime(pull.updatedAt, overview.generatedAt) });
    return (
      <Drawer
        header={`Pull request #${pull.number}`}
        footer={<SpaceBetween direction="horizontal" size="xs"><DrawerPrimaryButton href={checkResultsUrl ?? pull.url} external>{pull.workflow.checks.rollup.failing ? "Open failed checks" : pull.workflow.checks.rollup.cancelled ? "Open cancelled checks" : pull.workflow.checks.rollup.pending ? "Open running checks" : "Open in GitHub"}</DrawerPrimaryButton>{checkResultsUrl ? <Button href={pull.url} external>Open pull request</Button> : selection.repository ? <Button onClick={() => navigate(`/repositories/${selection.repository}`)}>Open repository page</Button> : null}</SpaceBetween>}
      >
        <SpaceBetween size="l">
          <Box variant="h3">{pull.title}</Box>
          {pull.workflow.blockers.length ? <SpaceBetween size="xs">{pull.workflow.blockers.map((blocker) => <StatusIndicator type={pull.workflow.checks.failing && blocker.toLowerCase().includes("failing") ? "error" : "warning"} key={blocker}>{blocker}</StatusIndicator>)}</SpaceBetween> : null}
          {pull.workflow.renovateUpdate?.major ? (
            <Container header={<Header variant="h3">Major version change</Header>}>
              <SpaceBetween size="xs">
                <StatusIndicator type="warning">Prioritize compatibility and migration review</StatusIndicator>
                {pull.workflow.renovateUpdate.majorChanges.length ? pull.workflow.renovateUpdate.majorChanges.map((change, index) => <Box key={`${change.dependency ?? "dependency"}-${change.from}-${change.to}-${index}`}><Box variant="strong" display="inline">{change.dependency ?? "Dependency"}: </Box><Box variant="code" display="inline">{change.from}</Box>{" → "}<Box variant="code" display="inline">{change.to}</Box></Box>) : <Box color="text-body-secondary">Renovate marked this as a major update. Open the pull request for the complete version details.</Box>}
              </SpaceBetween>
            </Container>
          ) : null}
          <DrawerKeyValueList items={summaryItems} />
          <ExpandableSection variant="container" headerText="Pull request details">
            <DrawerKeyValueList items={[
              { label: "Source branch", value: <Box variant="code">{pull.head}</Box> },
              { label: "Target branch", value: <Box variant="code">{pull.base}</Box> },
              { label: "Workflow state", value: pullWorkflowStatus(pull) },
              { label: "Required checks", value: pull.workflow.checks.summary },
              { label: "Check rollup", value: pull.workflow.checks.total ? `${checkRollup.passed} passed · ${checkRollup.pending} running · ${checkRollup.failing} failed · ${checkRollup.cancelled} cancelled` : "No checks reported" },
              { label: "Opened", value: relativeTime(pull.createdAt, overview.generatedAt) },
            ]} />
          </ExpandableSection>
          {checkActivityCount ? <PullRequestFailureWorkspace key={`${selection.repository ?? pull.repository ?? "repository"}-${pull.id}-${pull.workflow.headSha ?? "head"}-${selection.focus ?? "default"}-${selection.focusRequest ?? 0}`} pull={pull} repository={selection.repository ?? pull.repository ?? "Unknown"} overview={overview} focusOnOpen={selection.focus === "failed-checks"} /> : null}
          <PullRequestDescription pull={pull} />
        </SpaceBetween>
      </Drawer>
    );
  }

  if (selection.type === "workflow-failure") {
    const { failure } = selection;
    return (
      <Drawer header={`Failed workflow #${failure.number}`} footer={<SpaceBetween direction="horizontal" size="xs"><DrawerPrimaryButton href={failure.url} external>Open workflow run</DrawerPrimaryButton><Button onClick={() => navigate(`/repositories/${failure.repository}`)}>Open repository page</Button></SpaceBetween>}>
        <SpaceBetween size="l">
          <Box variant="h3">{failure.title}</Box>
          <StatusIndicator type="error">{failure.attentionReason}</StatusIndicator>
          <DrawerKeyValueList items={[
            { label: "Repository", value: failure.repository },
            { label: "Workflow", value: failure.name },
            { label: "Failed job", value: failure.failedJob ?? "Unavailable with current GitHub permissions" },
            { label: "Failed step", value: failure.failedStep ?? "Unavailable with current GitHub permissions" },
            { label: "Failure summary", value: failure.failureSummary ?? "GitHub did not return failure details." },
            { label: "Branch", value: failure.branch ?? "Unknown" },
            { label: "Commit", value: failure.commitSha ? <Box variant="code">{failure.commitSha.slice(0, 12)}</Box> : "Unavailable" },
            { label: "Commit message", value: failure.commitMessage ?? "Unavailable" },
            { label: "Commit author", value: failure.commitAuthor ?? "Unavailable" },
            { label: "Default branch", value: failure.defaultBranch ? "Yes" : "No" },
            { label: "Blocks pull request", value: failure.blocksPullRequest ? `#${failure.blocksPullRequest}` : "Not known to block a selected pull request" },
            { label: "Age", value: relativeTime(failure.updatedAt, overview.generatedAt) },
          ]} />
          <FailureWorkingNotes viewer={overview.viewer.login} noteKey={`${failure.repository}:pipeline:${workflowRunId(failure.url) ?? failure.id}:failure:${failure.failedJob ?? failure.name}`} durableHref={failure.blocksPullRequest ? `https://github.com/${failure.repository}/pull/${failure.blocksPullRequest}` : failure.url} />
          <Box color="text-body-secondary">UDS Scout does not retrieve or display full workflow logs. Open GitHub for log-level investigation.</Box>
        </SpaceBetween>
      </Drawer>
    );
  }

  if (selection.type === "pipeline-run") {
    const { run } = selection;
    return (
      <Drawer header={`Pipeline run #${run.number}`} footer={<SpaceBetween direction="horizontal" size="xs"><DrawerPrimaryButton href={run.url} external>Open in GitHub</DrawerPrimaryButton><Button onClick={() => navigate(`/repositories/${selection.repository}`)}>Open repository page</Button></SpaceBetween>}>
        <SpaceBetween size="l">
          <Box variant="h3">{run.title}</Box>
          {runStatus(run)}
          <DrawerKeyValueList items={[
            { label: "Repository", value: selection.repository },
            { label: "Workflow", value: run.name },
            { label: "Branch", value: run.branch ?? "Unknown" },
            { label: "Trigger", value: run.event },
            { label: "Started by", value: run.actor },
            { label: "Started", value: relativeTime(run.createdAt, overview.generatedAt) },
          ]} />
        </SpaceBetween>
      </Drawer>
    );
  }

  if (selection.type === "issue") {
    const { issue } = selection;
    return (
      <Drawer header={`Issue #${issue.number}`} footer={<SpaceBetween direction="horizontal" size="xs"><DrawerPrimaryButton href={issue.url} external>Open in GitHub</DrawerPrimaryButton><Button onClick={() => navigate(`/repositories/${selection.repository}`)}>Open repository page</Button></SpaceBetween>}>
        <SpaceBetween size="l">
          <Box variant="h3">{issue.title}</Box>
          <StatusIndicator type="warning">Open</StatusIndicator>
          <DrawerKeyValueList items={[
            { label: "Repository", value: selection.repository },
            { label: "Author", value: issue.author },
            { label: "Created", value: relativeTime(issue.createdAt, overview.generatedAt) },
            { label: "Updated", value: relativeTime(issue.updatedAt, overview.generatedAt) },
          ]} />
          {issue.labels.length ? <SpaceBetween direction="horizontal" size="xs">{issue.labels.map((label) => <Badge key={label.name}>{label.name}</Badge>)}</SpaceBetween> : null}
        </SpaceBetween>
      </Drawer>
    );
  }

  if (selection.type === "repository") {
    const repository = selection.repository;
    const attentionAction = repositoryAttentionAction(repository, overview);
    return (
      <Drawer header={repository.name} footer={<SpaceBetween direction="horizontal" size="xs"><DrawerPrimaryButton onClick={() => navigate(`/repositories/${repository.fullName}`)}>Open repository page</DrawerPrimaryButton><Button href={repository.url} external>GitHub</Button></SpaceBetween>}>
        <SpaceBetween size="l">
          <Box color="text-body-secondary">{repository.description ?? "Tracked repository"}</Box>
          <SpaceBetween size="s">
            {repositoryHealth(repository)}
            <Box>{repository.attention.reason}</Box>
            {attentionAction ? <div><DrawerPrimaryButton onClick={() => onSelect(attentionAction.selection)}>{attentionAction.label}</DrawerPrimaryButton></div> : null}
          </SpaceBetween>
          <DrawerKeyValueList items={[
            { label: "Repository", value: repository.fullName },
            { label: "Open pull requests", value: `${repository.openPullRequests} · ${repository.workflowCounts.waitingOnMe} waiting on you · ${repository.workflowCounts.blocked} blocked · ${repository.workflowCounts.readyToMerge} ready` },
            { label: "Renovate updates", value: repository.renovatePulls },
            { label: "Your review requests", value: repository.reviewRequests },
            { label: "UDS Common", value: udsCommonStatusAction(repository.udsCommon, () => onSelect({ type: "uds-common", repository: repository.fullName })) },
            { label: "Open issues", value: repository.issueCount },
            { label: "Latest pipeline", value: pipelineStatus(repository.pipeline) },
            { label: "Last updated", value: relativeTime(repository.updatedAt, overview.generatedAt) },
          ]} />
          {repository.renovatePulls ? <Button onClick={() => onSelect({ type: "renovate", repository: repository.fullName })}>View Renovate updates</Button> : null}
        </SpaceBetween>
      </Drawer>
    );
  }

  if (selection.type === "tool-release") {
    const release = overview.tools[selection.tool];
    return (
      <Drawer header={`${release.name} release`} footer={<DrawerPrimaryButton href={release.url} external>Open release</DrawerPrimaryButton>}>
        <SpaceBetween size="l">
          <Box variant="awsui-value-large">{release.version ?? "Unavailable"}</Box>
          <Box color="text-body-secondary">Latest release published by {release.repository}.</Box>
          <DrawerKeyValueList items={[
            { label: "Repository", value: release.repository },
            { label: "Latest version", value: release.version ?? "Unavailable" },
          ]} />
        </SpaceBetween>
      </Drawer>
    );
  }

  if (selection.type === "uds-versions") {
    if (!overview.capabilities.sonic) {
      return (
        <Drawer header="Latest UDS versions">
          <SpaceBetween size="l">
            <Container header={<Header variant="h3">UDS Core</Header>}>
              <SpaceBetween size="s">
                <Box variant="awsui-value-large">{overview.udsCore.upstreamVersion ?? "Unavailable"}</Box>
                <Box color="text-body-secondary">Latest defenseunicorns/uds-core release.</Box>
                <Button onClick={() => onSelect({ type: "uds-core" })}>View UDS Core details</Button>
              </SpaceBetween>
            </Container>
            <Container header={<Header variant="h3">UDS Common</Header>}>
              <SpaceBetween size="s">
                <Box variant="awsui-value-large">{overview.udsCommon.latestVersion ?? "Unavailable"}</Box>
                <Box color="text-body-secondary">Latest defenseunicorns/uds-common release.</Box>
                <Button href={overview.udsCommon.latestUrl} external>Open UDS Common release</Button>
              </SpaceBetween>
            </Container>
          </SpaceBetween>
        </Drawer>
      );
    }

    const alignedRepositories = overview.udsCommon.repositories.length - overview.udsCommon.needsAttention;
    const commonUpdateAvailable = overview.udsCommon.repositories.some((repository) => repository.status === "outdated");
    return (
      <Drawer header="UDS versions">
        <SpaceBetween size="l">
          <Container className="uds-version-drawer-card" header={<Header variant="h3">UDS Core</Header>}>
            <SpaceBetween size="s">
              <Box variant="awsui-value-large"><span className="uds-core-drawer-version"><UdsCoreVersion udsCore={overview.udsCore} /></span></Box>
              <Box color="text-body-secondary">Tracked by {overview.udsCore.repository} and compared with the latest upstream release.</Box>
              <Button onClick={() => onSelect({ type: "uds-core" })}>View UDS Core details</Button>
            </SpaceBetween>
          </Container>
          <Container className="uds-version-drawer-card" header={<Header variant="h3">UDS Common</Header>}>
            <SpaceBetween size="s">
              <Box variant="awsui-value-large"><span className="uds-core-drawer-version">{overview.udsCommon.latestVersion ?? "Unavailable"}</span></Box>
              {overview.udsCommon.needsAttention ? <StatusIndicator type="warning">{overview.udsCommon.needsAttention} repositories need attention</StatusIndicator> : <StatusIndicator type="success">{alignedRepositories} repositories aligned</StatusIndicator>}
              <Box color="text-body-secondary">Repository task includes are compared with the latest UDS Common release.</Box>
              <Button onClick={() => onSelect({ type: "uds-common" })}>View UDS Common details</Button>
            </SpaceBetween>
          </Container>
          {overview.udsCore.comparison === "behind" ? <ReleaseNotes product="UDS Core" version={overview.udsCore.upstreamVersion} notes={overview.udsCore.upstreamReleaseNotes} /> : null}
          {commonUpdateAvailable ? <ReleaseNotes product="UDS Common" version={overview.udsCommon.latestVersion} notes={overview.udsCommon.latestReleaseNotes} /> : null}
        </SpaceBetween>
      </Drawer>
    );
  }

  if (selection.type === "uds-common") {
    const repositories = overview.udsCommon.repositories
      .filter((item) => !selection.repository || item.repository === selection.repository)
      .sort((a, b) => Number(a.status === "current") - Number(b.status === "current"));
    const repositoriesNeedingAlignment = repositories.filter((item) => item.status !== "current");
    const commonUpdateAvailable = repositories.some((item) => item.status === "outdated");
    return (
      <Drawer
        header="UDS Common alignment"
        footer={<DrawerPrimaryButton href={overview.udsCommon.latestUrl} external>Open latest UDS Common release</DrawerPrimaryButton>}
      >
        <SpaceBetween size="l">
          <DrawerKeyValueList items={[
            { label: "Latest release", value: overview.udsCommon.latestVersion ? <Link href={overview.udsCommon.latestUrl} external>{overview.udsCommon.latestVersion}</Link> : "Unavailable" },
            { label: "Repositories checked", value: repositories.length },
          ]} />
          {repositoriesNeedingAlignment.length ? <StatusIndicator type="warning">{repositoriesNeedingAlignment.map((item) => item.repository).join(", ")} {repositoriesNeedingAlignment.length === 1 ? "is" : "are"} out of alignment</StatusIndicator> : <StatusIndicator type="success">All checked repositories use the latest version</StatusIndicator>}
          <Box color="text-body-secondary">Each repository is checked against the UDS Common URLs under the root <Box variant="code" display="inline">tasks.yaml</Box> includes section. Repositories needing attention are listed first.</Box>
          {repositories.map((item) => (
            <Container key={item.repository} header={<Header variant="h3">{item.repository}</Header>}>
              <SpaceBetween size="s">
                {udsCommonStatusAction(item)}
                <DrawerKeyValueList items={[
                  { label: "Referenced version", value: item.versions.length ? item.versions.join(", ") : "Not detected" },
                  { label: "Common includes", value: item.includes.length },
                ]} />
                {item.includes.length ? <SpaceBetween size="xs">{item.includes.map((include) => <Box key={include.url}><Link href={include.url} external>{include.name}</Link><Box color="text-body-secondary">{include.version ? `Version ${include.version}` : "Version not detected in URL"}</Box></Box>)}</SpaceBetween> : <Box color="text-body-secondary">No versioned defenseunicorns/uds-common includes were detected.</Box>}
                {item.tasksUrl ? <Button href={item.tasksUrl} external variant="inline-link">Open tasks.yaml</Button> : null}
              </SpaceBetween>
            </Container>
          ))}
          {commonUpdateAvailable ? <ReleaseNotes product="UDS Common" version={overview.udsCommon.latestVersion} notes={overview.udsCommon.latestReleaseNotes} /> : null}
        </SpaceBetween>
      </Drawer>
    );
  }

  if (selection.type === "uds-core") {
    if (!overview.capabilities.sonic) {
      return (
        <Drawer header="Latest UDS Core release" footer={<DrawerPrimaryButton href={overview.udsCore.upstreamUrl} external>Open UDS Core release</DrawerPrimaryButton>}>
          <SpaceBetween size="l">
            <Box variant="awsui-value-large">{overview.udsCore.upstreamVersion ?? "Unavailable"}</Box>
            <Box color="text-body-secondary">This workspace does not track a SONIC repository, so UDS Scout shows the latest upstream defenseunicorns/uds-core release without a local comparison.</Box>
          </SpaceBetween>
        </Drawer>
      );
    }

    const coreStatus = overview.udsCore.comparison === "current"
      ? <StatusIndicator type="success">{overview.udsCore.repository} matches the latest upstream release</StatusIndicator>
      : overview.udsCore.comparison === "behind"
        ? <StatusIndicator type="warning">{overview.udsCore.repository} is out of date</StatusIndicator>
        : overview.udsCore.comparison === "ahead"
          ? <StatusIndicator type="info">Tracked version differs from upstream</StatusIndicator>
          : <StatusIndicator type="pending">Upstream comparison unavailable</StatusIndicator>;
    return (
      <Drawer
        header="UDS Core version"
        footer={<SpaceBetween direction="horizontal" size="xs"><DrawerPrimaryButton href={overview.udsCore.upstreamUrl} external>Open UDS Core</DrawerPrimaryButton>{overview.udsCore.url ? <Button href={overview.udsCore.url} external>View source file</Button> : null}</SpaceBetween>}
      >
        <SpaceBetween size="l">
          <Box variant="awsui-value-large"><span className="uds-core-drawer-version"><UdsCoreVersion udsCore={overview.udsCore} /></span></Box>
          {coreStatus}
          <Box color="text-body-secondary">The tracked version is compared by major, minor, and patch against the latest defenseunicorns/uds-core release. The local -unicorn suffix is ignored.</Box>
          <div className="uds-core-detail-links">
            <DrawerKeyValueList items={[
              { label: "Source repository", value: <Link href={`https://github.com/${overview.udsCore.repository}`} external>{overview.udsCore.repository}</Link> },
              { label: "Tracked version", value: overview.udsCore.url && overview.udsCore.version ? <Link href={overview.udsCore.url} external>{overview.udsCore.version}</Link> : overview.udsCore.version ?? "Unavailable" },
              { label: "Latest upstream release", value: overview.udsCore.upstreamVersion ? <Link href={overview.udsCore.upstreamUrl} external>{overview.udsCore.upstreamVersion}</Link> : "Unavailable" },
              { label: "Configuration file", value: overview.udsCore.url ? <Link href={overview.udsCore.url} external><span className="uds-core-config-path">{overview.udsCore.sourcePath}</span></Link> : <Box variant="code">{overview.udsCore.sourcePath}</Box> },
            ]} />
          </div>
          {overview.udsCore.comparison === "behind" ? <ReleaseNotes product="UDS Core" version={overview.udsCore.upstreamVersion} notes={overview.udsCore.upstreamReleaseNotes} /> : null}
        </SpaceBetween>
      </Drawer>
    );
  }

  if (selection.type === "my-work") {
    const queuePulls = selection.queue === "waiting-on-me" ? overview.myWork.waitingOnMe
      : selection.queue === "waiting-on-others" ? overview.myWork.waitingOnOthers
        : selection.queue === "blocked" ? overview.myWork.blocked
          : selection.queue === "ready-to-merge" ? overview.myWork.readyToMerge
            : selection.queue === "needs-ownership" ? overview.myWork.needsOwnership
              : [];
    const pulls = queuePulls.filter((pull) => !selection.repository || pull.repository === selection.repository);
    const titles = {
      "waiting-on-me": "Waiting on me",
      "waiting-on-others": "Waiting on someone else",
      blocked: "Blocked pull requests",
      "ready-to-merge": "Ready to merge",
      "needs-ownership": "Needs ownership",
      "assigned-issues": "Issues assigned to me",
    };
    if (selection.queue === "assigned-issues") {
      return <Drawer header={titles[selection.queue]}>{overview.myWork.assignedIssues.length ? <SpaceBetween size="m">{overview.myWork.assignedIssues.map((issue) => <Container key={`${issue.repository}-${issue.id}`}><SpaceBetween size="xs"><Link href={issue.url} external>{issue.title}</Link><Box color="text-body-secondary">{issue.repository} · #{issue.number} · updated {relativeTime(issue.updatedAt, overview.generatedAt)}</Box></SpaceBetween></Container>)}</SpaceBetween> : <CenteredDrawerEmptyState title="No assigned issues" detail="No selected-repository issues are assigned to you." />}</Drawer>;
    }
    return <Drawer header={titles[selection.queue]} footer={<DrawerPrimaryButton onClick={() => navigate("/pull-requests")}>Open full pull request list</DrawerPrimaryButton>}>{pulls.length ? <SpaceBetween size="m">{pulls.map((pull) => <Container key={`${pull.repository}-${pull.id}`}><SpaceBetween size="xs"><Link href={pull.url} onFollow={(event) => { event.preventDefault(); onSelect({ type: "pull-request", pull, repository: pull.repository }); }}>{pull.title}</Link>{pullWorkflowStatus(pull)}<Box color="text-body-secondary">{pull.repository} · #{pull.number}</Box><Box>{pull.workflow.reason}</Box></SpaceBetween></Container>)}</SpaceBetween> : <CenteredDrawerEmptyState title={`Nothing ${titles[selection.queue].toLowerCase()}`} detail="No selected-repository pull request currently matches this workflow state." />}</Drawer>;
  }

  if (selection.type === "briefing") {
    const items = overview.briefing.items.filter((item) => new Date(item.timestamp).getTime() >= new Date(selection.since).getTime());
    const groups = [
      { title: "Waiting on you", description: "Review requests and assigned pull requests.", types: ["review-request", "pull-assigned"] },
      { title: "Pull request progress", description: "Approvals, merges, and pull requests ready to merge.", types: ["pull-approved", "pull-merged", "ready-to-merge"] },
      { title: "Workflow changes", description: "Latest workflow failures and recoveries.", types: ["workflow-failure", "workflow-recovery"] },
      { title: "Assigned issues", description: "Assigned issues updated during this period.", types: ["issue-assigned"] },
    ];
    return (
      <Drawer header={<span className="section-heading section-heading-briefing">Since yesterday <span className="section-heading-count">({items.length})</span></span>}>
        {items.length ? <SpaceBetween size="l">{groups.map((group) => {
          const matches = items.filter((item) => group.types.includes(item.type));
          return matches.length ? (
            <Container key={group.title} header={<Header variant="h3" counter={`(${matches.length})`} description={group.description}>{group.title}</Header>}>
              <SpaceBetween size="m">
                {matches.map((item) => (
                  <div key={item.id}>
                    <Link href={item.url} external>{item.title}</Link>
                    <Box color="text-body-secondary">{item.repository} · {relativeTime(item.timestamp, overview.generatedAt)}</Box>
                    <Box color="text-body-secondary">{item.detail}</Box>
                  </div>
                ))}
              </SpaceBetween>
            </Container>
          ) : null;
        })}</SpaceBetween> : <CenteredDrawerEmptyState title="No changes since yesterday" detail="No selected-repository changes were found in the last 24 hours." />}
      </Drawer>
    );
  }

  if (selection.type === "open-pulls") {
    const source = selection.unassignedOnly ? overview.unassignedPullRequests : overview.pullRequests;
    const pulls = source.filter((pull) => !selection.repository || pull.repository === selection.repository);
    return (
      <Drawer header={selection.unassignedOnly ? "Unassigned pull requests" : "Open pull requests"} footer={<DrawerPrimaryButton onClick={() => navigate("/pull-requests")}>Open full pull request list</DrawerPrimaryButton>}>
        {pulls.length ? <SpaceBetween size="m">{pulls.map((pull) => pull.repository ? <DrawerPullOption key={`${pull.repository}-${pull.id}`} pull={pull} repository={pull.repository} generatedAt={overview.generatedAt} onOpen={() => onSelect({ type: "pull-request", pull, repository: pull.repository })} /> : null)}</SpaceBetween> : <CenteredDrawerEmptyState title={selection.unassignedOnly ? "No unassigned pull requests" : "No open pull requests"} detail="There are no changes waiting for review." />}
      </Drawer>
    );
  }

  if (selection.type === "renovate") {
    const pulls = sortRenovateUpdates(overview.renovate.pulls.filter((pull) =>
      (!selection.repository || pull.repository === selection.repository)
      && (!selection.majorOnly || isMajorRenovateUpdate(pull))
      && (!selection.unassignedOnly || (pull.assignees.length === 0 && !pull.requestedReviewers.some((reviewer) => reviewer.login.toLowerCase() === overview.viewer.login.toLowerCase()))),
    ));
    const fullHref = selection.majorOnly ? "/renovate?view=major" : selection.repository ? `/renovate?repository=${encodeURIComponent(selection.repository)}` : "/renovate";
    const drawerTitle = selection.majorOnly ? "Major Renovate updates" : selection.unassignedOnly ? "Unassigned Renovate updates" : "Renovate updates";
    return (
      <Drawer header={drawerTitle} footer={<DrawerPrimaryButton onClick={() => navigate(fullHref)}>Open full Renovate list</DrawerPrimaryButton>}>
        {pulls.length ? <SpaceBetween size="m">{pulls.map((pull) => pull.repository ? <DrawerPullOption key={`${pull.repository}-${pull.id}`} pull={pull} repository={pull.repository} generatedAt={overview.generatedAt} onOpen={() => onSelect({ type: "pull-request", pull, repository: pull.repository })}>{selection.majorOnly ? <SpaceBetween direction="horizontal" size="s"><Badge color="red">Major version</Badge><PullRequestCheckStatus pull={pull} onOpen={() => onSelect({ type: "pull-request", pull, repository: pull.repository, focus: "failed-checks" })} /></SpaceBetween> : pull.assignees.length ? <StatusIndicator type="in-progress">Assigned to {pull.assignees.map((assignee) => assignee.login).join(", ")}</StatusIndicator> : <StatusIndicator type="warning">Unassigned</StatusIndicator>}</DrawerPullOption> : null)}</SpaceBetween> : <CenteredDrawerEmptyState title={selection.majorOnly ? "No major Renovate updates" : "No Renovate updates need attention"} detail={selection.majorOnly ? "No open Renovate pull request contains a detected major-version change." : "Open updates are assigned, waiting for your review, or complete."} />}
      </Drawer>
    );
  }

  if (selection.type === "review-requests") {
    const pulls = overview.reviewRequests.filter((pull) => !selection.repository || pull.repository === selection.repository);
    return (
      <Drawer header="Review requests" footer={<DrawerPrimaryButton onClick={() => navigate("/pull-requests")}>Open full pull request list</DrawerPrimaryButton>}>
        {pulls.length ? <SpaceBetween size="m">{pulls.map((pull) => pull.repository ? <DrawerPullOption key={`${pull.repository}-${pull.id}`} pull={pull} repository={pull.repository} generatedAt={overview.generatedAt} onOpen={() => onSelect({ type: "pull-request", pull, repository: pull.repository })}><StatusIndicator type="info">Your review requested</StatusIndicator></DrawerPullOption> : null)}</SpaceBetween> : <CenteredDrawerEmptyState title="No reviews requested" detail="No open pull requests are waiting specifically for your review." />}
      </Drawer>
    );
  }

  if (selection.type === "issues") {
    const repositories = overview.repositories.filter((repository) => !selection.repository || repository.fullName === selection.repository);
    return (
      <Drawer header="Repository issues">
        <SpaceBetween size="m">
          <Box color="text-body-secondary">Open issues by repository. Pull requests are excluded.</Box>
          {repositories.map((repository) => <Container key={repository.id}><SpaceBetween size="xs"><Link href={`/repositories/${repository.fullName}`} onFollow={(event) => { event.preventDefault(); onSelect({ type: "repository", repository }); }}>{repository.fullName}</Link><Box variant="awsui-value-large">{repository.issueCount}</Box><Box color="text-body-secondary">open issues</Box></SpaceBetween></Container>)}
        </SpaceBetween>
      </Drawer>
    );
  }

  if (selection.type === "pipelines") {
    const repositories = overview.repositories.filter((repository) => !selection.repository || repository.fullName === selection.repository);
    const failures = overview.workflowFailures.filter((failure) => !selection.repository || failure.repository === selection.repository);
    return (
      <Drawer header="Workflow status">
        <SpaceBetween size="l">
          <Box color="text-body-secondary">Unresolved workflow failures are shown with why they matter. Default-branch status follows.</Box>
          {failures.length ? failures.map((failure) => <Container key={failure.id}><SpaceBetween size="xs"><Link href={failure.url} onFollow={(event) => { event.preventDefault(); onSelect({ type: "workflow-failure", failure }); }}>{failure.title}</Link><StatusIndicator type="error">{failure.attentionReason}</StatusIndicator><Box color="text-body-secondary">{failure.repository} · {failure.name} · {relativeTime(failure.updatedAt, overview.generatedAt)}</Box><Box>{failure.failureSummary ?? "Failed job details are unavailable."}</Box></SpaceBetween></Container>) : <StatusIndicator type="success">No unresolved workflow failures detected</StatusIndicator>}
          <Container header={<Header variant="h3">Default branches</Header>}><SpaceBetween size="m">{repositories.map((repository) => <div className="drawer-pipeline-row" key={repository.id}><div className="drawer-pipeline-heading"><Link href={`/repositories/${repository.fullName}`} onFollow={(event) => { event.preventDefault(); onSelect({ type: "repository", repository }); }}>{repository.fullName}</Link>{pipelineStatus(repository.pipeline)}</div><Box color="text-body-secondary">{repository.pipeline ? `${repository.pipeline.name} · ${relativeTime(repository.pipeline.updatedAt, overview.generatedAt)}` : "No default-branch workflow data returned"}</Box></div>)}</SpaceBetween></Container>
        </SpaceBetween>
      </Drawer>
    );
  }

  return null;
}
