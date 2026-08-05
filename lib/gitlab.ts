import "server-only";

const DEFAULT_GITLAB_URL = "https://gitlab.sonic.mil";
const CACHE_TTL = 60_000;

type CacheEntry = { expires: number; value: unknown };
const responseCache = new Map<string, CacheEntry>();

export class GitLabApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "GitLabApiError";
  }
}

function token() {
  const value = process.env.GITLAB_TOKEN;
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

export async function gitlabRequest<T>(path: string, ttl = CACHE_TTL): Promise<T> {
  const cached = responseCache.get(path);
  if (cached && cached.expires > Date.now()) return cached.value as T;

  const response = await fetch(`${gitlabOrigin()}/api/v4${path}`, {
    headers: {
      Accept: "application/json",
      "PRIVATE-TOKEN": token(),
      "User-Agent": "d2d-operations-local",
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
    throw new GitLabApiError(`GitLab API: ${detail}`, response.status);
  }

  const value = (await response.json()) as T;
  responseCache.set(path, { value, expires: Date.now() + ttl });
  return value;
}

export async function gitlabAllPages<T>(path: string, maxPages = 20): Promise<T[]> {
  const results: T[] = [];
  const separator = path.includes("?") ? "&" : "?";

  for (let page = 1; page <= maxPages; page += 1) {
    const batch = await gitlabRequest<T[]>(`${path}${separator}per_page=100&page=${page}`);
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
  return { message: "An unexpected server error occurred while loading GitLab.", status: 500 };
}
