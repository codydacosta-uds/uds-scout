"use client";

/* eslint-disable react-hooks/set-state-in-effect -- Pull-request selection resets when drawer context changes. */

import Badge from "@cloudscape-design/components/badge";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Container from "@cloudscape-design/components/container";
import Drawer from "@cloudscape-design/components/drawer";
import ExpandableSection from "@cloudscape-design/components/expandable-section";
import Header from "@cloudscape-design/components/header";
import KeyValuePairs from "@cloudscape-design/components/key-value-pairs";
import Link from "@cloudscape-design/components/link";
import RadioGroup from "@cloudscape-design/components/radio-group";
import SpaceBetween from "@cloudscape-design/components/space-between";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import { useEffect, useState } from "react";
import { InfrastructureNodeDrawer } from "./InfrastructureExplorer";
import { ReleaseNotes } from "./ReleaseNotes";
import type { InfrastructureExplorerData } from "./infrastructure-types";
import type { DrawerSelection } from "./operations-types";
import {
  canTestPullRequest,
  DrawerKeyValueList,
  DrawerPrimaryButton,
  EmptyState,
  newestPulls,
  pipelineStatus,
  pullWorkflowStatus,
  PullAuthor,
  PullPeople,
  pullRequestTestLabHref,
  relativeTime,
  repositoryHealth,
  runStatus,
  TestInLabButton,
  udsCommonStatus,
  UdsCoreVersion,
} from "./operations-ui";
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
  return (
    <Container header={<Header variant="h3" counter={`(${table.rows.length})`}>{dependencyTable ? "Dependency changes" : "Structured changes"}</Header>}>
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
    </Container>
  );
}

function pullSelectionKey(pull: PullRequest, repository: string) {
  return `${repository}:${pull.id}`;
}

function CenteredDrawerEmptyState({ title, detail }: { title: string; detail: string }) {
  return <div className="drawer-empty-state"><EmptyState title={title} detail={detail} /></div>;
}

function DrawerPullOption({ pull, repository, generatedAt, selectedKey, onSelectionChange, onOpen, children }: {
  pull: PullRequest;
  repository: string;
  generatedAt: string;
  selectedKey: string | null;
  onSelectionChange: (key: string) => void;
  onOpen: () => void;
  children?: React.ReactNode;
}) {
  const key = pullSelectionKey(pull, repository);
  return (
    <Container>
      <RadioGroup
        name="drawer-pull-selection"
        value={selectedKey}
        onChange={({ detail }) => onSelectionChange(detail.value)}
        items={[{
          value: key,
          disabled: !canTestPullRequest(pull, repository),
          label: <Link href={pull.url} onFollow={(event) => { event.preventDefault(); onOpen(); }}>{pull.title}</Link>,
          description: <SpaceBetween size="xxs"><Box color="text-body-secondary">{repository} · #{pull.number} · by {pull.author} · opened {relativeTime(pull.createdAt, generatedAt)}</Box>{children}</SpaceBetween>,
        }]}
      />
    </Container>
  );
}

