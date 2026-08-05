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
  requestedReviewers: { login: string; avatar: string | null }[];
  repository?: string;
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
  udsCommon: { status: UdsCommonStatus; versions: string[] } | null;
  health: "healthy" | "attention" | "unknown";
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
  url: string;
};

export type Overview = {
  viewer: { login: string; name: string | null; avatar: string; url: string };
  capabilities: {
    sonic: boolean;
    testLab: boolean;
    gitlab: boolean;
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
  };
  pullRequests: (PullRequest & { repository: string })[];
  unassignedPullRequests: (PullRequest & { repository: string })[];
  reviewRequests: (PullRequest & { repository: string })[];
  renovate: {
    total: number;
    unassignedTotal: number;
    pulls: (PullRequest & { repository: string })[];
  };
  repositories: Repository[];
  rateLimit: { remaining: number; limit: number; resetsAt: string };
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
};

export type GitLabWorkItem = {
  id: number;
  iid: number;
  title: string;
  url: string;
  state: string;
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

export type RepositoryWorkspace = {
  repository: Repository;
  pullStats: { open: number; draft: number; closed: number; merged: number };
  pulls: { open: PullRequest[]; closed: PullRequest[] };
  issues?: Issue[];
  actions: { total: number; runs: PipelineRun[] } | null;
  generatedAt: string;
};
