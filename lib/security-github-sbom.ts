import "server-only";

import { githubBinaryRequest, githubRequest } from "@/lib/github";
import { parseSbom, sbomAssociationText, type ParsedSbom } from "@/lib/security-sbom";

type AttestationResponse = { attestations?: unknown[] };
type GithubRelease = { tag_name: string; assets: { id: number; name: string; size: number }[] };
type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : null;
}

function payloads(value: unknown, depth = 0): string[] {
  if (depth > 8) return [];
  const item = record(value);
  if (!item) return Array.isArray(value) ? value.flatMap((candidate) => payloads(candidate, depth + 1)) : [];
  const direct = typeof item.payload === "string" ? [item.payload] : [];
  return [...direct, ...Object.values(item).flatMap((candidate) => payloads(candidate, depth + 1))];
}

function decode(value: string) {
  try {
    return JSON.parse(Buffer.from(value, "base64").toString("utf8")) as unknown;
  } catch {
    return null;
  }
}

export async function discoverGithubReleaseSboms(repository: string) {
  const releases = await githubRequest<GithubRelease[]>(`/repos/${repository}/releases?per_page=10`, 12 * 60 * 60_000).catch(() => []);
  const assets = releases.flatMap((release) => release.assets.map((asset) => ({ ...asset, tag: release.tag_name })))
    .filter((asset) => asset.size <= 20 * 1024 * 1024 && /(?:sbom|spdx|cyclonedx|syft).*\.json$/i.test(asset.name))
    .slice(0, 30);
  const documents: { document: unknown; text: string; source: string }[] = [];
  for (const asset of assets) {
    try {
      const bytes = await githubBinaryRequest(`/repos/${repository}/releases/assets/${asset.id}`);
      const document = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
      if (parseSbom(document)) documents.push({ document, text: sbomAssociationText(document), source: `GitHub release asset (${asset.tag}/${asset.name})` });
    } catch {
      // Continue through other release assets when one cannot be downloaded or parsed.
    }
  }
  return documents;
}

export async function discoverGithubAttestationSbom(repositories: string[], digest: string): Promise<{ parsed: ParsedSbom; source: string; associatedDigest: string } | null> {
  for (const repository of [...new Set(repositories.filter((candidate) => /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(candidate)))].slice(0, 3)) {
    try {
      const result = await githubRequest<AttestationResponse>(`/repos/${repository}/attestations/${encodeURIComponent(digest)}?per_page=100`, 12 * 60 * 60_000);
      for (const attestation of result.attestations ?? []) {
        for (const payload of payloads(attestation)) {
          const document = decode(payload);
          const parsed = document ? parseSbom(document) : null;
          if (parsed) return { parsed, source: `GitHub attestation (${repository})`, associatedDigest: digest };
        }
      }
    } catch {
      // An absent attestation or inaccessible upstream repository is not a repository analysis failure.
    }
  }
  return null;
}
