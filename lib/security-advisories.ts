import "server-only";

import { load } from "js-yaml";
import semver from "semver";
import { githubRequest } from "@/lib/github";
import { expectedAdvisorySources, normalizeAdvisoryVersion, supportsGithubRepositoryAdvisories } from "@/lib/security-products";
import type { SBOMPackage, SecuritySeverity, Vulnerability } from "@/components/security-types";

export type AdvisoryMatch = {
  vulnerability: Vulnerability;
  fixedVersion: string | null;
  affectedVersion: string | null;
  source: "OSV" | "GitHub Advisory" | "GitHub Repository Advisory" | "NVD" | "Jenkins Security Advisory" | "GitLab Security Release" | "Defense Unicorns Registry";
};

type OsvQuery = { version: string; package: { purl?: string; ecosystem?: string; name?: string } };
type OsvBatch = { results: { vulns?: { id: string; modified?: string }[] }[] };
type OsvVulnerability = {
  id: string;
  aliases?: string[];
  summary?: string;
  details?: string;
  modified?: string;
  published?: string;
  severity?: { type: string; score: string }[];
  references?: { url: string }[];
  affected?: { package?: { purl?: string; ecosystem?: string; name?: string }; ranges?: { type: string; events: { introduced?: string; fixed?: string; last_affected?: string; limit?: string }[] }[]; database_specific?: { severity?: string }; ecosystem_specific?: { severity?: string; custom_ranges?: { type?: string; events?: { introduced?: string; fixed?: string; last_affected?: string; limit?: string }[] }[] } }[];
  database_specific?: { severity?: string };
};
type GithubAdvisory = {
  ghsa_id: string;
  cve_id: string | null;
  url: string;
  html_url: string;
  summary: string;
  description: string;
  severity: string;
  published_at: string;
  updated_at: string;
  cvss?: { score?: number; vector_string?: string };
  cwes?: { cwe_id: string; name: string }[];
  vulnerabilities?: { package: { ecosystem: string; name: string }; vulnerable_version_range: string; first_patched_version: string | null }[];
  references?: string[];
};

type NvdCve = {
  id: string;
  vulnStatus?: string;
  published?: string;
  lastModified?: string;
  descriptions?: { lang: string; value: string }[];
  references?: { url: string }[];
  metrics?: Record<string, Array<{ cvssData?: { baseScore?: number; baseSeverity?: string } }>>;
  configurations?: unknown;
};

type NvdResponse = { vulnerabilities?: { cve: NvdCve }[] };
type JenkinsWarning = { id: string; message: string; name: string; type: string; url: string; versions?: { pattern?: string; lastVersion?: string }[] };
type JenkinsUpdateCenter = { warnings?: JenkinsWarning[] };
type JenkinsAdvisory = {
  core?: { weekly?: { previous?: string; fixed?: string }; lts?: { previous?: string; fixed?: string } };
  issues?: Array<{ id?: string; title?: string; cve?: string; cvss?: { severity?: string; vector?: string }; description?: string; plugins?: unknown[] }>;
};

export type ApplicationAdvisoryInput = {
  name: string;
  version: string;
  purl: string | null;
  cpe: string | null;
  upstreamRepository: string | null;
};

type ApplicationAdvisoryProvider = {
  id: string;
  label: string;
  supports: (input: ApplicationAdvisoryInput) => boolean;
  query: (input: ApplicationAdvisoryInput) => Promise<AdvisoryMatch[]>;
};

const UPSTREAM_ADVISORY_TTL = 15 * 60_000;
const osvDetailsCache = new Map<string, { expires: number; value: OsvVulnerability }>();
const nvdCache = new Map<string, { expires: number; value: AdvisoryMatch[] }>();
const nvdInflight = new Map<string, Promise<AdvisoryMatch[]>>();
let nvdRequestGate = Promise.resolve();
let nextNvdRequestAt = 0;
let jenkinsUpdateCache: { expires: number; value: JenkinsUpdateCenter } | null = null;
let gitlabReleaseCache: { expires: number; value: string } | null = null;
const jenkinsAdvisoryCache = new Map<string, { expires: number; value: JenkinsAdvisory }>();

function severity(value: string | null | undefined): SecuritySeverity {
  const normalized = value?.toLowerCase();
  return normalized === "critical" || normalized === "high" || normalized === "medium" || normalized === "moderate" || normalized === "low"
    ? normalized === "moderate" ? "medium" : normalized
    : "unknown";
}