export function OperationsDrawer({ selection, overview, infrastructure, onSelect, navigate }: {
  selection: DrawerSelection;
  overview: Overview;
  infrastructure: InfrastructureExplorerData | null;
  onSelect: (selection: DrawerSelection) => void;
  navigate: (href: string) => void;
}) {
  const [selectedDrawerPull, setSelectedDrawerPull] = useState<string | null>(null);
  const drawerSelectionScope = `${selection.type}:${"repository" in selection ? selection.repository ?? "all" : "all"}`;
  useEffect(() => setSelectedDrawerPull(null), [drawerSelectionScope]);

  if (selection.type === "infrastructure-node" && infrastructure) {
    return <InfrastructureNodeDrawer node={selection.node} data={infrastructure} onSelect={(node) => onSelect({ type: "infrastructure-node", node })} />;
  }

  if (selection.type === "pull-request") {
    const { pull } = selection;
    const checkIssueCount = pull.workflow.checks.rollup.failing + pull.workflow.checks.rollup.cancelled;
    const checkActivityCount = checkIssueCount + pull.workflow.checks.rollup.pending;
    const checkResultsUrl = checkActivityCount ? `${pull.url}/checks` : null;
    const pendingChecks = pull.workflow.checks.rollup.pendingChecks ?? [];
    const failingChecks = pull.workflow.checks.rollup.failingChecks ?? pull.workflow.checks.rollup.failingNames.map((name) => ({ name, url: null }));
    const cancelledChecks = pull.workflow.checks.rollup.cancelledChecks ?? pull.workflow.checks.rollup.cancelledNames.map((name) => ({ name, url: null }));
    return (
      <Drawer
        header={`Pull request #${pull.number}`}
        footer={<SpaceBetween direction="horizontal" size="xs">{canTestPullRequest(pull, selection.repository) && selection.repository ? <TestInLabButton onClick={() => navigate(pullRequestTestLabHref(pull, selection.repository!))} /> : null}<DrawerPrimaryButton href={checkResultsUrl ?? pull.url} external>{pull.workflow.checks.rollup.failing ? "Open failed checks" : pull.workflow.checks.rollup.cancelled ? "Open cancelled checks" : pull.workflow.checks.rollup.pending ? "Open running checks" : "Open in GitHub"}</DrawerPrimaryButton>{checkResultsUrl ? <Button href={pull.url} external>Open pull request</Button> : selection.repository ? <Button onClick={() => navigate(`/repositories/${selection.repository}`)}>Open repository page</Button> : null}</SpaceBetween>}
      >
        <SpaceBetween size="l">
          <Box variant="h3">{pull.title}</Box>
          <DrawerKeyValueList items={[
            { label: "Repository", value: selection.repository ?? "Unknown" },
            { label: "Author", value: <PullAuthor pull={pull} /> },
            { label: "Source branch", value: <Box variant="code">{pull.head}</Box> },
            { label: "Target branch", value: <Box variant="code">{pull.base}</Box> },
            { label: "Workflow state", value: pullWorkflowStatus(pull) },
            { label: "Why this matters", value: pull.workflow.reason },
            { label: "Approvals", value: pull.workflow.approvals.required === null ? `${pull.workflow.approvals.count} · required count unavailable` : `${pull.workflow.approvals.count} of ${pull.workflow.approvals.required} required` },
            { label: "Required checks", value: pull.workflow.checks.summary },
            { label: "Check rollup", value: pull.workflow.checks.total ? `${pull.workflow.checks.rollup.passed} passed · ${pull.workflow.checks.rollup.pending} running · ${pull.workflow.checks.rollup.failing} failed · ${pull.workflow.checks.rollup.cancelled} cancelled` : "No checks reported" },
            { label: "Mergeable", value: pull.workflow.mergeable === "MERGEABLE" ? "Yes" : pull.workflow.mergeable === "CONFLICTING" ? "No — conflicts detected" : "Unable to verify" },
            { label: "Assigned to", value: <PullPeople people={pull.assignees} /> },
            { label: "Review requested from", value: <PullPeople people={pull.requestedReviewers} empty="No reviewers requested" /> },
            { label: "Waiting on", value: pull.workflow.waitingOn.length ? pull.workflow.waitingOn.join(", ") : "No specific person identified" },
            { label: "Age", value: relativeTime(pull.createdAt, overview.generatedAt) },
            { label: "Updated", value: relativeTime(pull.updatedAt, overview.generatedAt) },
          ]} />
          {checkActivityCount ? (
            <Container header={<Header variant="h3" counter={`(${checkActivityCount})`}>Check activity</Header>}>
              <SpaceBetween size="s">
                {failingChecks.map((check, index) => <div className="drawer-check-result" key={`failed-${check.name}-${check.url ?? index}`}><StatusIndicator type="error">Failed</StatusIndicator><Link href={check.url ?? checkResultsUrl ?? pull.url} external>{check.name}</Link></div>)}
                {cancelledChecks.map((check, index) => <div className="drawer-check-result" key={`cancelled-${check.name}-${check.url ?? index}`}><StatusIndicator type="stopped">Cancelled</StatusIndicator><Link href={check.url ?? checkResultsUrl ?? pull.url} external>{check.name}</Link></div>)}
                {pendingChecks.map((check, index) => <div className="drawer-check-result" key={`running-${check.name}-${check.url ?? index}`}><StatusIndicator type="in-progress">Running</StatusIndicator><Link href={check.url ?? checkResultsUrl ?? pull.url} external>{check.name}</Link></div>)}
              </SpaceBetween>
            </Container>
          ) : null}
          {pull.workflow.blockers.length ? <Container header={<Header variant="h3">Blocking progress</Header>}><SpaceBetween size="xs">{pull.workflow.blockers.map((blocker) => <StatusIndicator type={pull.workflow.checks.failing && blocker.toLowerCase().includes("failing") ? "error" : "warning"} key={blocker}>{blocker}</StatusIndicator>)}</SpaceBetween></Container> : null}
          <PullRequestDescription pull={pull} />
          {pull.labels.length ? <SpaceBetween direction="horizontal" size="xs">{pull.labels.map((label) => <Badge key={label.name}>{label.name}</Badge>)}</SpaceBetween> : null}
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
    return (
      <Drawer header={repository.name} footer={<SpaceBetween direction="horizontal" size="xs"><DrawerPrimaryButton onClick={() => navigate(`/repositories/${repository.fullName}`)}>Open repository page</DrawerPrimaryButton><Button href={repository.url} external>GitHub</Button></SpaceBetween>}>
        <SpaceBetween size="l">
          <Box color="text-body-secondary">{repository.description ?? "Tracked repository"}</Box>
          {repositoryHealth(repository)}
          <Box>{repository.attention.reason}</Box>
          <DrawerKeyValueList items={[
            { label: "Repository", value: repository.fullName },
            { label: "Open pull requests", value: `${repository.openPullRequests} · ${repository.workflowCounts.waitingOnMe} waiting on you · ${repository.workflowCounts.blocked} blocked · ${repository.workflowCounts.readyToMerge} ready` },
            { label: "Renovate updates", value: repository.renovatePulls },
            { label: "Your review requests", value: repository.reviewRequests },
            { label: "UDS Common", value: udsCommonStatus(repository.udsCommon) },
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
                {udsCommonStatus(item)}
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
    const pulls = selection.queue === "waiting-on-me" ? overview.myWork.waitingOnMe
      : selection.queue === "waiting-on-others" ? overview.myWork.waitingOnOthers
        : selection.queue === "blocked" ? overview.myWork.blocked
          : selection.queue === "ready-to-merge" ? overview.myWork.readyToMerge
            : selection.queue === "needs-ownership" ? overview.myWork.needsOwnership
              : [];
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
    const selectedPull = pulls.find((pull) => pull.repository && pullSelectionKey(pull, pull.repository) === selectedDrawerPull) ?? null;
    return (
      <Drawer header={selection.unassignedOnly ? "Unassigned pull requests" : "Open pull requests"} footer={<SpaceBetween direction="horizontal" size="xs"><TestInLabButton disabled={!selectedPull || !selectedPull.repository} onClick={() => { if (selectedPull?.repository) navigate(pullRequestTestLabHref(selectedPull, selectedPull.repository)); }}>Test</TestInLabButton><DrawerPrimaryButton onClick={() => navigate("/pull-requests")}>Open full pull request list</DrawerPrimaryButton></SpaceBetween>}>
        {pulls.length ? <SpaceBetween size="m">{pulls.map((pull) => pull.repository ? <DrawerPullOption key={`${pull.repository}-${pull.id}`} pull={pull} repository={pull.repository} generatedAt={overview.generatedAt} selectedKey={selectedDrawerPull} onSelectionChange={setSelectedDrawerPull} onOpen={() => onSelect({ type: "pull-request", pull, repository: pull.repository })} /> : null)}</SpaceBetween> : <CenteredDrawerEmptyState title={selection.unassignedOnly ? "No unassigned pull requests" : "No open pull requests"} detail="There are no changes waiting for review." />}
      </Drawer>
    );
  }

  if (selection.type === "renovate") {
    const pulls = newestPulls(overview.renovate.pulls.filter((pull) =>
      (!selection.repository || pull.repository === selection.repository) && (!selection.unassignedOnly || (
        pull.assignees.length === 0 && !pull.requestedReviewers.some((reviewer) => reviewer.login.toLowerCase() === overview.viewer.login.toLowerCase())
      )),
    ));
    const fullHref = selection.repository ? `/renovate?repository=${encodeURIComponent(selection.repository)}` : "/renovate";
    const selectedPull = pulls.find((pull) => pull.repository && pullSelectionKey(pull, pull.repository) === selectedDrawerPull) ?? null;
    return (
      <Drawer header={selection.unassignedOnly ? "Unassigned Renovate updates" : "Renovate updates"} footer={<SpaceBetween direction="horizontal" size="xs"><TestInLabButton disabled={!selectedPull || !selectedPull.repository} onClick={() => { if (selectedPull?.repository) navigate(pullRequestTestLabHref(selectedPull, selectedPull.repository)); }}>Test</TestInLabButton><DrawerPrimaryButton onClick={() => navigate(fullHref)}>Open full Renovate list</DrawerPrimaryButton></SpaceBetween>}>
        {pulls.length ? <SpaceBetween size="m">{pulls.map((pull) => pull.repository ? <DrawerPullOption key={`${pull.repository}-${pull.id}`} pull={pull} repository={pull.repository} generatedAt={overview.generatedAt} selectedKey={selectedDrawerPull} onSelectionChange={setSelectedDrawerPull} onOpen={() => onSelect({ type: "pull-request", pull, repository: pull.repository })}>{pull.assignees.length ? <StatusIndicator type="in-progress">Assigned to {pull.assignees.map((assignee) => assignee.login).join(", ")}</StatusIndicator> : <StatusIndicator type="warning">Unassigned</StatusIndicator>}</DrawerPullOption> : null)}</SpaceBetween> : <CenteredDrawerEmptyState title="No Renovate updates need attention" detail="Open updates are assigned, waiting for your review, or complete." />}
      </Drawer>
    );
  }

  if (selection.type === "review-requests") {
    const pulls = overview.reviewRequests.filter((pull) => !selection.repository || pull.repository === selection.repository);
    const selectedPull = pulls.find((pull) => pull.repository && pullSelectionKey(pull, pull.repository) === selectedDrawerPull) ?? null;
    return (
      <Drawer header="Review requests" footer={<SpaceBetween direction="horizontal" size="xs"><TestInLabButton disabled={!selectedPull || !selectedPull.repository} onClick={() => { if (selectedPull?.repository) navigate(pullRequestTestLabHref(selectedPull, selectedPull.repository)); }}>Test</TestInLabButton><DrawerPrimaryButton onClick={() => navigate("/pull-requests")}>Open full pull request list</DrawerPrimaryButton></SpaceBetween>}>
        {pulls.length ? <SpaceBetween size="m">{pulls.map((pull) => pull.repository ? <DrawerPullOption key={`${pull.repository}-${pull.id}`} pull={pull} repository={pull.repository} generatedAt={overview.generatedAt} selectedKey={selectedDrawerPull} onSelectionChange={setSelectedDrawerPull} onOpen={() => onSelect({ type: "pull-request", pull, repository: pull.repository })}><StatusIndicator type="info">Your review requested</StatusIndicator></DrawerPullOption> : null)}</SpaceBetween> : <CenteredDrawerEmptyState title="No reviews requested" detail="No open pull requests are waiting specifically for your review." />}
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
