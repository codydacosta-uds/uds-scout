import "server-only";

import type { SBOMPackage, SecurityFinding, SecuritySeverity, Vulnerability } from "@/components/security-types";
import type { AdvisoryMatch } from "@/lib/security-advisories";
import { containerFindingCategory, type ParsedSbom } from "@/lib/security-sbom";

const REGISTRY_ORIGIN = "https://registry.defenseunicorns.com";
const SOURCE_LABEL = "Defense Unicorns Registry";
const CACHE_TTL = 60 * 60 * 1000;
const MAX_METADATA_BYTES = 2 * 1024 * 1024;
const MAX_SECURITY_BYTES = 20 * 1024 * 1024;

type RegistryTag = {
  name: string;
  architecture?: string;
  kind?: string;
  cve_status?: string;
  zarf_data?: { flavor?: string };
};
type RegistryComponent = {
  purl?: string;
  cpes?: string[];
  maintainer?: string;
  scan_metadata?: { source_name?: string };
};
type RegistryImageSbom = { components?: RegistryComponent[] };
type RegistryVulnerability = {
  id: string;
  description?: string;
  cvss_score?: number;
  cvss_vector?: string;
  severity?: string;
  fixed_in?: string;
  installed?: string;
  purl?: string;
  affected_images?: { name: string; locations?: string[] }[];
  reference_urls?: string[];
};
type RegistryCveResponse = { vulnerabilities?: RegistryVulnerability[] };

export type DefenseUnicornsRegistryMatch = {
  match: AdvisoryMatch;
  affectedPackage: string;
  installedVersion: string | null;
  category: SecurityFinding["category"];
};
export type DefenseUnicornsRegistryData = {
  inventories: Map<string, { parsed: ParsedSbom; source: string }>;
  advisories: Map<string, DefenseUnicornsRegistryMatch[]>;
};

const cache = new Map<string, { expires: number; value: DefenseUnicornsRegistryData }>();

async function registryJson<T>(path: string, maximumBytes: number) {
  const url = new URL(path, REGISTRY_ORIGIN);
  if (url.origin !== REGISTRY_ORIGIN) throw new Error("Defense Unicorns Registry request changed hosts unexpectedly.");
  const response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "uds-scout-security" }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Defense Unicorns Registry returned ${response.status}.`);
  const declaredSize = Number(response.headers.get("content-length") ?? 0);
  if (declaredSize > maximumBytes) throw new Error("Defense Unicorns Registry metadata exceeded Scout's size limit.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maximumBytes) throw new Error("Defense Unicorns Registry metadata exceeded Scout's size limit.");
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

function packageFromPurl(component: RegistryComponent): SBOMPackage | null {
  if (!component.purl?.startsWith("pkg:")) return null;
  const withoutQualifiers = component.purl.split(/[?#]/, 1)[0];
  const separator = withoutQualifiers.lastIndexOf("@");
  const coordinate = separator > 4 ? withoutQualifiers.slice(4, separator) : withoutQualifiers.slice(4);
  const slash = coordinate.indexOf("/");
  if (slash < 1) return null;
  const type = coordinate.slice(0, slash).toLowerCase();
  const name = decodeURIComponent(coordinate.slice(slash + 1));
  const version = separator > 4 ? decodeURIComponent(withoutQualifiers.slice(separator + 1)) : null;
  return {
    name,
    version,
    ecosystem: null,
    purl: component.purl,
    cpe: component.cpes?.[0] ?? null,
    type,
    supplier: component.maintainer ?? null,
  };
}

function severity(value: string | undefined, score: number | undefined): SecuritySeverity {
  const normalized = value?.toLowerCase();
  if (normalized === "critical" || normalized === "high" || normalized === "medium" || normalized === "low") return normalized;
  if (score !== undefined) return score >= 9 ? "critical" : score >= 7 ? "high" : score >= 4 ? "medium" : score > 0 ? "low" : "unknown";
  return "unknown";
}

function advisory(value: RegistryVulnerability): DefenseUnicornsRegistryMatch | null {
  if (!/^(?:CVE|GHSA)-/i.test(value.id)) return null;
  const packageItem = packageFromPurl({ purl: value.purl });
  const affectedPackage = packageItem?.name ?? value.purl ?? "Unknown package";
  const vulnerability: Vulnerability = {
    id: value.id.toUpperCase(),
    aliases: [],
    summary: value.description?.split(/(?<=[.!?])\s/, 1)[0] ?? value.id,
    description: value.description ?? null,
    severity: severity(value.severity, value.cvss_score),
    cvss: Number.isFinite(value.cvss_score) ? value.cvss_score! : null,
    publishedAt: null,
    modifiedAt: null,
    references: [...new Set([...(value.reference_urls ?? []), /^CVE-/i.test(value.id) ? `https://nvd.nist.gov/vuln/detail/${value.id}` : `https://github.com/advisories/${value.id}`])],
    providers: [SOURCE_LABEL],
  };
  return {
    match: { vulnerability, fixedVersion: value.fixed_in ?? null, affectedVersion: value.installed ?? null, source: SOURCE_LABEL },
    affectedPackage,
    installedVersion: value.installed ?? packageItem?.version ?? null,
    category: packageItem ? containerFindingCategory(packageItem) : "container-other",
  };
}