function cvssScore(values: { score: string }[] | undefined) {
  for (const value of values ?? []) {
    const parsed = Number(value.score);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function severityFromCvss(score: number | null) {
  if (score === null) return "unknown" as const;
  if (score >= 9) return "critical" as const;
  if (score >= 7) return "high" as const;
  if (score >= 4) return "medium" as const;
  if (score > 0) return "low" as const;
  return "unknown" as const;
}

function canonicalId(ids: string[]) {
  return ids.find((id) => /^CVE-/i.test(id)) ?? ids.find((id) => /^GHSA-/i.test(id)) ?? ids[0];
}

async function osvDetail(id: string) {
  const cached = osvDetailsCache.get(id);
  if (cached && cached.expires > Date.now()) return cached.value;
  const response = await fetch(`https://api.osv.dev/v1/vulns/${encodeURIComponent(id)}`, { headers: { "User-Agent": "uds-scout-security" }, cache: "no-store", signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`OSV vulnerability lookup returned ${response.status}.`);
  const value = await response.json() as OsvVulnerability;
  osvDetailsCache.set(id, { value, expires: Date.now() + 12 * 60 * 60_000 });
  return value;
}

async function mapLimit<T, R>(items: T[], concurrency: number, task: (item: T) => Promise<R>) {
  const output = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      output[index] = await task(items[index]);
    }
  }));
  return output;
}

function numericVersion(value: string) {
  const match = value.replace(/^(?:go|v)(?=\d)/i, "").match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  return match ? [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)] : null;
}

function relevantFixedVersion(installed: string, fixedVersions: string[]) {
  const current = numericVersion(installed);
  if (!current) return fixedVersions[0] ?? null;
  const candidates = fixedVersions.flatMap((version) => {
    const parsed = numericVersion(version);
    return parsed ? [{ version, parsed }] : [];
  }).filter((candidate) => candidate.parsed.some((part, index) => part !== current[index]) && candidate.parsed.find((part, index) => part !== current[index])! > current[candidate.parsed.findIndex((part, index) => part !== current[index])]);
  candidates.sort((left, right) => left.parsed[0] - right.parsed[0] || left.parsed[1] - right.parsed[1] || left.parsed[2] - right.parsed[2]);
  return candidates[0]?.version ?? null;
}

function compareNvdVersions(left: string, right: string) {
  const normalizedLeft = left.toLowerCase().replace(/^v(?=\d)/, "").replace(/^release[.-]/, "");
  const normalizedRight = right.toLowerCase().replace(/^v(?=\d)/, "").replace(/^release[.-]/, "");
  const semverLeft = semver.valid(normalizedLeft);
  const semverRight = semver.valid(normalizedRight);
  if (semverLeft && semverRight) return semver.compare(semverLeft, semverRight);
  const leftParts = normalizedLeft.match(/\d+|[a-z]+/g) ?? [normalizedLeft];
  const rightParts = normalizedRight.match(/\d+|[a-z]+/g) ?? [normalizedRight];
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const leftPart = leftParts[index] ?? "0";
    const rightPart = rightParts[index] ?? "0";
    const leftNumber = /^\d+$/.test(leftPart) ? BigInt(leftPart) : null;
    const rightNumber = /^\d+$/.test(rightPart) ? BigInt(rightPart) : null;
    const comparison = leftNumber !== null && rightNumber !== null
      ? leftNumber < rightNumber ? -1 : leftNumber > rightNumber ? 1 : 0
      : leftPart.localeCompare(rightPart);
    if (comparison) return comparison;
  }
  return 0;
}

function nvdCpeMatchAffects(match: Record<string, unknown>, cpe: string, version: string) {
  if (match.vulnerable === false || typeof match.criteria !== "string") return false;
  const coordinate = cpe.split(":").slice(0, 5).join(":").toLowerCase();
  const criteria = match.criteria.toLowerCase();
  if (!criteria.startsWith(`${coordinate}:`)) return false;
  const criteriaVersion = match.criteria.split(":")[5];
  if (criteriaVersion && criteriaVersion !== "*" && criteriaVersion !== "-" && compareNvdVersions(version, criteriaVersion) !== 0) return false;
  if (criteriaVersion === "-") return false;
  const startIncluding = typeof match.versionStartIncluding === "string" ? match.versionStartIncluding : null;
  const startExcluding = typeof match.versionStartExcluding === "string" ? match.versionStartExcluding : null;
  const endIncluding = typeof match.versionEndIncluding === "string" ? match.versionEndIncluding : null;
  const endExcluding = typeof match.versionEndExcluding === "string" ? match.versionEndExcluding : null;
  if (startIncluding && compareNvdVersions(version, startIncluding) < 0) return false;
  if (startExcluding && compareNvdVersions(version, startExcluding) <= 0) return false;
  if (endIncluding && compareNvdVersions(version, endIncluding) > 0) return false;
  if (endExcluding && compareNvdVersions(version, endExcluding) >= 0) return false;
  return true;
}

