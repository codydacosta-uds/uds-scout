import "server-only";

const API_ROOT = "https://api.github.com";
const API_VERSION = "2022-11-28";
const CACHE_TTL = 60_000;
const USER_AGENT = "uds-scout-local";

type CacheEntry = { expires: number; value: unknown };
const responseCache = new Map<string, CacheEntry>();
const contributorCountCache = new Map<string, CacheEntry>();
const inFlightRequests = new Map<string, Promise<unknown>>();
let cacheGeneration = 0;
const runtimeState = globalThis as typeof globalThis & { __d2dGitHubToken?: string; __d2dGitHubViewer?: string };

export class GitHubApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "GitHubApiError";
  }
}

export function githubTokenStatus() {
  if (process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN) return { configured: true, source: "environment" as const };
  if (runtimeState.__d2dGitHubToken) return { configured: true, source: "session" as const };
  return { configured: false, source: null };
}

export function setSessionGitHubToken(value: string, viewer?: string) {
  runtimeState.__d2dGitHubToken = value;
  runtimeState.__d2dGitHubViewer = viewer;
  clearGitHubCache();
}

export function clearSessionGitHubToken() {
  delete runtimeState.__d2dGitHubToken;
  delete runtimeState.__d2dGitHubViewer;
  clearGitHubCache();
}

export function currentGitHubViewer() {
  return runtimeState.__d2dGitHubViewer ?? null;
}

export function githubContainerRegistryAuthorization() {
  const viewer = currentGitHubViewer() ?? "uds-scout";
  return `Basic ${Buffer.from(`${viewer}:${token()}`, "utf8").toString("base64")}`;
}

export function clearGitHubCache() {
  cacheGeneration += 1;
  responseCache.clear();
  contributorCountCache.clear();
  inFlightRequests.clear();
}

function token() {
  const value = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? runtimeState.__d2dGitHubToken;
  if (!value) {
    throw new GitHubApiError(
      "GITHUB_TOKEN is not available to the server. Export it or complete local setup.",
      500,
    );
  }
  return value;
}

export async function validateGitHubToken(value: string) {
  const response = await fetch(`${API_ROOT}/user`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${value}`,
      "X-GitHub-Api-Version": API_VERSION,
      "User-Agent": USER_AGENT,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new GitHubApiError(
      response.status === 401 ? "GitHub rejected the token." : `GitHub token validation failed: ${response.statusText}`,
      response.status,
    );
  }

  return await response.json() as { login: string; name: string | null; avatar_url: string; html_url: string };
}

export async function githubWorkflowRerun(repository: string, runId: number, jobId?: number) {
  const path = jobId
    ? `/repos/${repository}/actions/jobs/${jobId}/rerun`
    : `/repos/${repository}/actions/runs/${runId}/rerun`;
  const response = await fetch(`${API_ROOT}${path}`, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token()}`,
      "X-GitHub-Api-Version": API_VERSION,
      "User-Agent": USER_AGENT,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = (await response.json()) as { message?: string };
      detail = body.message ?? detail;
    } catch {
      // Keep the HTTP status text when GitHub does not return JSON.
    }
    throw new GitHubApiError(`GitHub API: ${detail}`, response.status);
  }

  clearGitHubCache();
}

