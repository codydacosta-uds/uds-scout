import "server-only";

import { createHash } from "node:crypto";
import type { ApplicationIdentificationConfidence } from "@/components/security-types";
import { normalizeAdvisoryVersion, SECURITY_PRODUCT_PROFILES } from "@/lib/security-products";

export type ParsedImageReference = {
  original: string;
  registry: string;
  registryHost: string;
  repository: string;
  tag: string | null;
  digest: string | null;
};

export type ResolvedApplicationIdentity = {
  name: string | null;
  version: string | null;
  upstreamRepository: string | null;
  purl: string | null;
  cpe: string | null;
  confidence: ApplicationIdentificationConfidence;
  role: "application" | "support";
};

export function stableSecurityId(...values: Array<string | null | undefined>) {
  return createHash("sha256").update(values.map((value) => value ?? "").join("\u0000")).digest("hex").slice(0, 24);
}

export function parseImageReference(reference: string): ParsedImageReference {
  const original = reference.trim();
  const digestIndex = original.lastIndexOf("@sha256:");
  const digest = digestIndex >= 0 ? original.slice(digestIndex + 1) : null;
  const withoutDigest = digestIndex >= 0 ? original.slice(0, digestIndex) : original;
  const lastSlash = withoutDigest.lastIndexOf("/");
  const lastColon = withoutDigest.lastIndexOf(":");
  const tag = lastColon > lastSlash ? withoutDigest.slice(lastColon + 1) : digest ? null : "latest";
  const name = lastColon > lastSlash ? withoutDigest.slice(0, lastColon) : withoutDigest;
  const segments = name.split("/");
  const explicitRegistry = segments.length > 1 && (segments[0].includes(".") || segments[0].includes(":") || segments[0] === "localhost");
  const registry = explicitRegistry ? segments.shift()! : "docker.io";
  let repository = segments.join("/") || name;
  if (registry === "docker.io" && !repository.includes("/")) repository = `library/${repository}`;
  return {
    original,
    registry,
    registryHost: registry === "docker.io" ? "registry-1.docker.io" : registry,
    repository,
    tag,
    digest,
  };
}

function normalizedVersion(tag: string | null) {
  if (!tag || /^(?:latest|main|master|stable|snapshot)$/i.test(tag)) return null;
  const cleaned = tag.replace(/^v(?=\d)/i, "").replace(/-(?:fips|distroless)(?:[-.].*)?$/i, "");
  return /\d/.test(cleaned) ? cleaned : null;
}

function cpeValue(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/([*?!:])/g, "\\$1");
}

function normalizedName(value: string) {
  return value.toLowerCase().replace(/^uds-core-/, "").replace(/-common$/, "").replace(/-fips$/, "");
}

function displayName(value: string) {
  return value.split(/[-_.]+/).filter(Boolean).map((part) => part.length <= 3 ? part.toUpperCase() : `${part[0].toUpperCase()}${part.slice(1)}`).join(" ");
}

export function resolveApplicationIdentity(input: {
  packageName: string;
  packageDescription: string | null;
  packageUpstreamUrl: string | null;
  componentName: string;
  chartNames: string[];
  chartVersions: Array<string | null>;
  image: ParsedImageReference;
}): ResolvedApplicationIdentity {
  const component = normalizedName(input.componentName);
  const imageLeaf = normalizedName(input.image.repository.split("/").at(-1) ?? input.image.repository);
  const chartNames = input.chartNames.map(normalizedName);
  const upstreamFromMetadata = input.packageUpstreamUrl?.match(/^https?:\/\/github\.com\/([^/]+\/[^/#]+?)(?:\.git)?(?:[#/]|$)/i)?.[1] ?? null;
  const version = normalizedVersion(input.image.tag) ?? input.chartVersions.map(normalizedVersion).find(Boolean) ?? null;
  const testContext = [normalizedName(input.packageName), component].some((value) => /(?:^|[-_])tests?(?:$|[-_])/.test(value));
  if (testContext) return { name: null, version, upstreamRepository: upstreamFromMetadata, purl: null, cpe: null, confidence: "unknown", role: "support" };

  const mapping = SECURITY_PRODUCT_PROFILES.find((candidate) =>
    candidate.imageRepositories.some((pattern) => pattern.test(input.image.repository.toLowerCase()))
    || (candidate.aliases.some((pattern) => pattern.test(component)) && candidate.aliases.some((pattern) => pattern.test(imageLeaf)))
    || (candidate.aliases.some((pattern) => pattern.test(imageLeaf)) && chartNames.some((name) => candidate.aliases.some((pattern) => pattern.test(name))))
  );

  if (mapping) {
    const applicationVersion = version && (!mapping.applicationVersionPattern || mapping.applicationVersionPattern.test(version)) ? version : null;
    return {
      name: mapping.name,
      version: applicationVersion,
      upstreamRepository: upstreamFromMetadata ?? mapping.upstreamRepository,
      purl: mapping.purl ?? null,
      cpe: mapping.cpe && applicationVersion ? `cpe:2.3:a:${cpeValue(mapping.cpe.vendor)}:${cpeValue(mapping.cpe.product)}:${cpeValue(normalizeAdvisoryVersion(applicationVersion))}:*:*:*:*:*:*:*` : null,
      confidence: "identified",
      role: "application",
    };
  }

  const supportCandidate = [normalizedName(input.packageName), component, imageLeaf].some((value) => /(?:^|[-_])(?:test|tests|plugin|plugins|monitoring|client)(?:$|[-_])/.test(value));
  if (supportCandidate) return { name: null, version, upstreamRepository: upstreamFromMetadata, purl: null, cpe: null, confidence: "unknown", role: "support" };

  const componentMatchesImage = component.length >= 3 && (component === imageLeaf || component.includes(imageLeaf) || imageLeaf.includes(component));
  if (componentMatchesImage) {
    return {
      name: displayName(imageLeaf),
      version,
      upstreamRepository: upstreamFromMetadata,
      purl: null,
      cpe: null,
      confidence: "probable",
      role: "application",
    };
  }

  return { name: null, version, upstreamRepository: upstreamFromMetadata, purl: null, cpe: null, confidence: "unknown", role: "application" };
}