function matchingNvdCpeEntries(configurations: unknown, cpe: string, version: string) {
  const matches: Record<string, unknown>[] = [];
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    if (record.negate === true) return;
    if (Array.isArray(record.cpeMatch)) {
      for (const item of record.cpeMatch) {
        if (item && typeof item === "object" && nvdCpeMatchAffects(item as Record<string, unknown>, cpe, version)) matches.push(item as Record<string, unknown>);
      }
    }
    for (const child of Object.values(record)) {
      if (Array.isArray(child)) child.forEach(visit);
      else if (child && typeof child === "object") visit(child);
    }
  };
  visit(configurations);
  return matches;
}

function nvdFixedVersions(matches: Record<string, unknown>[]) {
  return [...new Set(matches.flatMap((match) => typeof match.versionEndExcluding === "string" ? [match.versionEndExcluding] : []))];
}

function nvdScore(cve: NvdCve) {
  for (const key of ["cvssMetricV40", "cvssMetricV31", "cvssMetricV30", "cvssMetricV2"]) {
    for (const metric of cve.metrics?.[key] ?? []) {
      if (typeof metric.cvssData?.baseScore === "number") return { score: metric.cvssData.baseScore, severity: severity(metric.cvssData.baseSeverity) };
    }
  }
  return { score: null, severity: "unknown" as const };
}

async function scheduledNvdRequest(cpe: string) {
  const previous = nvdRequestGate;
  let release = () => {};
  nvdRequestGate = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    const wait = Math.max(0, nextNvdRequestAt - Date.now());
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    const apiKey = process.env.NVD_API_KEY?.trim();
    nextNvdRequestAt = Date.now() + (apiKey ? 700 : 6_300);
    const url = new URL("https://services.nvd.nist.gov/rest/json/cves/2.0");
    url.searchParams.set("cpeName", cpe);
    url.searchParams.set("resultsPerPage", "2000");
    const response = await fetch(url, {
      headers: { "User-Agent": "uds-scout-security", ...(apiKey ? { apiKey } : {}) },
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`NVD vulnerability lookup returned ${response.status}.`);
    return await response.json() as NvdResponse;
  } finally {
    release();
  }
}

export async function queryNvdApplicationAdvisories(cpe: string, version: string) {
  const key = `range-v2:${cpe.toLowerCase()}`;
  const cached = nvdCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.value;
  const existing = nvdInflight.get(key);
  if (existing) return existing;
  const request = scheduledNvdRequest(cpe).then((result) => (result.vulnerabilities ?? []).flatMap(({ cve }): AdvisoryMatch[] => {
    if (cve.vulnStatus?.toLowerCase() === "rejected") return [];
    const cpeMatches = matchingNvdCpeEntries(cve.configurations, cpe, version);
    if (!cpeMatches.length) return [];
    const score = nvdScore(cve);
    const fixedVersions = nvdFixedVersions(cpeMatches);
    return [{
      vulnerability: {
        id: cve.id,
        aliases: [],
        summary: cve.descriptions?.find((item) => item.lang === "en")?.value ?? cve.id,
        description: cve.descriptions?.find((item) => item.lang === "en")?.value ?? null,
        severity: score.severity === "unknown" ? severityFromCvss(score.score) : score.severity,
        cvss: score.score,
        publishedAt: cve.published ?? null,
        modifiedAt: cve.lastModified ?? null,
        references: [...new Set([`https://nvd.nist.gov/vuln/detail/${encodeURIComponent(cve.id)}`, ...(cve.references ?? []).map((item) => item.url)].filter(Boolean))],
        providers: ["NVD"],
      },
      fixedVersion: relevantFixedVersion(version, fixedVersions),
      affectedVersion: version,
      source: "NVD",
    }];
  })).then((matches) => {
    nvdCache.set(key, { value: matches, expires: Date.now() + 12 * 60 * 60_000 });
    return matches;
  }).finally(() => nvdInflight.delete(key));
  nvdInflight.set(key, request);
  return request;
}