export async function githubRequest<T>(path: string, ttl = CACHE_TTL): Promise<T> {
  const cached = responseCache.get(path);
  if (cached && cached.expires > Date.now()) {
    if (path === "/user" && cached.value && typeof cached.value === "object" && "login" in cached.value && typeof (cached.value as { login?: unknown }).login === "string") {
      runtimeState.__d2dGitHubViewer = (cached.value as { login: string }).login;
    }
    return cached.value as T;
  }
  if (cached) responseCache.delete(path);

  const pending = inFlightRequests.get(path);
  if (pending) return await pending as T;

  const generation = cacheGeneration;
  const request = (async () => {
    const response = await fetch(`${API_ROOT}${path}`, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token()}`,
        "X-GitHub-Api-Version": API_VERSION,
        "User-Agent": USER_AGENT,
      },
      cache: "no-store",
    });

    if (!response.ok) {
      let detail = response.statusText;
      try {
        const body = (await response.json()) as { message?: string };
        detail = body.message ?? detail;
      } catch {
        // Keep the HTTP status text when GitHub does not return JSON.
      }
      throw new GitHubApiError(`GitHub API: ${detail}`, response.status);
    }

    const value = (await response.json()) as T;
    if (path === "/user" && value && typeof value === "object" && "login" in value && typeof (value as { login?: unknown }).login === "string") {
      runtimeState.__d2dGitHubViewer = (value as { login: string }).login;
    }
    if (generation === cacheGeneration) responseCache.set(path, { value, expires: Date.now() + ttl });
    return value;
  })();

  inFlightRequests.set(path, request);
  try {
    return await request;
  } finally {
    if (inFlightRequests.get(path) === request) inFlightRequests.delete(path);
  }
}

export async function githubBinaryRequest(path: string, maximumBytes = 20 * 1024 * 1024) {
  const response = await fetch(`${API_ROOT}${path}`, {
    headers: {
      Accept: "application/octet-stream",
      Authorization: `Bearer ${token()}`,
      "X-GitHub-Api-Version": API_VERSION,
      "User-Agent": USER_AGENT,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new GitHubApiError(`GitHub asset download failed: ${response.statusText}`, response.status);
  const declaredSize = Number(response.headers.get("content-length") ?? 0);
  if (declaredSize > maximumBytes) throw new GitHubApiError("GitHub asset exceeds Scout's security metadata size limit.", 413);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maximumBytes) throw new GitHubApiError("GitHub asset exceeds Scout's security metadata size limit.", 413);
  return bytes;
}

export async function githubGraphQL<T>(query: string, variables: Record<string, unknown>, ttl = CACHE_TTL): Promise<T> {
  const key = `graphql:${query}:${JSON.stringify(variables)}`;
  const cached = responseCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.value as T;
  if (cached) responseCache.delete(key);

  const pending = inFlightRequests.get(key);
  if (pending) return await pending as T;

  const generation = cacheGeneration;
  const request = (async () => {
    const response = await fetch(`${API_ROOT}/graphql`, {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token()}`,
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
      },
      body: JSON.stringify({ query, variables }),
      cache: "no-store",
    });

    const body = await response.json() as { data?: T; errors?: { message: string }[] };
    if (!response.ok || !body.data || body.errors?.length) {
      const detail = body.errors?.map((error) => error.message).join("; ") || response.statusText;
      throw new GitHubApiError(`GitHub GraphQL API: ${detail}`, response.status || 500);
    }

    if (generation === cacheGeneration) responseCache.set(key, { value: body.data, expires: Date.now() + ttl });
    return body.data;
  })();

  inFlightRequests.set(key, request);
  try {
    return await request;
  } finally {
    if (inFlightRequests.get(key) === request) inFlightRequests.delete(key);
  }
}

export async function githubAllPages<T>(path: string, maxPages = 20): Promise<T[]> {
  const results: T[] = [];
  const separator = path.includes("?") ? "&" : "?";

  for (let page = 1; page <= maxPages; page += 1) {
    const batch = await githubRequest<T[]>(`${path}${separator}per_page=100&page=${page}`);
    results.push(...batch);
    if (batch.length < 100) break;
  }
  return results;
}

