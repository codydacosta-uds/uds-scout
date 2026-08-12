import "server-only";

import type { SBOMPackage, SecurityFindingCategory } from "@/components/security-types";

type UnknownRecord = Record<string, unknown>;
export type ParsedSbom = { format: "spdx" | "cyclonedx" | "syft"; packages: SBOMPackage[] };

function record(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : null;
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function decodedPayload(value: string) {
  try {
    return JSON.parse(Buffer.from(value, "base64").toString("utf8")) as unknown;
  } catch {
    return null;
  }
}

function unwrap(input: unknown, depth = 0): unknown[] {
  if (depth > 4) return [];
  const value = record(input);
  if (!value) return [];
  if (value.spdxVersion || value.bomFormat || Array.isArray(value.artifacts)) return [value];
  const candidates = [value.predicate, value.statement, value.attestation, value.sbom].filter(Boolean);
  if (typeof value.payload === "string") candidates.push(decodedPayload(value.payload));
  return candidates.flatMap((candidate) => unwrap(candidate, depth + 1));
}

function purlType(purl: string | null) {
  return purl?.match(/^pkg:([^/]+)/i)?.[1].toLowerCase() ?? null;
}

function ecosystemFromType(type: string | null) {
  if (!type) return null;
  const normalized = type.toLowerCase();
  return ({ npm: "npm", maven: "Maven", pypi: "PyPI", golang: "Go", cargo: "crates.io", nuget: "NuGet", gem: "RubyGems", composer: "Packagist", hex: "Hex" } as Record<string, string>)[normalized] ?? null;
}

function unique(packages: SBOMPackage[]) {
  return [...new Map(packages.filter((item) => item.name && item.version).map((item) => [`${item.purl ?? item.type ?? ""}:${item.name}:${item.version}`, item])).values()];
}

function parseSpdx(root: UnknownRecord): ParsedSbom | null {
  if (!root.spdxVersion || !Array.isArray(root.packages)) return null;
  const packages = root.packages.flatMap((candidate): SBOMPackage[] => {
    const item = record(candidate);
    const name = text(item?.name);
    if (!item || !name) return [];
    const refs = Array.isArray(item.externalRefs) ? item.externalRefs.map(record).filter((value): value is UnknownRecord => Boolean(value)) : [];
    const purl = refs.find((ref) => text(ref.referenceType)?.toLowerCase().includes("purl")) ? text(refs.find((ref) => text(ref.referenceType)?.toLowerCase().includes("purl"))?.referenceLocator) : null;
    const cpe = refs.find((ref) => text(ref.referenceType)?.toLowerCase().includes("cpe")) ? text(refs.find((ref) => text(ref.referenceType)?.toLowerCase().includes("cpe"))?.referenceLocator) : null;
    const type = purlType(purl);
    return [{ name, version: text(item.versionInfo), ecosystem: ecosystemFromType(type), purl, cpe, type, supplier: text(item.supplier) }];
  });
  return { format: "spdx", packages: unique(packages) };
}

function parseCycloneDx(root: UnknownRecord): ParsedSbom | null {
  if (text(root.bomFormat)?.toLowerCase() !== "cyclonedx" || !Array.isArray(root.components)) return null;
  const packages = root.components.flatMap((candidate): SBOMPackage[] => {
    const item = record(candidate);
    const name = text(item?.name);
    if (!item || !name) return [];
    const purl = text(item.purl);
    const type = purlType(purl) ?? text(item.type);
    return [{ name, version: text(item.version), ecosystem: ecosystemFromType(type), purl, cpe: text(item.cpe), type, supplier: text(record(item.supplier)?.name) ?? text(item.publisher) }];
  });
  return { format: "cyclonedx", packages: unique(packages) };
}

function parseSyft(root: UnknownRecord): ParsedSbom | null {
  if (!Array.isArray(root.artifacts)) return null;
  const packages = root.artifacts.flatMap((candidate): SBOMPackage[] => {
    const item = record(candidate);
    const name = text(item?.name);
    if (!item || !name) return [];
    const purl = text(item.purl);
    const type = purlType(purl) ?? text(item.type);
    const metadata = record(item.metadata);
    return [{ name, version: text(item.version), ecosystem: ecosystemFromType(type), purl, cpe: Array.isArray(item.cpes) ? text(item.cpes[0]) : null, type, supplier: text(metadata?.author) ?? text(metadata?.maintainer) }];
  });
  return { format: "syft", packages: unique(packages) };
}

export function parseSbom(input: unknown): ParsedSbom | null {
  for (const candidate of unwrap(input)) {
    const root = record(candidate);
    if (!root) continue;
    const parsed = parseSpdx(root) ?? parseCycloneDx(root) ?? parseSyft(root);
    if (parsed) return parsed;
  }
  return null;
}

export function sbomAssociationText(input: unknown) {
  try {
    return JSON.stringify(input).slice(0, 5_000_000).toLowerCase();
  } catch {
    return "";
  }
}

export function containerFindingCategory(item: SBOMPackage): SecurityFindingCategory {
  const type = (item.type ?? purlType(item.purl) ?? "").toLowerCase();
  if (["apk", "deb", "rpm", "alpm", "alpine", "debian", "ubuntu", "redhat"].includes(type)) return "container-os";
  if (["npm", "maven", "pypi", "golang", "cargo", "nuget", "gem", "composer", "hex", "swift", "pub"].includes(type)) return "container-language";
  return "container-other";
}