function osvEventsAffectVersion(events: { introduced?: string; fixed?: string; last_affected?: string; limit?: string }[], version: string) {
  let affected = false;
  let comparable = false;
  for (const event of events) {
    if (event.introduced) {
      comparable = true;
      if (event.introduced === "0" || compareNvdVersions(version, event.introduced) >= 0) affected = true;
    }
    if (event.fixed) {
      comparable = true;
      if (compareNvdVersions(version, event.fixed) >= 0) affected = false;
    }
    if (event.last_affected) {
      comparable = true;
      if (compareNvdVersions(version, event.last_affected) > 0) affected = false;
    }
    if (event.limit) {
      comparable = true;
      if (compareNvdVersions(version, event.limit) >= 0) affected = false;
    }
  }
  return comparable ? affected : null;
}

function osvAffectedRange(affected: NonNullable<OsvVulnerability["affected"]>[number], version: string) {
  const custom = affected.ecosystem_specific?.custom_ranges?.flatMap((range) => range.events ? [osvEventsAffectVersion(range.events, version)] : []) ?? [];
  if (custom.some((result) => result === true)) return true;
  if (custom.some((result) => result === false)) return false;
  const standard = affected.ranges?.filter((range) => range.type === "SEMVER" || range.type === "ECOSYSTEM").map((range) => osvEventsAffectVersion(range.events, version)) ?? [];
  if (standard.some((result) => result === true)) return true;
  if (standard.some((result) => result === false)) return false;
  return null;
}

function osvMatch(value: OsvVulnerability, installedPackage: SBOMPackage): AdvisoryMatch | null {
  const ids = [...new Set([value.id, ...(value.aliases ?? [])])];
  const affected = value.affected?.find((item) => item.package?.purl === installedPackage.purl || item.package?.name?.toLowerCase() === installedPackage.name.toLowerCase()) ?? value.affected?.find((item) => item.ranges?.length) ?? value.affected?.[0];
  if (installedPackage.version && affected && osvAffectedRange(affected, installedPackage.version) === false) return null;
  const fixedVersions = affected?.ranges?.flatMap((range) => range.events.flatMap((event) => event.fixed ? [event.fixed] : [])) ?? [];
  const fixedVersion = installedPackage.version ? relevantFixedVersion(installedPackage.version, fixedVersions) : fixedVersions[0] ?? null;
  const explicitSeverity = severity(affected?.database_specific?.severity ?? affected?.ecosystem_specific?.severity ?? value.database_specific?.severity);
  const score = cvssScore(value.severity);
  return {
    vulnerability: {
      id: canonicalId(ids),
      aliases: ids.filter((id) => id !== canonicalId(ids)),
      summary: value.summary ?? value.id,
      description: value.details ?? null,
      severity: explicitSeverity === "unknown" ? severityFromCvss(score) : explicitSeverity,
      cvss: score,
      publishedAt: value.published ?? null,
      modifiedAt: value.modified ?? null,
      references: [...new Set((value.references ?? []).map((reference) => reference.url).filter(Boolean))],
      providers: ["OSV"],
    },
    fixedVersion,
    affectedVersion: installedPackage.version,
    source: "OSV",
  };
}