function tagReference(tag: RegistryTag) {
  return [tag.name, tag.zarf_data?.flavor, tag.architecture?.replaceAll("/", "_")].filter(Boolean).join("-");
}

function emptyData(): DefenseUnicornsRegistryData {
  return { inventories: new Map(), advisories: new Map() };
}

export async function discoverDefenseUnicornsRegistryData(repositoryId: string): Promise<DefenseUnicornsRegistryData> {
  const [owner, repository] = repositoryId.toLowerCase().split("/");
  if (owner !== "uds-packages" || !repository || !/^[a-z0-9_.-]+$/.test(repository)) return emptyData();
  const cached = cache.get(repository);
  if (cached && cached.expires > Date.now()) return cached.value;

  const metadata = await registryJson<{ tags?: RegistryTag[] }>(`/uds/metadata/airgap-store/${encodeURIComponent(repository)}`, MAX_METADATA_BYTES);
  const latestByFlavor = new Map<string, RegistryTag>();
  for (const tag of metadata.tags ?? []) {
    const flavor = tag.zarf_data?.flavor?.toLowerCase();
    if (!flavor || latestByFlavor.has(flavor) || tag.kind !== "zarf" || tag.cve_status !== "scanned") continue;
    latestByFlavor.set(flavor, tag);
  }

  const result = emptyData();
  await Promise.allSettled([...latestByFlavor.values()].map(async (tag) => {
    const reference = tagReference(tag);
    if (!/^[a-zA-Z0-9_.+-]+$/.test(reference)) return;
    const source = `${SOURCE_LABEL} (airgap-store/${repository}:${reference})`;
    const base = `/uds/artifacts/airgap-store/${encodeURIComponent(repository)}/${encodeURIComponent(reference)}`;
    const [sboms, cves] = await Promise.all([
      registryJson<Record<string, RegistryImageSbom>>(`${base}/sbom`, MAX_SECURITY_BYTES),
      registryJson<RegistryCveResponse>(`${base}/cves`, MAX_SECURITY_BYTES),
    ]);
    for (const [image, document] of Object.entries(sboms)) {
      const packages = (document.components ?? []).flatMap((component) => {
        const parsed = packageFromPurl(component);
        return parsed ? [parsed] : [];
      });
      if (packages.length) result.inventories.set(image.toLowerCase(), { parsed: { format: "syft", packages }, source });
    }
    for (const value of cves.vulnerabilities ?? []) {
      const normalized = advisory(value);
      if (!normalized) continue;
      for (const image of value.affected_images ?? []) {
        const key = image.name.toLowerCase();
        const matches = result.advisories.get(key) ?? [];
        matches.push(normalized);
        result.advisories.set(key, matches);
      }
    }
  }));
  cache.set(repository, { value: result, expires: Date.now() + CACHE_TTL });
  return result;
}
