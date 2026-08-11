import "server-only";

import { createHash } from "node:crypto";
import { githubContainerRegistryAuthorization } from "@/lib/github";
import type { ParsedImageReference } from "@/lib/security-normalization";
import { defenseRegistryAuthorization } from "@/lib/security-registry-auth";

const MANIFEST_ACCEPT = [
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
  "application/vnd.docker.distribution.manifest.v2+json",
  "application/vnd.oci.artifact.manifest.v1+json",
].join(", ");
const USER_AGENT = "uds-scout-security";
const MAX_SBOM_BYTES = 20 * 1024 * 1024;
const MAX_ZARF_SBOM_DOCUMENT_BYTES = 75 * 1024 * 1024;
const MAX_ZARF_SBOM_ARCHIVE_BYTES = 200 * 1024 * 1024;

type OciDescriptor = {
  mediaType?: string;
  digest: string;
  size?: number;
  artifactType?: string;
  annotations?: Record<string, string>;
  platform?: { architecture?: string; os?: string };
};
type OciManifest = {
  schemaVersion: number;
  mediaType?: string;
  artifactType?: string;
  subject?: OciDescriptor;
  config?: OciDescriptor;
  layers?: OciDescriptor[];
  blobs?: OciDescriptor[];
  manifests?: OciDescriptor[];
};
type ReferrersResponse = { referrers?: OciDescriptor[]; manifests?: OciDescriptor[] };

type RegistryAuth = { token: string; expiresAt: number };
const tokenCache = new Map<string, RegistryAuth>();

function assertPublicHttps(value: string, expectedHost?: string) {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("Scout only connects to HTTPS registries.");
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host === "0.0.0.0" || host === "::1") throw new Error("Local registry addresses are not inspected.");
  if (/^(?:10|127|169\.254|192\.168)\./.test(host) || /^172\.(?:1[6-9]|2\d|3[01])\./.test(host)) throw new Error("Private registry addresses are not inspected.");
  if (expectedHost && url.host !== expectedHost) throw new Error("Registry request changed hosts unexpectedly.");
  return url;
}

