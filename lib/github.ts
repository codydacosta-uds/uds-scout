import "server-only";

const API_ROOT = "https://api.github.com";
const API_VERSION = "2022-11-28";
const CACHE_TTL = 60_000;

type CacheEntry = { expires: number; value: unknown };
const responseCache = new Map<string, CacheEntry>();
const contributorCountCache = new Map<string, CacheEntry>();
const runtimeState = globalThis as typeof globalThis & { __d2dGitHubToken?: string };

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

export function setSessionGitHubToken(value: string) {
  runtimeState.__d2dGitHubToken = value;
  clearGitHubCache();
}

export function clearGitHubCache() {
  responseCache.clear();
  contributorCountCache.clear();
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
      "User-Agent": "gh-dash-local",
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

export async function githubRequest<T>(path: string, ttl = CACHE_TTL): Promise<T> {
  const cached = responseCache.get(path);
  if (cached && cached.expires > Date.now()) return cached.value as T;

  const response = await fetch(`${API_ROOT}${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token()}`,
      "X-GitHub-Api-Version": API_VERSION,
      "User-Agent": "gh-dash-local",
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
  responseCache.set(path, { value, expires: Date.now() + ttl });
  return value;
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
      "User-Agent": "gh-dash-local",
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

export function apiError(error: unknown) {
  if (error instanceof GitHubApiError) {
    return { message: error.message, status: error.status };
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
    requestedReviewers: pull.requested_reviewers?.map((reviewer) => ({ login: reviewer.login, avatar: reviewer.avatar_url ?? null })) ?? [],
  };
}
