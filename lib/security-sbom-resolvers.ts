import "server-only";

import type { ContainerArtifact } from "@/components/security-types";
import { discoverGithubAttestationSbom } from "@/lib/security-github-sbom";
import type { ParsedImageReference } from "@/lib/security-normalization";
import { discoverOciSboms } from "@/lib/security-oci";
import { parseSbom, type ParsedSbom } from "@/lib/security-sbom";

export type SecuritySbomDocument = { document: unknown; text: string; source: string; artifactName?: string };
export type ResolvedSecuritySbom = { parsed: ParsedSbom; source: string; associatedDigest: string };
export type SBOMResolverContext = {
  repositoryId: string;
  artifact: ContainerArtifact;
  image: ParsedImageReference;
  digest: string;
  repositoryDocuments: () => Promise<SecuritySbomDocument[]>;
};

export interface SBOMResolver {
  readonly id: string;
  resolve(context: SBOMResolverContext): Promise<ResolvedSecuritySbom | null>;
}

export class OCIReferrerSBOMResolver implements SBOMResolver {
  readonly id = "oci-referrers";

  async resolve(context: SBOMResolverContext) {
    const documents = await discoverOciSboms(context.image, context.digest);
    for (const document of documents) {
      const parsed = parseSbom(document.document);
      if (parsed && document.associatedDigest === context.digest) return { parsed, source: document.source, associatedDigest: document.associatedDigest };
    }
    return null;
  }
}

export class GitHubAttestationSBOMResolver implements SBOMResolver {
  readonly id = "github-attestations";

  async resolve(context: SBOMResolverContext) {
    const ghcrRepository = context.artifact.registry === "ghcr.io" ? context.artifact.imageRepository.split("/").slice(0, 2).join("/") : "";
    return await discoverGithubAttestationSbom([context.artifact.upstreamRepository ?? "", ghcrRepository, context.repositoryId], context.digest);
  }
}

export function resolveRepositoryDocumentSbom(artifact: ContainerArtifact, documents: SecuritySbomDocument[], digest: string | null) {
  const expectedZarfName = `${artifact.registry}_${artifact.imageRepository.replace(/\//g, "_")}_${artifact.tag ?? "latest"}.json`.toLowerCase();
  const references = [digest, artifact.imageReference, `${artifact.registry}/${artifact.imageRepository}:${artifact.tag}`].filter((value): value is string => Boolean(value)).map((value) => value.toLowerCase());
  const document = documents.find((candidate) => candidate.artifactName?.toLowerCase() === expectedZarfName || references.some((reference) => candidate.text.includes(reference)));
  if (!document) return null;
  const parsed = parseSbom(document.document);
  return parsed ? { parsed, source: document.source, associatedDigest: digest } : null;
}

export class RepositoryAndReleaseSBOMResolver implements SBOMResolver {
  readonly id = "github-repository-and-releases";

  async resolve(context: SBOMResolverContext) {
    const result = resolveRepositoryDocumentSbom(context.artifact, await context.repositoryDocuments(), context.digest);
    return result ? { ...result, associatedDigest: context.digest } : null;
  }
}

export async function resolveSecuritySbom(context: SBOMResolverContext, resolvers: SBOMResolver[]) {
  for (const resolver of resolvers) {
    try {
      const result = await resolver.resolve(context);
      if (result) return result;
    } catch {
      // Resolver failures reduce coverage; they do not prevent other remote sources from being checked.
    }
  }
  return null;
}