function bearerChallenge(value: string | null) {
  if (!value?.toLowerCase().startsWith("bearer ")) return null;
  const parameters = Object.fromEntries([...value.slice(7).matchAll(/([a-zA-Z_]+)="([^"]*)"/g)].map((match) => [match[1].toLowerCase(), match[2]]));
  return parameters.realm ? { realm: parameters.realm, service: parameters.service, scope: parameters.scope } : null;
}

async function registryToken(challenge: { realm: string; service?: string; scope?: string }, requestedScope: string, authorization?: string) {
  const realm = assertPublicHttps(challenge.realm);
  if (authorization && realm.hostname !== "ghcr.io") throw new Error("Registry authentication challenge changed credential hosts unexpectedly.");
  if (challenge.service) realm.searchParams.set("service", challenge.service);
  realm.searchParams.set("scope", challenge.scope || requestedScope);
  const key = `${realm}:${authorization ? createHash("sha256").update(authorization).digest("hex").slice(0, 12) : "anonymous"}`;
  const cached = tokenCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.token;
  const response = await fetch(realm, { headers: { "User-Agent": USER_AGENT, ...(authorization ? { Authorization: authorization } : {}) }, cache: "no-store", signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`Registry authentication metadata returned ${response.status}.`);
  const body = await response.json() as { token?: string; access_token?: string; expires_in?: number };
  const token = body.token ?? body.access_token;
  if (!token) throw new Error("Registry did not provide an anonymous pull token.");
  tokenCache.set(key, { token, expiresAt: Date.now() + Math.max(60, body.expires_in ?? 300) * 1000 - 10_000 });
  return token;
}

function registryAuthorization(image: ParsedImageReference) {
  if (image.registryHost === "ghcr.io") return githubContainerRegistryAuthorization();
  if (image.registryHost === "registry.defenseunicorns.com") return defenseRegistryAuthorization();
  return undefined;
}

async function registryFetch(image: ParsedImageReference, path: string, accept: string, maximumBytes = 2 * 1024 * 1024, allowBlobRedirect = false) {
  const base = assertPublicHttps(`https://${image.registryHost}`);
  const url = new URL(path, base);
  if (url.host !== base.host) throw new Error("Invalid registry path.");
  const request = async (authorization?: string) => fetch(url, {
    headers: { Accept: accept, "User-Agent": USER_AGENT, ...(authorization ? { Authorization: authorization } : {}) },
    cache: "no-store",
    redirect: "manual",
    signal: AbortSignal.timeout(20_000),
  });
  const authorization = registryAuthorization(image);
  let response = await request(authorization);
  if (response.status === 401) {
    const challenge = bearerChallenge(response.headers.get("www-authenticate"));
    if (!challenge) throw new Error("Registry requires credentials that Scout does not have.");
    const token = await registryToken(challenge, `repository:${image.repository}:pull`, authorization);
    response = await request(`Bearer ${token}`);
  }
  if (allowBlobRedirect) {
    let redirectCount = 0;
    let redirectBase = url;
    while (response.status >= 300 && response.status < 400 && redirectCount < 4) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Registry blob redirect did not include a location.");
      const redirect = assertPublicHttps(new URL(location, redirectBase).toString());
      response = await fetch(redirect, { headers: { Accept: accept, "User-Agent": USER_AGENT }, cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(45_000) });
      redirectBase = redirect;
      redirectCount += 1;
    }
  }
  if (!response.ok) throw new Error(`Registry returned ${response.status} ${response.statusText}.`);
  const declaredSize = Number(response.headers.get("content-length") ?? 0);
  if (declaredSize > maximumBytes) throw new Error("Registry artifact exceeds Scout's remote metadata size limit.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maximumBytes) throw new Error("Registry artifact exceeds Scout's remote metadata size limit.");
  return { bytes, headers: response.headers };
}

function json<T>(bytes: Uint8Array): T {
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

export function clearSecurityRegistryTokenCache() {
  tokenCache.clear();
}

export async function resolveImageManifest(image: ParsedImageReference) {
  const reference = image.digest ?? image.tag ?? "latest";
  const result = await registryFetch(image, `/v2/${image.repository}/manifests/${encodeURIComponent(reference)}`, MANIFEST_ACCEPT);
  const manifest = json<OciManifest>(result.bytes);
  const digest = result.headers.get("docker-content-digest") ?? `sha256:${createHash("sha256").update(result.bytes).digest("hex")}`;
  return { digest, manifest, mediaType: result.headers.get("content-type")?.split(";")[0] ?? manifest.mediaType ?? null };
}

function sbomDescriptor(descriptor: OciDescriptor) {
  const value = [descriptor.mediaType, descriptor.artifactType, ...Object.entries(descriptor.annotations ?? {}).flat()].join(" ").toLowerCase();
  return /sbom|spdx|cyclonedx|syft|in-toto|attestation/.test(value);
}

function sbomLayer(descriptor: OciDescriptor) {
  const value = [descriptor.mediaType, descriptor.annotations?.["org.opencontainers.image.title"]].filter(Boolean).join(" ").toLowerCase();
  return /json|sbom|spdx|cyclonedx|syft|in-toto|dsse/.test(value);
}

function tarEntries(bytes: Uint8Array) {
  const entries: { name: string; bytes: Uint8Array }[] = [];
  for (let offset = 0; offset + 512 <= bytes.byteLength;) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every((value) => value === 0)) break;
    const field = (start: number, length: number) => new TextDecoder().decode(header.subarray(start, start + length)).replace(/\0.*$/, "").trim();
    const name = [field(345, 155), field(0, 100)].filter(Boolean).join("/").replace(/^\.\/+/, "");
    const size = Number.parseInt(field(124, 12).replace(/\0/g, "").trim() || "0", 8);
    if (!Number.isFinite(size) || size < 0 || offset + 512 + size > bytes.byteLength) break;
    if (name && name !== "." && size <= MAX_ZARF_SBOM_DOCUMENT_BYTES) entries.push({ name, bytes: bytes.subarray(offset + 512, offset + 512 + size) });
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return entries;
}

export async function discoverPublishedZarfSboms(image: ParsedImageReference) {
  const root = await resolveImageManifest(image);
  let manifest = root.manifest;
  if (manifest.manifests?.length) {
    const architecture = process.arch === "x64" ? "amd64" : process.arch;
    const child = manifest.manifests.find((candidate) => candidate.platform?.architecture === architecture) ?? manifest.manifests[0];
    const result = await registryFetch(image, `/v2/${image.repository}/manifests/${encodeURIComponent(child.digest)}`, MANIFEST_ACCEPT, 2 * 1024 * 1024);
    manifest = json<OciManifest>(result.bytes);
  }
  const sbomLayer = manifest.layers?.find((layer) => layer.annotations?.["org.opencontainers.image.title"] === "sboms.tar");
  if (!sbomLayer || (sbomLayer.size ?? 0) > MAX_ZARF_SBOM_ARCHIVE_BYTES) return [];
  const archive = await registryFetch(image, `/v2/${image.repository}/blobs/${encodeURIComponent(sbomLayer.digest)}`, "application/octet-stream", MAX_ZARF_SBOM_ARCHIVE_BYTES, true);
  return tarEntries(archive.bytes).flatMap((entry) => {
    try {
      return [{ name: entry.name, document: json<unknown>(entry.bytes) }];
    } catch {
      return [];
    }
  });
}

export async function discoverOciSboms(image: ParsedImageReference, digest: string) {
  let descriptors: OciDescriptor[] = [];
  try {
    const result = await registryFetch(image, `/v2/${image.repository}/referrers/${encodeURIComponent(digest)}`, "application/vnd.oci.image.index.v1+json, application/json");
    const body = json<ReferrersResponse>(result.bytes);
    descriptors = (body.referrers ?? body.manifests ?? []).filter(sbomDescriptor).slice(0, 30);
  } catch {
    return [];
  }

  const documents: { document: unknown; source: string; associatedDigest: string }[] = [];
  for (const descriptor of descriptors) {
    try {
      const manifestResult = await registryFetch(image, `/v2/${image.repository}/manifests/${encodeURIComponent(descriptor.digest)}`, MANIFEST_ACCEPT);
      const manifest = json<OciManifest>(manifestResult.bytes);
      const layers = [...(manifest.layers ?? []), ...(manifest.blobs ?? [])].filter(sbomLayer).slice(0, 5);
      for (const layer of layers) {
        const blob = await registryFetch(image, `/v2/${image.repository}/blobs/${encodeURIComponent(layer.digest)}`, "application/json, application/octet-stream", MAX_SBOM_BYTES, true);
        try {
          documents.push({ document: json<unknown>(blob.bytes), source: "OCI referrer", associatedDigest: manifest.subject?.digest ?? digest });
        } catch {
          // Ignore non-JSON attestation layers. Scout never treats their absence as zero findings.
        }
      }
    } catch {
      // Continue to other attached artifacts when one referrer cannot be read.
    }
  }
  return documents;
}