function queryForPackage(item: SBOMPackage): OsvQuery | null {
  if (!item.version) return null;
  const packageType = item.purl?.match(/^pkg:([^/]+)/i)?.[1].toLowerCase() ?? item.type?.toLowerCase();
  const version = packageType === "golang" ? item.version.replace(/^(?:go|v)(?=\d)/i, "") : item.version;
  if (item.purl) return { version, package: { purl: item.purl.replace(/@[^/?#]+(?=[?#]|$)/, "") } };
  if (item.ecosystem) return { version, package: { ecosystem: item.ecosystem, name: item.name } };
  return null;
}

export async function queryOsvPackages(packages: SBOMPackage[]) {
  const queryItems = packages.flatMap((item) => {
    const query = queryForPackage(item);
    return query ? [{ item, query }] : [];
  });
  const matches = new Map<number, AdvisoryMatch[]>();
  for (let offset = 0; offset < queryItems.length; offset += 500) {
    const batch = queryItems.slice(offset, offset + 500);
    const response = await fetch("https://api.osv.dev/v1/querybatch", {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "uds-scout-security" },
      body: JSON.stringify({ queries: batch.map((item) => item.query) }),
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`OSV batch lookup returned ${response.status}.`);
    const result = await response.json() as OsvBatch;
    const ids = [...new Set(result.results.flatMap((item) => item.vulns?.map((vulnerability) => vulnerability.id) ?? []))];
    const details = new Map((await mapLimit(ids, 8, async (id) => [id, await osvDetail(id)] as const)).map((item) => item));
    result.results.forEach((item, index) => {
      const packageIndex = offset + index;
      matches.set(packageIndex, (item.vulns ?? []).flatMap((vulnerability) => {
        const detail = details.get(vulnerability.id);
        const match = detail ? osvMatch(detail, batch[index].item) : null;
        return match ? [match] : [];
      }));
    });
  }
  return queryItems.map((item, index) => ({ package: item.item, matches: matches.get(index) ?? [] }));
}

function githubCoordinate(purl: string) {
  const match = purl.match(/^pkg:([^/]+)\/(.+)$/i);
  if (!match) return null;
  const type = match[1].toLowerCase();
  const rawName = decodeURIComponent(match[2].split(/[?#]/)[0]).replace(/@[^/]+$/, "");
  const name = type === "maven" && rawName.includes("/") ? `${rawName.slice(0, rawName.lastIndexOf("/"))}:${rawName.slice(rawName.lastIndexOf("/") + 1)}` : rawName;
  const ecosystem = ({ maven: "maven", npm: "npm", pypi: "pip", golang: "go", cargo: "rust", nuget: "nuget", gem: "rubygems", composer: "composer", hex: "erlang", actions: "actions", pub: "pub", swift: "swift" } as Record<string, string>)[type];
  return ecosystem ? { ecosystem, name } : null;
}

function githubRangeAffects(version: string, range: string) {
  const options = { includePrerelease: true, loose: true } as const;
  try {
    if (semver.satisfies(version, range, options)) return true;
    return range.split(/\s*\|\|\s*/).some((branch) => {
      const clauses = branch.split(/\s*,\s*/).filter(Boolean);
      if (clauses.length < 2) return false;
      const directions = new Set(clauses.map((clause) => clause.trim().match(/^(<=|<|>=|>)/)?.[1]?.startsWith("<") ? "upper" : "lower"));
      return directions.size === 1 && clauses.some((clause) => semver.satisfies(version, clause, options));
    });
  } catch {
    return false;
  }
}

export async function queryGithubRepositoryAdvisories(repository: string, version: string) {
  const installed = semver.coerce(version)?.version;
  if (!installed) return [];
  const advisories = await githubRequest<GithubAdvisory[]>(`/repos/${repository}/security-advisories?per_page=100`, UPSTREAM_ADVISORY_TTL);
  return advisories.flatMap((advisory): AdvisoryMatch[] => {
    const affected = advisory.vulnerabilities?.filter((item) => githubRangeAffects(installed, item.vulnerable_version_range)) ?? [];
    if (!affected.length) return [];
    const ids = [...new Set([advisory.cve_id, advisory.ghsa_id].filter((id): id is string => Boolean(id)))];
    const score = advisory.cvss?.score ?? null;
    const reportedSeverity = severity(advisory.severity);
    return [{
      vulnerability: {
        id: canonicalId(ids), aliases: ids.filter((id) => id !== canonicalId(ids)), summary: advisory.summary,
        description: advisory.description || null,
        severity: reportedSeverity === "unknown" ? severityFromCvss(score) : reportedSeverity,
        cvss: score, publishedAt: advisory.published_at, modifiedAt: advisory.updated_at,
        references: [...new Set([advisory.html_url, ...(advisory.references ?? [])].filter(Boolean))], providers: ["GitHub Repository Advisory"],
      },
      fixedVersion: affected.map((item) => item.first_patched_version).filter((item): item is string => Boolean(item)).sort((left, right) => semver.compare(semver.coerce(left) ?? "0.0.0", semver.coerce(right) ?? "0.0.0"))[0] ?? null,
      affectedVersion: version,
      source: "GitHub Repository Advisory",
    }];
  });
}

export async function queryGithubApplicationAdvisories(purl: string, version: string) {
  const coordinate = githubCoordinate(purl);
  if (!coordinate) return [];
  const affects = `${coordinate.name}@${version}`;
  const advisories = await githubRequest<GithubAdvisory[]>(`/advisories?ecosystem=${encodeURIComponent(coordinate.ecosystem)}&affects=${encodeURIComponent(affects)}&per_page=100`, 12 * 60 * 60_000);
  return advisories.map((advisory): AdvisoryMatch => {
    const ids = [...new Set([advisory.cve_id, advisory.ghsa_id].filter((id): id is string => Boolean(id)))];
    const packageMatch = advisory.vulnerabilities?.find((item) => item.package.name.toLowerCase() === coordinate.name.toLowerCase()) ?? advisory.vulnerabilities?.[0];
    const score = advisory.cvss?.score ?? null;
    const reportedSeverity = severity(advisory.severity);
    return {
      vulnerability: {
        id: canonicalId(ids), aliases: ids.filter((id) => id !== canonicalId(ids)), summary: advisory.summary,
        description: advisory.description || null,
        severity: reportedSeverity === "unknown" ? severityFromCvss(score) : reportedSeverity,
        cvss: score, publishedAt: advisory.published_at, modifiedAt: advisory.updated_at,
        references: [...new Set([advisory.html_url, ...(advisory.references ?? [])].filter(Boolean))], providers: ["GitHub Advisory"],
      },
      fixedVersion: packageMatch?.first_patched_version ?? null,
      affectedVersion: version,
      source: "GitHub Advisory",
    };
  });
}

function decodeHtml(value: string) {
  return value.replace(/&#(x?[0-9a-f]+);|&(amp|lt|gt|quot|apos|nbsp);/gi, (entity, numeric: string | undefined, named: string | undefined) => {
    if (numeric) return String.fromCodePoint(Number.parseInt(numeric.replace(/^x/i, ""), numeric.startsWith("x") ? 16 : 10));
    return ({ amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " } as Record<string, string>)[named?.toLowerCase() ?? ""] ?? entity;
  });
}

function htmlText(value: string) {
  return decodeHtml(value.replace(/<br\s*\/?\s*>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function gitlabAffectedVersion(value: string, installedVersion: string) {
  const installed = semver.coerce(installedVersion)?.version;
  if (!installed) return null;
  const ranges: Array<{ start: string | null; fixed: string }> = [];
  for (const match of value.matchAll(/(?:all versions\s+)?(?:from|starting from)\s+(\d+(?:\.\d+){1,2})\s+before\s+(\d+(?:\.\d+){1,2})/gi)) ranges.push({ start: match[1], fixed: match[2] });
  for (const match of value.matchAll(/(?:^|[,;](?:\s*and)?)\s*(\d+(?:\.\d+){1,2})\s+before\s+(\d+(?:\.\d+){1,2})/gi)) ranges.push({ start: match[1], fixed: match[2] });
  for (const match of value.matchAll(/all versions\s+before\s+(\d+(?:\.\d+){1,2})/gi)) ranges.push({ start: null, fixed: match[1] });
  for (const range of ranges) {
    const fixed = semver.coerce(range.fixed)?.version;
    const start = range.start ? semver.coerce(range.start)?.version : null;
    if (fixed && semver.lt(installed, fixed) && (!start || semver.gte(installed, start))) return range.fixed;
  }
  return null;
}

async function gitlabReleaseFeed() {
  if (gitlabReleaseCache && gitlabReleaseCache.expires > Date.now()) return gitlabReleaseCache.value;
  const response = await fetch("https://about.gitlab.com/security-releases.xml", {
    headers: { "User-Agent": "uds-scout-security", "Accept-Language": "en-US,en;q=0.9" }, cache: "no-store", signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`GitLab security release lookup returned ${response.status}.`);
  const value = await response.text();
  if (value.length > 8 * 1024 * 1024 || !value.includes("<feed")) throw new Error("GitLab security release feed was invalid or exceeded the response limit.");
  gitlabReleaseCache = { value, expires: Date.now() + UPSTREAM_ADVISORY_TTL };
  return value;
}

async function queryGitlabSecurityReleases(version: string) {
  const feed = await gitlabReleaseFeed();
  const matches: AdvisoryMatch[] = [];
  for (const entryMatch of feed.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const entry = entryMatch[1];
    const reference = decodeHtml(entry.match(/<id>([\s\S]*?)<\/id>/)?.[1] ?? "").replace(/^https:\/\/docs\.gitlab\.com\/[a-z]{2}-[a-z]{2}\//i, "https://docs.gitlab.com/");
    const publishedAt = entry.match(/<published>([^<]+)<\/published>/)?.[1] ?? null;
    const content = entry.match(/<content[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/content>/)?.[1] ?? "";
    for (const sectionMatch of content.matchAll(/<h3\s+id="(cve-[^"]+)"[^>]*>([\s\S]*?)<\/h3>([\s\S]*?)(?=<h[23]\s|$)/gi)) {
      const anchor = sectionMatch[1];
      const id = anchor.match(/^cve-\d{4}-\d+/i)?.[0]?.toUpperCase();
      if (!id) continue;
      const section = sectionMatch[3];
      const impactedHtml = section.match(/<strong>Impacted\s+versions:?<\/strong>([\s\S]*?)(?=<br\s*\/?\s*>|<strong>CVSS|<\/p>)/i)?.[1];
      if (!impactedHtml) continue;
      const fixedVersion = gitlabAffectedVersion(htmlText(impactedHtml), version);
      if (!fixedVersion) continue;
      const title = htmlText(sectionMatch[2]).replace(/^CVE-\d{4}-\d+\s*-?\s*/i, "") || id;
      const scoreText = section.match(/<strong>CVSS<\/strong>\s*([0-9.]+)/i)?.[1];
      const score = scoreText ? Number(scoreText) : null;
      const description = htmlText(section.match(/<p>([\s\S]*?)<\/p>/i)?.[1] ?? "") || null;
      matches.push({
        vulnerability: {
          id, aliases: [], summary: title, description, severity: severityFromCvss(Number.isFinite(score) ? score : null),
          cvss: Number.isFinite(score) ? score : null, publishedAt, modifiedAt: publishedAt,
          references: reference ? [`${reference}#${anchor}`] : [], providers: ["GitLab Security Release"],
        },
        fixedVersion, affectedVersion: version, source: "GitLab Security Release",
      });
    }
  }
  return deduplicateMatches(matches);
}

async function jenkinsUpdateCenter() {
  if (jenkinsUpdateCache && jenkinsUpdateCache.expires > Date.now()) return jenkinsUpdateCache.value;
  const response = await fetch("https://updates.jenkins.io/current/update-center.actual.json", {
    headers: { "User-Agent": "uds-scout-security" }, cache: "no-store", signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Jenkins advisory lookup returned ${response.status}.`);
  const value = await response.json() as JenkinsUpdateCenter;
  jenkinsUpdateCache = { value, expires: Date.now() + UPSTREAM_ADVISORY_TTL };
  return value;
}

async function jenkinsAdvisory(url: string) {
  const cached = jenkinsAdvisoryCache.get(url);
  if (cached && cached.expires > Date.now()) return cached.value;
  const date = url.match(/\/security\/advisory\/(\d{4}-\d{2}-\d{2})\//)?.[1];
  if (!date) throw new Error("Jenkins advisory URL did not contain a publication date.");
  const response = await fetch(`https://raw.githubusercontent.com/jenkins-infra/jenkins.io/master/content/security/advisory/${date}.adoc`, {
    headers: { "User-Agent": "uds-scout-security" }, cache: "no-store", signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Jenkins advisory detail lookup returned ${response.status}.`);
  const source = await response.text();
  const document = source.replace(/^---\s*\n/, "");
  if (document === source) throw new Error("Jenkins advisory detail did not contain structured metadata.");
  const value = load(document) as JenkinsAdvisory;
  jenkinsAdvisoryCache.set(url, { value, expires: Date.now() + 12 * 60 * 60_000 });
  return value;
}

async function queryJenkinsAdvisories(version: string) {
  const normalized = normalizeAdvisoryVersion(version);
  const updateCenter = await jenkinsUpdateCenter();
  const warnings = (updateCenter.warnings ?? []).filter((warning) => warning.type === "core" && (warning.versions ?? []).some((range) => {
    try { return Boolean(range.pattern && new RegExp(`^(?:${range.pattern})$`).test(normalized)); } catch { return false; }
  }));
  const matches: AdvisoryMatch[] = [];
  for (const warning of warnings) {
    const advisory = await jenkinsAdvisory(warning.url);
    const weekly = advisory.core?.weekly;
    const lts = advisory.core?.lts;
    const fixedVersion = normalized === lts?.previous ? lts.fixed ?? null : weekly?.fixed ?? lts?.fixed ?? null;
    for (const issue of advisory.issues ?? []) {
      if (issue.plugins?.length) continue;
      const ids = issue.cve?.match(/CVE-\d{4}-\d+/gi) ?? [];
      for (const id of ids) {
        matches.push({
          vulnerability: {
            id: id.toUpperCase(), aliases: issue.id ? [issue.id] : [], summary: issue.title ?? warning.message,
            description: issue.description ?? null, severity: severity(issue.cvss?.severity), cvss: null,
            publishedAt: warning.url.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null, modifiedAt: null,
            references: [`${warning.url}#${encodeURIComponent(issue.id?.split(" ")[0] ?? id)}`], providers: ["Jenkins Security Advisory"],
          },
          fixedVersion,
          affectedVersion: version,
          source: "Jenkins Security Advisory",
        });
      }
    }
  }
  return matches;
}

function deduplicateMatches(matches: AdvisoryMatch[]) {
  const output: AdvisoryMatch[] = [];
  for (const match of matches) {
    const ids = new Set([match.vulnerability.id, ...match.vulnerability.aliases]);
    const existing = output.find((candidate) => [candidate.vulnerability.id, ...candidate.vulnerability.aliases].some((id) => ids.has(id)));
    if (!existing) {
      output.push(match);
      continue;
    }
    const authoritativeVendor = match.source === "Jenkins Security Advisory" || match.source === "GitLab Security Release";
    existing.vulnerability.aliases = [...new Set([...existing.vulnerability.aliases, match.vulnerability.id, ...match.vulnerability.aliases].filter((id) => id !== existing.vulnerability.id))];
    existing.vulnerability.providers = [...new Set([...existing.vulnerability.providers, ...match.vulnerability.providers])];
    existing.vulnerability.references = authoritativeVendor
      ? [...new Set([...match.vulnerability.references, ...existing.vulnerability.references])]
      : [...new Set([...existing.vulnerability.references, ...match.vulnerability.references])];
    if (authoritativeVendor) {
      existing.vulnerability.summary = match.vulnerability.summary;
      existing.vulnerability.description = match.vulnerability.description ?? existing.vulnerability.description;
      existing.vulnerability.severity = match.vulnerability.severity === "unknown" ? existing.vulnerability.severity : match.vulnerability.severity;
      existing.vulnerability.cvss = match.vulnerability.cvss ?? existing.vulnerability.cvss;
      existing.vulnerability.publishedAt = match.vulnerability.publishedAt ?? existing.vulnerability.publishedAt;
      existing.fixedVersion = match.fixedVersion ?? existing.fixedVersion;
    } else existing.fixedVersion ??= match.fixedVersion;
  }
  return output;
}

const APPLICATION_ADVISORY_PROVIDERS: ApplicationAdvisoryProvider[] = [
  {
    id: "osv", label: "OSV", supports: (input) => Boolean(input.purl),
    query: async (input) => {
      const purl = input.purl!;
      const packageItem: SBOMPackage = { name: purl.split("/").at(-1) ?? purl, version: input.version, purl, ecosystem: null, cpe: input.cpe, type: purl.match(/^pkg:([^/]+)/)?.[1] ?? null, supplier: null };
      return (await queryOsvPackages([packageItem]))[0]?.matches ?? [];
    },
  },
  { id: "github", label: "GitHub Advisory", supports: (input) => Boolean(input.purl), query: (input) => queryGithubApplicationAdvisories(input.purl!, input.version) },
  { id: "github-repository", label: "GitHub Repository Advisory", supports: (input) => Boolean(supportsGithubRepositoryAdvisories(input.name) && input.upstreamRepository && /^[^/\s]+\/[^/\s]+$/.test(input.upstreamRepository) && semver.coerce(input.version)), query: (input) => queryGithubRepositoryAdvisories(input.upstreamRepository!, input.version) },
  { id: "nvd", label: "NVD", supports: (input) => Boolean(input.cpe), query: (input) => queryNvdApplicationAdvisories(input.cpe!, input.version) },
  { id: "jenkins", label: "Jenkins Security Advisory", supports: (input) => input.name === "Jenkins", query: (input) => queryJenkinsAdvisories(input.version) },
  { id: "gitlab", label: "GitLab Security Release", supports: (input) => input.name === "GitLab", query: (input) => queryGitlabSecurityReleases(input.version) },
];

export async function queryApplicationAdvisories(input: ApplicationAdvisoryInput) {
  const normalizedInput = { ...input, version: normalizeAdvisoryVersion(input.version) };
  const providers = APPLICATION_ADVISORY_PROVIDERS.filter((provider) => provider.supports(normalizedInput));
  const settled = await Promise.allSettled(providers.map((provider) => provider.query(normalizedInput)));
  const checkedProviders = providers.flatMap((provider, index) => settled[index].status === "fulfilled" ? [provider.label] : []);
  const expectedProviders = [...new Set([...providers.map((provider) => provider.label), ...expectedAdvisorySources(input.name)])];
  return {
    matches: deduplicateMatches(settled.flatMap((result) => result.status === "fulfilled" ? result.value : [])),
    providers: checkedProviders,
    expectedProviders,
    missingProviders: expectedProviders.filter((provider) => !checkedProviders.includes(provider)),
    errors: settled.flatMap((result) => result.status === "rejected" ? [String(result.reason)] : []),
  };
}
