import type { InfrastructureNode } from "./infrastructure-types";
import type { ApplicationExposure, SecurityFinding, Vulnerability } from "./security-types";
import type { Issue, Overview, PipelineRun, PullRequest, Repository, WorkflowFailure } from "./types";

export type ConsoleView = "overview" | "pull-requests" | "renovate" | "security" | "gitlab-tickets" | "uds-packages" | "infrastructure" | "repository";

export type DrawerSelection =
  | { type: "open-pulls"; repository?: string; unassignedOnly?: boolean }
  | { type: "renovate"; repository?: string; unassignedOnly?: boolean; majorOnly?: boolean }
  | { type: "review-requests"; repository?: string }
  | { type: "issues"; repository?: string }
  | { type: "pipelines"; repository?: string }
  | { type: "workflow-failure"; failure: WorkflowFailure }
  | { type: "my-work"; queue: "waiting-on-me" | "waiting-on-others" | "blocked" | "ready-to-merge" | "needs-ownership" | "assigned-issues"; repository?: string }
  | { type: "briefing"; since: string }
  | { type: "uds-versions" }
  | { type: "uds-common"; repository?: string }
  | { type: "uds-core" }
  | { type: "tool-release"; tool: keyof Overview["tools"] }
  | { type: "repository"; repository: Repository }
  | { type: "pull-request"; pull: PullRequest; repository?: string; focus?: "failed-checks"; focusRequest?: number }
  | { type: "pipeline-run"; run: PipelineRun; repository: string }
  | { type: "issue"; issue: Issue; repository: string }
  | { type: "security-finding"; repository: string; finding: SecurityFinding; vulnerability: Vulnerability; occurrences: SecurityFinding[]; exposure?: ApplicationExposure; pull?: PullRequest | null }
  | { type: "infrastructure-node"; node: InfrastructureNode };
