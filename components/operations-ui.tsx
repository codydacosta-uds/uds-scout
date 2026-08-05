import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Container from "@cloudscape-design/components/container";
import Link from "@cloudscape-design/components/link";
import SpaceBetween from "@cloudscape-design/components/space-between";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import { TEST_LAB_REPOSITORIES } from "@/lib/repository-constants";
import type { Overview, PipelineRun, PullRequest, Repository, UdsCommonRepository } from "./types";

export function relativeTime(date: string | null, generatedAt: string) {
  if (!date) return "No recent activity";
  const seconds = Math.max(0, Math.floor((new Date(generatedAt).getTime() - new Date(date).getTime()) / 1000));
  const elapsed = (value: number, unit: string) => `${value} ${unit}${value === 1 ? "" : "s"} ago`;
  if (seconds < 60) return "Just now";
  if (seconds < 3600) return elapsed(Math.floor(seconds / 60), "minute");
  if (seconds < 86_400) return elapsed(Math.floor(seconds / 3600), "hour");
  if (seconds < 2_592_000) return elapsed(Math.floor(seconds / 86_400), "day");
  if (seconds < 31_536_000) return elapsed(Math.floor(seconds / 2_592_000), "month");
  return elapsed(Math.floor(seconds / 31_536_000), "year");
}

