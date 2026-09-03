import type { RenovateReviewDay } from "@/lib/renovate-review";
import type { RenovateUpdateDetails } from "@/lib/renovate-update";

export type ZeusFilesystemUsage = {
  label: string;
  path: string;
  totalBytes: number;
  usedBytes: number;
  availableBytes: number;
  usagePercent: number;
};

export type ZeusHealth = {
  hostname: string;
  capturedAt: string;
  cpuCount: number;
  cpuUsagePercent: number;
  loadAverage: [number, number, number];
  memory: {
    totalBytes: number;
    usedBytes: number;
    availableBytes: number;
    usagePercent: number;
  };
  filesystems: ZeusFilesystemUsage[];
  temporaryStorage: {
    path: "/tmp";
    usedBytes: number | null;
  };
  uptimeSeconds: number;
};

export type PullRequest = {
  id: number;
  number: number;
  title: string;
  url: string;
  state: string;
  draft: boolean;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  mergedAt: string | null;
  author: string;
  authorAvatar: string | null;
  head: string;
  headRepository: string | null;
  base: string;
  body: string | null;
  summary: string | null;
  labels: { name: string; color: string }[];
  assignees: { login: string; avatar: string | null }[];
  requestedReviewers: { login: string; avatar: string | null; url?: string; kind?: "user" | "team" }[];
  repository?: string;
  workflow: PullRequestWorkflow;
};

export type PullRequestWorkflow = {
  state: "waiting-on-me" | "waiting-on-others" | "blocked" | "ready-to-merge" | "needs-review" | "needs-approval" | "no-action";
  progress: "draft" | "no-approvals" | "partially-approved" | "fully-approved" | "ready-to-merge" | "approved-blocked" | "approved-unmerged" | "changes-requested" | "merge-conflict" | "waiting-reviewer" | "waiting-checks" | "unknown";
  label: string;
  reason: string;
  blockers: string[];
  waitingOn: string[];
  approvals: {
    count: number;
    required: number | null;
    reviewers: string[];
    changesRequestedBy: string[];
    decision: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null;
    lastApprovedAt: string | null;
  };
  checks: {
    requiredKnown: boolean;
    total: number;
    required: number;
    passed: number;
    pending: number;
    failing: number;
    failingNames: string[];
    rollup: {
      passed: number;
      pending: number;
      pendingChecks: { name: string; url: string | null }[];
      failing: number;
      failingNames: string[];
      failingChecks: { name: string; url: string | null }[];
      cancelled: number;
      cancelledNames: string[];
      cancelledChecks: { name: string; url: string | null }[];
    };
    summary: string;
  };
  mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
  mergeStateStatus: string;
  headSha: string | null;
  assignedToViewer: boolean;
  authoredByViewer: boolean;
  reviewRequestedFromViewer: boolean;
  automation: boolean;
  renovate: boolean;
  renovateUpdate: RenovateUpdateDetails | null;
  elevatedAutomation: boolean;
  ignored: boolean;
};

export type PipelineRun = {
  id: number;
  name: string;
  title: string;
  url: string;
  status: string;
  conclusion: string | null;
  event: string;
  number: number;
  branch: string | null;
  createdAt: string;
  updatedAt: string;
  actor: string;
  actorAvatar: string | null;
  commitSha: string | null;
  commitMessage: string | null;
  commitAuthor: string | null;
  failedJob: string | null;
  failedStep: string | null;
  failureSummary: string | null;
  blocksPullRequest: number | null;
  defaultBranch: boolean;
};

export type WorkflowFailure = PipelineRun & {
  repository: string;
  attentionReason: string;
};

export type DailyBriefingItem = {
  id: string;
  type: "review-request" | "pull-assigned" | "pull-approved" | "pull-merged" | "ready-to-merge" | "workflow-failure" | "workflow-recovery" | "issue-assigned";
  title: string;
  detail: string;
  repository: string;
  timestamp: string;
  url: string;
  pullRequest?: number;
};

export type Repository = {
  id: number;
  name: string;
  fullName: string;
  private: boolean;
  description: string | null;
  url: string;
  language: string | null;
  archived: boolean;
  fork: boolean;
  openItems: number;
  stars: number;
  forks: number;
  defaultBranch: string;
  pushedAt: string | null;
  updatedAt: string;
  visibility: string;
  openPullRequests: number;
  unassignedPullRequests: number;
  renovatePulls: number;
  unassignedRenovatePulls: number;
  reviewRequests: number;
  issueCount: number;
  udsCommon: { status: UdsCommonStatus; versions: string[]; tasksUrl: string | null } | null;
  health: "healthy" | "attention" | "unknown";
  attention: {
    level: "action-required" | "needs-attention" | "monitor" | "healthy" | "unknown";
    reason: string;
  };
  workflowCounts: {
    waitingOnMe: number;
    waitingOnOthers: number;
    blocked: number;
    readyToMerge: number;
  };
  pipeline: {
    name: string;
    status: string;
    conclusion: string | null;
    url: string;
    updatedAt: string;
  } | null;
};

