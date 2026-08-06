import "server-only";

const DEFAULT_GITLAB_URL = "https://gitlab.sonic.mil";
const CACHE_TTL = 60_000;

type CacheEntry = { expires: number; value: unknown };
const responseCache = new Map<string, CacheEntry>();
const runtimeState = globalThis as typeof globalThis & { __udsScoutGitlabToken?: string; __udsScoutGitlabViewer?: string };

export type GitlabViewer = {
  username: string;
  name: string | null;
  avatar_url: string | null;
  web_url: string;
};

export type GitlabProject = {
  id: number;
  name: string;
  path_with_namespace: string;
  web_url: string;
  description: string | null;
  last_activity_at: string;
  permissions?: {
    project_access?: { access_level: number } | null;
    group_access?: { access_level: number } | null;
  };
};

export class GitLabApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "GitLabApiError";
  }
}

export function gitlabTokenStatus() {
  if (process.env.GITLAB_TOKEN) return { configured: true, source: "environment" as const };
  if (runtimeState.__udsScoutGitlabToken) return { configured: true, source: "session" as const };
  return { configured: false, source: null };
}

export function setSessionGitlabToken(value: string, viewer?: string) {
  runtimeState.__udsScoutGitlabToken = value;
  runtimeState.__udsScoutGitlabViewer = viewer;
  responseCache.clear();
}

export function clearSessionGitlabToken() {
  delete runtimeState.__udsScoutGitlabToken;
  delete runtimeState.__udsScoutGitlabViewer;
  responseCache.clear();
}

function token() {
  const value = process.env.GITLAB_TOKEN ?? runtimeState.__udsScoutGitlabToken;
  if (!value) {
    throw new GitLabApiError(
      "GITLAB_TOKEN is not available to the server. Export it before running npm run dev.",
      500,
    );
  }
  return value;
}

export function gitlabOrigin() {
  return (process.env.GITLAB_URL ?? DEFAULT_GITLAB_URL).replace(/\/$/, "");
}

export function gitlabAbsoluteUrl(value: string | null) {
  if (!value) return null;
  try {
    return new URL(value, `${gitlabOrigin()}/`).toString();
  } catch {
    return null;
  }
}

export async function validateGitlabToken(value: string) {
  const response = await fetch(`${gitlabOrigin()}/api/v4/user`, {
    headers: {
      Accept: "application/json",
      "PRIVATE-TOKEN": value,
      "User-Agent": "uds-scout-local",
    },
    cache: "no-store",
  });
  if (!response.ok) throw new GitLabApiError(response.status === 401 ? "Gitlab rejected the token." : `Gitlab token validation failed: ${response.statusText}`, response.status);
  return await response.json() as GitlabViewer;
}

export async function gitlabRequest<T>(path: string, ttl = CACHE_TTL, bypassCache = false): Promise<T> {
  const cached = responseCache.get(path);
  if (!bypassCache && cached && cached.expires > Date.now()) return cached.value as T;

  const response = await fetch(`${gitlabOrigin()}/api/v4${path}`, {
    headers: {
      Accept: "application/json",
      "PRIVATE-TOKEN": token(),
      "User-Agent": "uds-scout-local",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = (await response.json()) as { message?: string | Record<string, string[]>; error?: string };
      detail = typeof body.message === "string" ? body.message : body.error ?? detail;
    } catch {
      // Keep the HTTP status text when GitLab does not return JSON.
    }
    throw new GitLabApiError(`Gitlab API: ${detail}`, response.status);
  }

  const value = (await response.json()) as T;
  responseCache.set(path, { value, expires: Date.now() + ttl });
  return value;
}

export async function gitlabGraphqlRequest<T>(query: string, variables: Record<string, unknown> = {}, ttl = CACHE_TTL): Promise<T> {
  const cacheKey = `graphql:${query}:${JSON.stringify(variables)}`;
  const cached = responseCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.value as T;

  const response = await fetch(`${gitlabOrigin()}/api/graphql`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "PRIVATE-TOKEN": token(),
      "User-Agent": "uds-scout-local",
    },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });

  const payload = await response.json() as { data?: T; errors?: { message?: string }[] };
  if (!response.ok || !payload.data || payload.errors?.length) {
    const detail = payload.errors?.map((error) => error.message).filter(Boolean).join("; ") || response.statusText;
    throw new GitLabApiError(`Gitlab GraphQL API: ${detail}`, response.ok ? 502 : response.status);
  }

  responseCache.set(cacheKey, { value: payload.data, expires: Date.now() + ttl });
  return payload.data;
}

export async function gitlabMutation<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${gitlabOrigin()}/api/v4${path}`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "PRIVATE-TOKEN": token(),
      "User-Agent": "uds-scout-local",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  if (!response.ok) {
    let detail = response.statusText;
    try {
      const payload = await response.json() as { message?: string | Record<string, string[]>; error?: string };
      detail = typeof payload.message === "string"
        ? payload.message
        : payload.error ?? (payload.message ? JSON.stringify(payload.message) : detail);
    } catch {
      // Keep the HTTP status text when GitLab does not return JSON.
    }
    throw new GitLabApiError(`Gitlab API: ${detail}`, response.status);
  }

  responseCache.clear();
  return response.json() as Promise<T>;
}

export async function gitlabAccessibleProjects() {
  return gitlabAllPages<GitlabProject>("/projects?membership=true&order_by=last_activity_at&sort=desc", 20);
}

export async function gitlabProjectPreflight(projectPath: string, fresh = false) {
  const encodedProject = encodeURIComponent(projectPath);
  const project = await gitlabRequest<GitlabProject>(`/projects/${encodedProject}`, 5 * 60_000, fresh);
  await gitlabRequest<unknown[]>(`/projects/${encodedProject}/issues?state=opened&per_page=1`, 5 * 60_000, fresh);
  const accessLevel = Math.max(project.permissions?.project_access?.access_level ?? 0, project.permissions?.group_access?.access_level ?? 0);
  return {
    project,
    canReadWorkItems: true,
    canCreateTickets: accessLevel >= 30,
    accessLevel,
  };
}

export async function gitlabAllPages<T>(path: string, maxPages = 20, bypassCache = false): Promise<T[]> {
  const results: T[] = [];
  const separator = path.includes("?") ? "&" : "?";

  for (let page = 1; page <= maxPages; page += 1) {
    const batch = await gitlabRequest<T[]>(`${path}${separator}per_page=100&page=${page}`, CACHE_TTL, bypassCache);
    results.push(...batch);
    if (batch.length < 100) break;
  }
  return results;
}

export function gitlabApiError(error: unknown) {
  if (error instanceof GitLabApiError) {
    return { message: error.message, status: error.status };
  }
  console.error(error);
  return { message: "An unexpected server error occurred while loading Gitlab.", status: 500 };
}