export function newestPulls<T extends PullRequest>(pulls: readonly T[]) {
  return [...pulls].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export function canTestPullRequest(pull: PullRequest, repository: string | undefined) {
  if (!repository || !TEST_LAB_REPOSITORIES.some((candidate) => candidate.toLowerCase() === repository.toLowerCase())) return false;
  return !pull.headRepository || pull.headRepository.toLowerCase() === repository.toLowerCase();
}

export function pullRequestTestLabHref(pull: PullRequest, repository: string) {
  const query = new URLSearchParams({
    repository,
    branch: pull.head,
    workflow: "build-deploy-test",
    confirm: "true",
    pullRequest: String(pull.number),
  });
  return `/test-lab?${query.toString()}`;
}

const testLabActionStyle = {
  root: {
    background: { default: "#238636", hover: "#2ea043", active: "#1f6f32" },
    borderColor: { default: "#2ea043", hover: "#3fb950", active: "#238636" },
    color: { default: "#ffffff", hover: "#ffffff", active: "#ffffff" },
  },
} as const;

export function TestInLabButton({ onClick, disabled = false, children = "Test in lab" }: { onClick: () => void; disabled?: boolean; children?: React.ReactNode }) {
  return <Button variant="primary" iconName="bug" style={testLabActionStyle} disabled={disabled} onClick={onClick}>{children}</Button>;
}

export function pipelineFailed(conclusion: string | null | undefined) {
  return ["failure", "timed_out", "action_required", "startup_failure"].includes(conclusion ?? "");
}

export function pipelineStatus(pipeline: Repository["pipeline"]) {
  if (!pipeline) return <StatusIndicator type="pending">No pipeline data</StatusIndicator>;
  if (pipeline.status !== "completed") return <StatusIndicator type="in-progress">In progress</StatusIndicator>;
  if (pipeline.conclusion === "success") return <StatusIndicator type="success">Passing</StatusIndicator>;
  if (pipelineFailed(pipeline.conclusion)) return <StatusIndicator type="error">Failed</StatusIndicator>;
  return <StatusIndicator type="stopped">{pipeline.conclusion ?? "Unknown"}</StatusIndicator>;
}

export function runStatus(run: PipelineRun) {
  if (run.status !== "completed") return <StatusIndicator type="in-progress">In progress</StatusIndicator>;
  if (run.conclusion === "success") return <StatusIndicator type="success">Passed</StatusIndicator>;
  if (pipelineFailed(run.conclusion)) return <StatusIndicator type="error">Failed</StatusIndicator>;
  return <StatusIndicator type="stopped">{run.conclusion ?? "Unknown"}</StatusIndicator>;
}

export function repositoryHealth(repository: Repository) {
  if (pipelineFailed(repository.pipeline?.conclusion)) {
    return <StatusIndicator type="error">Pipeline failed</StatusIndicator>;
  }
  if (repository.reviewRequests > 0) {
    return <StatusIndicator type="info">Review requested</StatusIndicator>;
  }
  if (repository.unassignedRenovatePulls > 0) {
    return <StatusIndicator type="warning">Updates available</StatusIndicator>;
  }
  if (repository.unassignedPullRequests > 0) {
    return <StatusIndicator type="warning">Unassigned changes</StatusIndicator>;
  }
  if (repository.udsCommon && repository.udsCommon.status !== "current") {
    return <StatusIndicator type="warning">UDS Common attention</StatusIndicator>;
  }
  if (repository.health === "healthy") {
    return <StatusIndicator type="success">No action required</StatusIndicator>;
  }
  return <StatusIndicator type="pending">Status unavailable</StatusIndicator>;
}

export function udsCommonStatus(item: UdsCommonRepository | Repository["udsCommon"]) {
  if (!item) return <StatusIndicator type="stopped">Not applicable</StatusIndicator>;
  if (item.status === "current") return <StatusIndicator type="success">Current</StatusIndicator>;
  if (item.status === "outdated") return <StatusIndicator type="warning">Outdated</StatusIndicator>;
  if (item.status === "missing") return <StatusIndicator type="warning">tasks.yaml missing</StatusIndicator>;
  if (item.status === "not-configured") return <StatusIndicator type="warning">Not configured</StatusIndicator>;
  return <StatusIndicator type="pending">Unable to verify</StatusIndicator>;
}

export function PullAuthor({ pull }: { pull: PullRequest }) {
  if (pull.author === "ghost") return <Box color="text-body-secondary">ghost</Box>;
  return <Link href={`https://github.com/${encodeURIComponent(pull.author)}`} external>{pull.author}</Link>;
}

export function PullPeople({ people, empty = "Unassigned" }: {
  people: PullRequest["assignees"];
  empty?: string;
}) {
  if (!people.length) return <Box color="text-body-secondary">{empty}</Box>;
  return <>{people.map((person, index) => <span key={person.login}>{index ? ", " : ""}<Link href={`https://github.com/${encodeURIComponent(person.login)}`} external>{person.login}</Link></span>)}</>;
}

export function UdsCoreVersion({ udsCore }: { udsCore: Overview["udsCore"] }) {
  const differs = Boolean(
    udsCore.version &&
    udsCore.upstreamVersion &&
    udsCore.comparison !== "current" &&
    udsCore.comparison !== "unknown",
  );

  return (
    <>
      {udsCore.version ?? "Not detected"}
      {differs ? <>{" → "}<span className="uds-core-target-version"><Link href={udsCore.upstreamUrl} external fontSize="inherit">{udsCore.upstreamVersion}</Link></span></> : null}
    </>
  );
}

export function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <Box textAlign="center" color="inherit" padding={{ vertical: "xxl" }}>
      <SpaceBetween size="xs">
        <Box variant="strong">{title}</Box>
        <Box color="text-body-secondary">{detail}</Box>
      </SpaceBetween>
    </Box>
  );
}

export function DrawerKeyValueList({ items }: {
  items: { label: React.ReactNode; value: React.ReactNode }[];
}) {
  return (
    <dl className="drawer-key-value-list">
      {items.map((item, index) => (
        <div className="drawer-key-value-item" key={index}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function MetricCard({ title, value, description, status, onDetails, attention = false }: {
  title: string;
  value: React.ReactNode;
  description: string;
  status?: React.ReactNode;
  onDetails?: () => void;
  attention?: boolean;
}) {
  return (
    <Container className={attention ? "metric-card metric-card-attention" : "metric-card"}>
      <SpaceBetween size="s">
        <Box variant="awsui-key-label">{title}</Box>
        <Box variant="awsui-value-large" color={attention ? "text-status-error" : undefined}>{value}</Box>
        <Box color="text-body-secondary">{description}</Box>
        {status ? <Box>{status}</Box> : null}
        {onDetails ? <Button variant="inline-link" onClick={onDetails}>View details</Button> : null}
      </SpaceBetween>
    </Container>
  );
}
