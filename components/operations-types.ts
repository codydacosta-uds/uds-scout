import type { InfrastructureNode } from "./infrastructure-types";
import type { Issue, Overview, PipelineRun, PullRequest, Repository } from "./types";

export type ConsoleView = "overview" | "pull-requests" | "renovate" | "uds-packages" | "infrastructure" | "test-lab" | "repository";

export type DrawerSelection =
  | { type: "open-pulls"; repository?: string; unassignedOnly?: boolean }
  | { type: "renovate"; repository?: string; unassignedOnly?: boolean }
  | { type: "review-requests"; repository?: string }
  | { type: "issues"; repository?: string }
  | { type: "pipelines"; repository?: string }
  | { type: "uds-versions" }
  | { type: "uds-common"; repository?: string }
  | { type: "uds-core" }
  | { type: "tool-release"; tool: keyof Overview["tools"] }
  | { type: "repository"; repository: Repository }
  | { type: "pull-request"; pull: PullRequest; repository?: string }
  | { type: "pipeline-run"; run: PipelineRun; repository: string }
  | { type: "issue"; issue: Issue; repository: string }
  | { type: "infrastructure-node"; node: InfrastructureNode };