export async function githubContributorCount(repository: string, ttl = 30 * 60_000): Promise<number | null> {
  const key = repository.toLowerCase();
  const cached = contributorCountCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.value as number | null;

  const response = await fetch(`${API_ROOT}/repos/${repository}/contributors?per_page=1&anon=true`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token()}`,
      "X-GitHub-Api-Version": API_VERSION,
      "User-Agent": USER_AGENT,
    },
    cache: "no-store",
  });

  if (response.status === 204 || response.status === 409) {
    contributorCountCache.set(key, { value: 0, expires: Date.now() + ttl });
    return 0;
  }

  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = (await response.json()) as { message?: string };
      detail = body.message ?? detail;
    } catch {
      // Keep the HTTP status text when GitHub does not return JSON.
    }
    if (response.status === 403 && detail.toLowerCase().includes("saml enforcement")) {
      contributorCountCache.set(key, { value: null, expires: Date.now() + 5 * 60_000 });
      return null;
    }
    throw new GitHubApiError(`GitHub API: ${detail}`, response.status);
  }

  const contributors = (await response.json()) as unknown[];
  const lastPage = response.headers.get("link")?.match(/[?&]page=(\d+)>;\s*rel="last"/)?.[1];
  const count = lastPage ? Number(lastPage) : contributors.length;
  contributorCountCache.set(key, { value: count, expires: Date.now() + ttl });
  return count;
}

type NetworkErrorDetail = {
  cause?: unknown;
  code?: unknown;
  message?: unknown;
  name?: unknown;
};

function networkErrorChain(error: unknown) {
  const chain: NetworkErrorDetail[] = [];
  let current = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth += 1) {
    const detail = current as NetworkErrorDetail;
    chain.push(detail);
    if (!detail.cause || detail.cause === current) break;
    current = detail.cause;
  }
  return chain;
}

function githubNetworkError(error: unknown) {
  const chain = networkErrorChain(error);
  const codes = new Set(chain.flatMap((detail) => typeof detail.code === "string" ? [detail.code] : []));
  const fetchFailed = chain.some((detail) => detail.name === "TypeError" && detail.message === "fetch failed");

  if (codes.has("EAI_AGAIN") || codes.has("ENOTFOUND")) {
    return {
      message: "GitHub could not be reached because Scout could not resolve api.github.com. Check the Docker or host network connection, then try again.",
      status: 503,
    };
  }
  if (["ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT"].some((code) => codes.has(code))) {
    return {
      message: "GitHub did not respond before the connection timed out. Check the Docker or host network connection, then try again.",
      status: 503,
    };
  }
  if (fetchFailed || ["ECONNREFUSED", "ECONNRESET", "ENETUNREACH", "EHOSTUNREACH"].some((code) => codes.has(code))) {
    return {
      message: "Scout could not connect to GitHub. Check the Docker or host network connection, then try again.",
      status: 503,
    };
  }
  return null;
}

export function apiError(error: unknown) {
  if (error instanceof GitHubApiError) {
    return { message: error.message, status: error.status };
  }
  const networkFailure = githubNetworkError(error);
  if (networkFailure) {
    console.error("GitHub network request failed.", error);
    return networkFailure;
  }
  console.error(error);
  return { message: "An unexpected server error occurred.", status: 500 };
}

export type RawRepo = {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  description: string | null;
  html_url: string;
  language: string | null;
  archived: boolean;
  fork: boolean;
  open_issues_count: number;
  stargazers_count: number;
  forks_count: number;
  default_branch: string;
  pushed_at: string | null;
  updated_at: string;
  visibility: string;
  owner: { login: string; avatar_url: string };
};

export type RawPull = {
  id: number;
  number: number;
  title: string;
  html_url: string;
  state: string;
  draft: boolean;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  merged_at: string | null;
  user: { login: string; avatar_url: string } | null;
  head: { ref: string; repo: { full_name: string } | null };
  base: { ref: string };
  body?: string | null;
  labels?: { name: string; color: string }[];
  assignees?: { login: string; avatar_url: string }[];
  requested_reviewers?: { login: string; avatar_url: string }[];
};

export type RawRun = {
  id: number;
  name: string;
  display_title: string;
  html_url: string;
  status: string;
  conclusion: string | null;
  event: string;
  run_number: number;
  created_at: string;
  updated_at: string;
  actor: { login: string; avatar_url: string } | null;
  head_branch: string | null;
  head_sha: string;
  head_commit?: {
    id: string;
    message: string;
    timestamp: string;
    author: { name: string; email: string; username: string | null } | null;
  } | null;
};

export function presentRepo(repo: RawRepo) {
  return {
    id: repo.id,
    name: repo.name,
    fullName: repo.full_name,
    private: repo.private,
    description: repo.description,
    url: repo.html_url,
    language: repo.language,
    archived: repo.archived,
    fork: repo.fork,
    openItems: repo.open_issues_count,
    stars: repo.stargazers_count,
    forks: repo.forks_count,
    defaultBranch: repo.default_branch,
    pushedAt: repo.pushed_at,
    updatedAt: repo.updated_at,
    visibility: repo.visibility,
  };
}

export function presentPull(pull: RawPull) {
  const ignored = pull.labels?.some((label) => label.name.toLowerCase() === "stale") ?? false;
  return {
    id: pull.id,
    number: pull.number,
    title: pull.title,
    url: pull.html_url,
    state: pull.state,
    draft: pull.draft,
    createdAt: pull.created_at,
    updatedAt: pull.updated_at,
    closedAt: pull.closed_at,
    mergedAt: pull.merged_at,
    author: pull.user?.login ?? "ghost",
    authorAvatar: pull.user?.avatar_url ?? null,
    head: pull.head.ref,
    headRepository: pull.head.repo?.full_name ?? null,
    base: pull.base.ref,
    body: pull.body?.trim() || null,
    summary: pull.body?.replace(/[#*_`>\[\]]/g, "").replace(/\s+/g, " ").trim().slice(0, 240) || null,
    labels: pull.labels?.map((label) => ({ name: label.name, color: label.color })) ?? [],
    assignees: pull.assignees?.map((assignee) => ({ login: assignee.login, avatar: assignee.avatar_url ?? null })) ?? [],
    requestedReviewers: pull.requested_reviewers?.map((reviewer) => ({ login: reviewer.login, avatar: reviewer.avatar_url ?? null, kind: "user" as const })) ?? [],
    workflow: {
      state: "no-action" as const,
      progress: pull.draft ? "draft" as const : "unknown" as const,
      label: ignored ? "No action required" : pull.draft ? "Draft" : "Unable to verify",
      reason: ignored ? "The stale label removes this pull request from operational attention." : pull.draft ? "The pull request is still a draft." : "Detailed review, check, and merge state is unavailable.",
      blockers: [],
      waitingOn: [],
      approvals: { count: 0, required: null, reviewers: [], changesRequestedBy: [], decision: null, lastApprovedAt: null },
      checks: { requiredKnown: false, total: 0, required: 0, passed: 0, pending: 0, failing: 0, failingNames: [], rollup: { passed: 0, pending: 0, pendingChecks: [], failing: 0, failingNames: [], failingChecks: [], cancelled: 0, cancelledNames: [], cancelledChecks: [] }, summary: "Unable to verify required checks" },
      mergeable: "UNKNOWN" as const,
      mergeStateStatus: "UNKNOWN",
      headSha: null,
      assignedToViewer: false,
      authoredByViewer: false,
      reviewRequestedFromViewer: false,
      automation: false,
      renovate: false,
      renovateUpdate: null,
      elevatedAutomation: false,
      ignored,
    },
  };
}
