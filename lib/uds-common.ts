import { load } from "js-yaml";

export type UdsCommonInclude = {
  name: string;
  url: string;
  version: string | null;
};

const COMMON_REPOSITORY_URL = /(?:raw\.githubusercontent\.com|github\.com)\/defenseunicorns\/uds-common(?:\/|$)/i;
const SEMANTIC_VERSION = /v?(\d+\.\d+\.\d+)/i;

function includeName(parent: Record<string, unknown> | null, key: string, path: string[]) {
  if (key !== "url") return key;
  const candidate = parent?.name ?? parent?.task ?? parent?.id;
  if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  return path.at(-1) ?? "UDS Common tasks";
}

function collectIncludes(value: unknown, path: string[], results: UdsCommonInclude[], parent: Record<string, unknown> | null = null) {
  if (typeof value === "string") {
    if (!COMMON_REPOSITORY_URL.test(value)) return;
    const match = value.match(SEMANTIC_VERSION);
    results.push({
      name: includeName(parent, path.at(-1) ?? "include", path.slice(0, -1)),
      url: value,
      version: match?.[1] ?? null,
    });
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => collectIncludes(item, [...path, `include ${index + 1}`], results));
    return;
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    Object.entries(record).forEach(([key, item]) => collectIncludes(item, [...path, key], results, record));
  }
}

export function parseUdsCommonIncludes(content: string) {
  const document = load(content) as { includes?: unknown } | null;
  const results: UdsCommonInclude[] = [];
  collectIncludes(document?.includes, [], results);
  return results.filter((item, index) => results.findIndex((candidate) => candidate.url === item.url) === index);
}