export type OrganizationRepository = Pick<Repository,
  | "id"
  | "name"
  | "fullName"
  | "private"
  | "description"
  | "url"
  | "language"
  | "archived"
  | "fork"
  | "openItems"
  | "defaultBranch"
  | "pushedAt"
  | "updatedAt"
  | "visibility"
>;

export type RepositoryCatalog = {
  organization: string;
  url: string;
  metrics: {
    total: number;
    private: number;
    public: number;
    archived: number;
  };
  repositories: OrganizationRepository[];
  generatedAt: string;
};

export type RepositoryContributorCounts = {
  contributors: { repository: string; count: number | null }[];
  unavailable: number;
  generatedAt: string;
};

export type UdsCommonStatus = "current" | "outdated" | "missing" | "not-configured" | "unknown";

export type UdsCommonRepository = {
  repository: string;
  tasksUrl: string | null;
  includes: { name: string; url: string; version: string | null }[];
  versions: string[];
  status: UdsCommonStatus;
};

export type ToolRelease = {
  name: string;
  repository: string;
  version: string | null;
  previousVersion: string | null;
  publishedAt: string | null;
  url: string;
};

export type Overview = {
  viewer: { login: string; name: string | null; avatar: string; url: string };
  preferences: {
    renovateReviewDay: RenovateReviewDay;
  };
  capabilities: {
    sonic: boolean;
    testLab: boolean;
    gitlab: boolean;
    gitlabTickets: boolean;
  };
  metrics: {
    repositories: number;
    private: number;
    public: number;
    archived: number;
    forks: number;
    openItems: number;
    active30d: number;
    renovatePulls: number;
    openPullRequests: number;
    issueCount: number;
    pipelineFailures: number;
    repositoriesRequiringAttention: number;
    waitingOnMe: number;
    waitingOnOthers: number;
    blockedPullRequests: number;
    readyToMerge: number;
  };
  udsCommon: {
    latestVersion: string | null;
    latestUrl: string;
    latestReleaseNotes: string | null;
    repository: string;
    needsAttention: number;
    repositories: UdsCommonRepository[];
  };
  udsCore: {
    version: string | null;
    repository: string;
    sourcePath: string;
    url: string | null;
    upstreamVersion: string | null;
    upstreamUrl: string;
    upstreamReleaseNotes: string | null;
    comparison: "current" | "behind" | "ahead" | "unknown";
  };
  tools: {
    zarf: ToolRelease;
    pepr: ToolRelease;
    udsCli: ToolRelease;
  };
  pullRequests: (PullRequest & { repository: string })[];
  issues: (Issue & { repository: string })[];
  unassignedPullRequests: (PullRequest & { repository: string })[];
  reviewRequests: (PullRequest & { repository: string })[];
  myWork: {
    waitingOnMe: (PullRequest & { repository: string })[];
    waitingOnOthers: (PullRequest & { repository: string })[];
    blocked: (PullRequest & { repository: string })[];
    readyToMerge: (PullRequest & { repository: string })[];
    needsOwnership: (PullRequest & { repository: string })[];
    assignedIssues: (Issue & { repository: string })[];
  };
  briefing: {
    availableSince: string;
    items: DailyBriefingItem[];
  };
  pipelineRuns: (PipelineRun & { repository: string })[];
  workflowFailures: WorkflowFailure[];
  renovate: {
    total: number;
    unassignedTotal: number;
    pulls: (PullRequest & { repository: string })[];
  };
  repositories: Repository[];
  generatedAt: string;
};

export type Issue = {
  id: number;
  number: number;
  title: string;
  url: string;
  author: string;
  createdAt: string;
  updatedAt: string;
  labels: { name: string; color: string }[];
  assignees?: string[];
};

export type GitLabWorkItem = {
  id: number;
  iid: number;
  title: string;
  url: string;
  state: string;
  status: {
    name: string;
    color: string;
    iconName: string;
    category: string;
  } | null;
  type: string;
  project: string;
  reference: string;
  labels: string[];
  createdAt: string;
  updatedAt: string;
  dueDate: string | null;
  confidential: boolean;
};

export type GitLabWorkItems = {
  viewer: {
    username: string;
    name: string | null;
    avatarUrl: string | null;
    url: string;
  };
  items: GitLabWorkItem[];
  dashboardUrl: string;
  generatedAt: string;
};

export type RepositoryRelease = {
  id: number;
  tag: string;
  name: string;
  url: string;
  publishedAt: string | null;
  prerelease: boolean;
};

export type RepositoryWorkspace = {
  repository: Repository;
  releases: RepositoryRelease[];
  pullStats: { open: number; draft: number; closed: number; merged: number };
  pulls: { open: PullRequest[]; closed: PullRequest[] };
  issues?: Issue[];
  actions: { total: number; runs: PipelineRun[] } | null;
  generatedAt: string;
};
