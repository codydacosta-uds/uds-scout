import "server-only";

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type {
  ContainerArtifact,
  RepositorySecurity,
  SBOMPackage,
  SecurityApplication,
  SecurityCounts,
  SecurityFinding,
  SecurityRefreshStage,
  SecurityWorkspace,
  Vulnerability,
  ZarfPackage,
} from "@/components/security-types";
import { localSettingsPath } from "@/lib/local-settings";
import { queryApplicationAdvisories, queryOsvPackages, type AdvisoryMatch } from "@/lib/security-advisories";
import { resolveApplicationIdentity, parseImageReference, stableSecurityId } from "@/lib/security-normalization";
import { discoverDefenseUnicornsRegistryData } from "@/lib/security-defense-unicorns-registry";
import { discoverGithubReleaseSboms } from "@/lib/security-github-sbom";
import { resolveImageManifest } from "@/lib/security-oci";
import { GitHubAttestationSBOMResolver, OCIReferrerSBOMResolver, RepositoryAndReleaseSBOMResolver, resolveRepositoryDocumentSbom, resolveSecuritySbom, type SecuritySbomDocument } from "@/lib/security-sbom-resolvers";
import { containerFindingCategory, parseSbom, sbomAssociationText, type ParsedSbom } from "@/lib/security-sbom";
import { discoverZarfPackages, loadRepositorySecurityTree, readRepositoryJson, type RepositorySecuritySource } from "@/lib/security-zarf";
import { discoverPublishedZarfPackageSboms } from "@/lib/security-zarf-sbom";

const CACHE_VERSION = 1;
const SECURITY_ANALYSIS_VERSION = 21;
const SECURITY_TTL = 12 * 60 * 60_000;
const INVENTORY_TTL = 7 * 24 * 60 * 60_000;
const MAX_REPOSITORY_SBOMS = 30;

type CachedInventory = ParsedSbom & { source: string; associatedDigest: string; fetchedAt: string };
type SecurityStore = {
  version: number;
  repositories: Record<string, RepositorySecurity>;
  digestInventories: Record<string, CachedInventory>;
  negativeInventories: Record<string, string>;
  repositoryAnalysisVersions: Record<string, number>;
  updatedAt: string;
};
type ArtifactInventory = { artifactId: string; parsed: ParsedSbom; source: string; associatedDigest: string | null };

const SBOM_RESOLVERS = [new OCIReferrerSBOMResolver(), new GitHubAttestationSBOMResolver(), new RepositoryAndReleaseSBOMResolver()];

const STAGES: SecurityRefreshStage[] = [
  { id: "packages", label: "Package metadata discovered", state: "pending" },
  { id: "applications", label: "Applications identified", state: "pending" },
  { id: "application-advisories", label: "Application advisories checked", state: "pending" },
  { id: "images", label: "Container images resolved", state: "pending" },
  { id: "sboms", label: "SBOM availability checked", state: "pending" },
  { id: "dependencies", label: "Container dependencies evaluated", state: "pending" },
];

function securityCachePath() {
  return process.env.UDS_SCOUT_SECURITY_PATH ?? join(dirname(localSettingsPath()), "security-cache.json");
}

function emptyCounts(): SecurityCounts {
  return { total: 0, critical: 0, high: 0, medium: 0, low: 0, unknown: 0, application: 0, container: 0, fixAvailable: 0 };
}

function countsFor(findings: SecurityFinding[]): SecurityCounts {
  return findings.reduce<SecurityCounts>((counts, finding) => {
    counts.total += 1;
    counts[finding.severity] += 1;
    counts[finding.category === "application" ? "application" : "container"] += 1;
    if (finding.fixedVersion) counts.fixAvailable += 1;
    return counts;
  }, emptyCounts());
}

function emptyRepository(repository: string): RepositorySecurity {
  return {
    repositoryId: repository,
    revision: null,
    applicable: null,
    state: "pending",
    stale: true,
    error: null,
    stages: STAGES.map((stage) => ({ ...stage })),
    packages: [], applications: [], artifacts: [], vulnerabilities: {}, findings: [], counts: emptyCounts(),
    coverage: { applicationsIdentified: 0, applicationsTotal: 0, containerImages: 0, fullContainerCoverage: 0, partialContainerCoverage: 0, unavailableContainerCoverage: 0 },
    analyzedAt: null, refreshStartedAt: null,
  };
}

function loadStore(): SecurityStore {
  try {
    const value = JSON.parse(readFileSync(/* turbopackIgnore: true */ securityCachePath(), "utf8")) as SecurityStore;
    if (value.version !== CACHE_VERSION || !value.repositories || !value.digestInventories) throw new Error("Unsupported cache schema.");
    value.negativeInventories ??= {};
    value.repositoryAnalysisVersions ??= {};
    Object.values(value.repositories).forEach((repository) => {
      if (repository.state === "refreshing" || repository.state === "queued") repository.state = "pending";
      repository.stale = !repository.analyzedAt || Date.now() - new Date(repository.analyzedAt).getTime() > SECURITY_TTL;
    });
    return value;
  } catch {
    return { version: CACHE_VERSION, repositories: {}, digestInventories: {}, negativeInventories: {}, repositoryAnalysisVersions: {}, updatedAt: new Date(0).toISOString() };
  }
}

function saveStore(store: SecurityStore) {
  const path = securityCachePath();
  const temporary = `${path}.${process.pid}.tmp`;
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  store.updatedAt = new Date().toISOString();
  writeFileSync(temporary, `${JSON.stringify(store)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, path);
}

async function mapLimit<T, R>(items: T[], concurrency: number, task: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const output = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      output[index] = await task(items[index], index);
    }
  }));
  return output;
}

function setStage(repository: RepositorySecurity, id: SecurityRefreshStage["id"], state: SecurityRefreshStage["state"], detail?: string) {
  repository.stages = repository.stages.map((stage) => stage.id === id ? { ...stage, state, ...(detail ? { detail } : {}) } : stage);
}

function applicationArtifacts(packages: ZarfPackage[], repository: string) {
  const artifacts: ContainerArtifact[] = [];
  const applications = new Map<string, SecurityApplication>();
  for (const packageItem of packages) {
    for (const component of packageItem.components) {
      const componentArtifacts: Array<{ identity: ReturnType<typeof resolveApplicationIdentity>; artifact: ContainerArtifact }> = component.imageReferences.map((reference) => {
        const image = parseImageReference(reference);
        const identity = resolveApplicationIdentity({
          packageName: packageItem.name,
          packageDescription: packageItem.description,
          packageUpstreamUrl: packageItem.upstreamUrl,
          componentName: component.name,
          chartNames: component.charts.map((chart) => chart.name),
          chartVersions: component.charts.map((chart) => chart.version),
          image,
        });
        const artifactId = stableSecurityId(repository, packageItem.id, component.id, reference);
        return {
          identity,
          artifact: {
            id: artifactId, repositoryId: repository, packageId: packageItem.id, zarfPackageName: packageItem.name,
            componentName: component.name, flavor: component.flavor, imageReference: reference,
            registry: image.registry, imageRepository: image.repository, tag: image.tag, digest: image.digest,
            applicationId: null, applicationName: identity.name, applicationVersion: identity.version,
            upstreamRepository: identity.upstreamRepository, applicationIdentificationConfidence: identity.confidence,
            securityCoverage: { application: "unknown" as const, container: "unavailable" as const, sources: [] },
            sbom: { available: false, source: null, format: null, packageCount: null, associatedDigest: null },
            findingIds: [], resolutionError: null, lastAnalyzedAt: null,
          } satisfies ContainerArtifact,
        };
      });
      artifacts.push(...componentArtifacts.map((item) => item.artifact));
      const candidateArtifacts = componentArtifacts.filter((item) => item.identity.role === "application");
      const identified = candidateArtifacts.filter((item) => item.identity.name && item.identity.confidence !== "unknown");
      const appCandidates = identified.length ? identified : candidateArtifacts.length ? [candidateArtifacts[0]] : [];
      for (const candidate of appCandidates) {
        const identity = candidate.identity;
        const key = `${packageItem.id}:${component.name}:${identity.name ?? "unknown"}:${identity.version ?? "unknown"}`;
        let application = applications.get(key);
        if (!application) {
          const id = stableSecurityId(repository, key);
          application = {
            id, name: identity.name ?? "Unidentified application", version: identity.version,
            upstreamRepository: identity.upstreamRepository, purl: identity.purl, cpe: identity.cpe, confidence: identity.confidence,
            packageId: packageItem.id, packageName: packageItem.name, component: component.name,
            flavors: [], artifactIds: [], coverage: "unknown", coverageReason: null,
            advisorySources: [], expectedAdvisorySources: [], advisoryCheckedAt: null,
            exposure: "unknown", exposureReason: "Repository package metadata does not establish where the application is exposed.",
            findingIds: [], fixedVersion: null,
          };
          applications.set(key, application);
        }
        const matchingArtifacts = componentArtifacts.filter((item) => item.identity.name === identity.name && item.identity.version === identity.version);
        for (const match of matchingArtifacts) {
          match.artifact.applicationId = application.id;
          application.artifactIds.push(match.artifact.id);
          if (match.artifact.flavor && !application.flavors.includes(match.artifact.flavor)) application.flavors.push(match.artifact.flavor);
        }
      }
    }
  }
  return { artifacts, applications: [...applications.values()] };
}

function mergeVulnerability(target: Record<string, Vulnerability>, vulnerability: Vulnerability) {
  const incomingIds = new Set([vulnerability.id, ...vulnerability.aliases]);
  const existing = Object.values(target).find((candidate) => [candidate.id, ...candidate.aliases].some((id) => incomingIds.has(id)));
  if (!existing) {
    target[vulnerability.id] = vulnerability;
    return vulnerability.id;
  }
  existing.aliases = [...new Set([...existing.aliases, vulnerability.id, ...vulnerability.aliases].filter((id) => id !== existing.id))];
  existing.providers = [...new Set([...existing.providers, ...vulnerability.providers])];
  existing.references = [...new Set([...existing.references, ...vulnerability.references])];
  if (existing.severity === "unknown" && vulnerability.severity !== "unknown") existing.severity = vulnerability.severity;
  if (existing.cvss === null && vulnerability.cvss !== null) existing.cvss = vulnerability.cvss;
  if (!existing.description && vulnerability.description) existing.description = vulnerability.description;
  return existing.id;
}

function deduplicateFindings(findings: SecurityFinding[]) {
  const unique = new Map<string, SecurityFinding>();
  for (const finding of findings) {
    const existing = unique.get(finding.id);
    if (!existing) unique.set(finding.id, finding);
    else {
      existing.sources = [...new Set([...existing.sources, ...finding.sources])];
      existing.fixedVersion ??= finding.fixedVersion;
      if (existing.severity === "unknown") existing.severity = finding.severity;
    }
  }
  return [...unique.values()];
}

function findingFromMatch(input: {
  match: AdvisoryMatch; repository: string; packageId: string; artifactId: string | null; applicationId: string | null;
  component: string; flavor: string | null; category: SecurityFinding["category"]; affectedPackage: string; installedVersion: string | null;
  vulnerabilities: Record<string, Vulnerability>; previous: Map<string, SecurityFinding>; now: string;
}) {
  const vulnerabilityId = mergeVulnerability(input.vulnerabilities, input.match.vulnerability);
  const id = stableSecurityId(input.repository, input.packageId, input.artifactId, input.applicationId, input.category, input.affectedPackage, vulnerabilityId);
  const old = input.previous.get(id);
  return {
    id, vulnerabilityId, repositoryId: input.repository, packageId: input.packageId, artifactId: input.artifactId,
    applicationId: input.applicationId, component: input.component, flavor: input.flavor, category: input.category,
    affectedPackage: input.affectedPackage, installedVersion: input.installedVersion, affectedVersion: input.match.affectedVersion,
    fixedVersion: input.match.fixedVersion, severity: input.match.vulnerability.severity,
    sources: [...new Set([input.match.source, ...input.match.vulnerability.providers])], status: "open" as const,
    firstSeenAt: old?.firstSeenAt ?? input.now, lastSeenAt: input.now,
  } satisfies SecurityFinding;
}

async function repositorySboms(source: RepositorySecuritySource) {
  const candidates = source.tree.filter((item) => item.type === "blob" && item.size !== undefined && item.size <= 20_000_000 && /(?:sbom|spdx|cyclonedx|bom)[^/]*\.json$/i.test(item.path)).slice(0, MAX_REPOSITORY_SBOMS);
  const [results, releaseAssets, publishedZarfSboms] = await Promise.all([
    mapLimit(candidates, 4, async (item): Promise<SecuritySbomDocument | null> => {
      try {
        const document = await readRepositoryJson(source.repository, source.defaultBranch, item.path);
        return parseSbom(document) ? { document, text: sbomAssociationText(document), source: `Repository SBOM (${item.path})` } : null;
      } catch {
        return null;
      }
    }),
    discoverGithubReleaseSboms(source.repository),
    discoverPublishedZarfPackageSboms(source.repository, source.packages),
  ]);
  return [...results.filter((item): item is SecuritySbomDocument => Boolean(item)), ...releaseAssets, ...publishedZarfSboms];
}

function inventoryKey(artifact: ContainerArtifact, digest: string) {
  return `${artifact.registry}/${artifact.imageRepository}@${digest}`.toLowerCase();
}

function packageKey(item: SBOMPackage) {
  return `${item.purl ?? `${item.ecosystem ?? item.type ?? "unknown"}:${item.name}`}@${item.version ?? "unknown"}`.toLowerCase();
}

class SecurityRefreshService {
  private store = loadStore();
  private queue: string[] = [];
  private active = new Set<string>();
  private maximumConcurrency = 2;

  snapshot(repositories: string[], force = false): SecurityWorkspace {
    const selected = repositories.map((repository) => {
      const key = repository.toLowerCase();
      const current = this.store.repositories[key] ?? emptyRepository(repository);
      this.store.repositories[key] = current;
      current.stale = !current.analyzedAt || Date.now() - new Date(current.analyzedAt).getTime() > SECURITY_TTL;
      const analysisOutdated = this.store.repositoryAnalysisVersions[key] !== SECURITY_ANALYSIS_VERSION;
      if ((force || analysisOutdated || current.stale || current.state === "pending" || current.state === "error") && !this.active.has(key) && !this.queue.includes(key)) this.enqueue(repository, force);
      return current;
    });
    const counts = selected.reduce<SecurityCounts>((total, item) => {
      (Object.keys(total) as (keyof SecurityCounts)[]).forEach((key) => { total[key] += item.counts[key]; });
      return total;
    }, emptyCounts());
    const applicable = selected.filter((item) => item.applicable === true);
    const coverage = applicable.reduce((summary, item) => {
      const evaluatedImages = item.coverage.fullContainerCoverage + item.coverage.partialContainerCoverage;
      if (item.coverage.containerImages === 0 || evaluatedImages === 0) summary.unavailable += 1;
      else if (item.coverage.partialContainerCoverage > 0 || item.coverage.unavailableContainerCoverage > 0) summary.partial += 1;
      else summary.full += 1;
      return summary;
    }, { full: 0, partial: 0, unavailable: 0 });
    return {
      repositories: selected,
      summary: {
        repositories: selected.length, applicableRepositories: applicable.length,
        applications: applicable.reduce((total, item) => total + item.applications.length, 0),
        containerImages: applicable.reduce((total, item) => total + item.artifacts.length, 0), counts,
        repositoriesRequiringAttention: applicable.filter((item) => item.counts.critical > 0 || item.counts.high > 0).length,
        coverage,
      },
      refreshing: selected.some((item) => item.state === "queued" || item.state === "refreshing"),
      generatedAt: new Date().toISOString(),
    };
  }

  private enqueue(repository: string, force: boolean) {
    const key = repository.toLowerCase();
    const current = this.store.repositories[key] ?? emptyRepository(repository);
    this.store.repositories[key] = current;
    current.state = "queued";
    current.error = null;
    if (force) {
      current.stale = true;
      this.store.negativeInventories = {};
    }
    this.queue.push(repository);
    saveStore(this.store);
    void this.drain();
  }

  private async drain() {
    while (this.active.size < this.maximumConcurrency && this.queue.length) {
      const repository = this.queue.shift()!;
      const key = repository.toLowerCase();
      this.active.add(key);
      void this.refreshRepository(repository).finally(() => {
        this.active.delete(key);
        void this.drain();
      });
    }
  }

  private checkpoint(repository: RepositorySecurity) {
    this.store.repositories[repository.repositoryId.toLowerCase()] = repository;
    saveStore(this.store);
  }

  private async refreshRepository(repositoryId: string) {
    const key = repositoryId.toLowerCase();
    const previous = this.store.repositories[key] ?? emptyRepository(repositoryId);
    const repository: RepositorySecurity = { ...previous, state: "refreshing", stale: true, error: null, refreshStartedAt: new Date().toISOString(), stages: STAGES.map((stage) => ({ ...stage })) };
    this.checkpoint(repository);
    const now = new Date().toISOString();
    try {
      setStage(repository, "packages", "running");
      const sourceTree = await loadRepositorySecurityTree(repositoryId);
      const source = sourceTree.revision === previous.revision && previous.packages.length
        ? { ...sourceTree, packages: previous.packages }
        : await discoverZarfPackages(repositoryId, sourceTree);
      repository.revision = source.revision;
      repository.packages = source.packages;
      repository.applicable = source.packages.length > 0;
      setStage(repository, "packages", "complete", source.packages.length ? `${source.packages.length} Zarf package definitions` : "No Zarf package definitions found");
      if (!source.packages.length) {
        repository.applications = [];
        repository.artifacts = [];
        repository.findings = [];
        repository.vulnerabilities = {};
        repository.counts = emptyCounts();
        repository.coverage = { applicationsIdentified: 0, applicationsTotal: 0, containerImages: 0, fullContainerCoverage: 0, partialContainerCoverage: 0, unavailableContainerCoverage: 0 };
        repository.stages = repository.stages.map((stage) => stage.id === "packages" ? stage : { ...stage, state: "limited", detail: "Not applicable without a Zarf package definition" });
        repository.state = "ready";
        repository.stale = false;
        repository.analyzedAt = now;
        this.store.repositoryAnalysisVersions[key] = SECURITY_ANALYSIS_VERSION;
        this.checkpoint(repository);
        return;
      }
      this.checkpoint(repository);

      setStage(repository, "applications", "running");
      const normalized = applicationArtifacts(source.packages, repositoryId);
      repository.applications = normalized.applications;
      repository.artifacts = normalized.artifacts;
      setStage(repository, "applications", normalized.applications.some((app) => app.confidence === "unknown") ? "limited" : "complete", `${normalized.applications.filter((app) => app.confidence !== "unknown").length} of ${normalized.applications.length} identified`);
      this.checkpoint(repository);

      const vulnerabilities: Record<string, Vulnerability> = {};
      const findings: SecurityFinding[] = [];
      const oldFindings = new Map(previous.findings.map((finding) => [finding.id, finding]));
      setStage(repository, "application-advisories", "running");
      await mapLimit(repository.applications, 4, async (application) => {
        if (!application.version || application.confidence === "unknown") {
          application.coverage = "unknown";
          application.coverageReason = application.confidence === "unknown" ? "Scout could not reliably identify this application." : "The application version is not established.";
          return;
        }
        const result = await queryApplicationAdvisories({
          name: application.name, version: application.version, purl: application.purl, cpe: application.cpe, upstreamRepository: application.upstreamRepository,
        });
        application.advisorySources = result.providers;
        application.expectedAdvisorySources = result.expectedProviders;
        application.advisoryCheckedAt = now;
        application.coverage = !result.expectedProviders.length ? "unknown" : result.providers.length === result.expectedProviders.length ? "full" : result.providers.length ? "partial" : "unknown";
        application.coverageReason = result.errors.length ? "One or more applicable advisory sources could not be queried." : result.missingProviders.length ? `${result.missingProviders.join(", ")} has not been evaluated for this version.` : !result.expectedProviders.length ? "No reliable advisory package, product, or vendor source is established." : null;
        for (const match of result.matches) {
          const finding = findingFromMatch({ match, repository: repositoryId, packageId: application.packageId, artifactId: null, applicationId: application.id, component: application.component, flavor: application.flavors.join(", ") || null, category: "application", affectedPackage: application.name, installedVersion: application.version, vulnerabilities, previous: oldFindings, now });
          findings.push(finding);
          application.findingIds.push(finding.id);
        }
        application.fixedVersion = result.matches.map((match) => match.fixedVersion).filter((value): value is string => Boolean(value)).sort().at(0) ?? null;
      });
      for (const artifact of repository.artifacts) {
        const application = repository.applications.find((candidate) => candidate.id === artifact.applicationId);
        artifact.securityCoverage.application = application?.coverage ?? "unknown";
        if (application && application.coverage !== "unknown") artifact.securityCoverage.sources.push(...application.advisorySources);
      }
      setStage(repository, "application-advisories", repository.applications.some((application) => application.coverage !== "full") ? "limited" : "complete");
      this.checkpoint(repository);

      setStage(repository, "images", "running");
      setStage(repository, "sboms", "running");
      let repoSbomsPromise: Promise<SecuritySbomDocument[]> | null = null;
      const repositoryDocuments = () => repoSbomsPromise ??= repositorySboms(source);
      const registryData = await discoverDefenseUnicornsRegistryData(repositoryId).catch(() => ({ inventories: new Map(), advisories: new Map() }));
      const inventories = (await mapLimit(repository.artifacts, 4, async (artifact): Promise<ArtifactInventory | null> => {
        const image = parseImageReference(artifact.imageReference);
        const registryInventory = registryData.inventories.get(artifact.imageReference.toLowerCase());
        try {
          const resolved = await resolveImageManifest(image);
          artifact.digest = resolved.digest;
          artifact.securityCoverage.sources.push("OCI manifest");
          const cacheKey = inventoryKey(artifact, resolved.digest);
          const cached = this.store.digestInventories[cacheKey];
          const negativeAt = this.store.negativeInventories[cacheKey];
          const negativeFresh = Boolean(negativeAt && Date.now() - new Date(negativeAt).getTime() < SECURITY_TTL);
          let parsed: ParsedSbom | null = cached && Date.now() - new Date(cached.fetchedAt).getTime() < INVENTORY_TTL ? { format: cached.format, packages: cached.packages } : null;
          let sourceName = cached?.source ?? null;
          let associatedDigest = cached?.associatedDigest ?? resolved.digest;
          if (!parsed && !negativeFresh) {
            const remoteSbom = await resolveSecuritySbom({ repositoryId, artifact, image, digest: resolved.digest, repositoryDocuments }, SBOM_RESOLVERS);
            if (remoteSbom) {
              parsed = remoteSbom.parsed;
              sourceName = remoteSbom.source;
              associatedDigest = remoteSbom.associatedDigest;
            }
          }
          if (!parsed && registryInventory) {
            parsed = registryInventory.parsed;
            sourceName = registryInventory.source;
            associatedDigest = resolved.digest;
          }
          if (!parsed || !sourceName) {
            this.store.negativeInventories[cacheKey] = now;
            artifact.securityCoverage.container = "unavailable";
            artifact.securityCoverage.reason = "No remotely accessible SBOM or dependency inventory was found for this image.";
            artifact.resolutionError = null;
            artifact.lastAnalyzedAt = now;
            return null;
          }
          this.store.digestInventories[cacheKey] = { ...parsed, source: sourceName, associatedDigest, fetchedAt: now };
          delete this.store.negativeInventories[cacheKey];
          const queryable = parsed.packages.filter((item) => item.version && (item.purl || item.ecosystem));
          artifact.securityCoverage.container = queryable.length === parsed.packages.length && parsed.packages.length > 0 ? "full" : "partial";
          artifact.securityCoverage.sources.push(sourceName, ...(registryData.advisories.has(artifact.imageReference.toLowerCase()) ? [] : ["OSV"]));
          artifact.securityCoverage.reason = artifact.securityCoverage.container === "partial" ? `${parsed.packages.length - queryable.length} packages lacked identifiers supported by remote advisory lookup.` : undefined;
          artifact.sbom = { available: true, source: sourceName, format: parsed.format, packageCount: parsed.packages.length, associatedDigest };
          artifact.lastAnalyzedAt = now;
          return { artifactId: artifact.id, parsed, source: sourceName, associatedDigest };
        } catch (error) {
          const repositoryInventory = registryInventory ? null : await repositoryDocuments().then((documents) => resolveRepositoryDocumentSbom(artifact, documents, null)).catch(() => null);
          const fallbackInventory = registryInventory ?? repositoryInventory;
          if (fallbackInventory) {
            artifact.securityCoverage.container = "partial";
            artifact.securityCoverage.sources.push(fallbackInventory.source);
            artifact.securityCoverage.reason = "A remote Zarf package published an inventory for this exact image reference, but Scout could not independently resolve its digest.";
            artifact.resolutionError = error instanceof Error ? error.message : "Container digest is unavailable.";
            artifact.sbom = { available: true, source: fallbackInventory.source, format: fallbackInventory.parsed.format, packageCount: fallbackInventory.parsed.packages.length, associatedDigest: null };
            artifact.lastAnalyzedAt = now;
            return { artifactId: artifact.id, parsed: fallbackInventory.parsed, source: fallbackInventory.source, associatedDigest: null };
          }
          artifact.securityCoverage.container = "unavailable";
          artifact.securityCoverage.reason = "Scout could not resolve this image or retrieve a remotely available dependency inventory.";
          artifact.resolutionError = error instanceof Error ? error.message : "Container metadata is unavailable.";
          artifact.lastAnalyzedAt = now;
          return null;
        }
      })).filter((item): item is ArtifactInventory => Boolean(item));
      setStage(repository, "images", repository.artifacts.some((artifact) => !artifact.digest) ? "limited" : "complete", `${repository.artifacts.filter((artifact) => artifact.digest).length} of ${repository.artifacts.length} resolved`);
      setStage(repository, "sboms", inventories.length === repository.artifacts.length ? "complete" : "limited", `${inventories.length} of ${repository.artifacts.length} images have an associated SBOM`);
      this.checkpoint(repository);

      setStage(repository, "dependencies", "running");
      const uniquePackages = [...new Map(inventories.flatMap((inventory) => {
        const artifact = repository.artifacts.find((candidate) => candidate.id === inventory.artifactId);
        return artifact && registryData.advisories.has(artifact.imageReference.toLowerCase()) ? [] : inventory.parsed.packages;
      }).map((item) => [packageKey(item), item])).values()];
      let packageMatches = new Map<string, AdvisoryMatch[]>();
      let dependencyLookupError: string | null = null;
      if (uniquePackages.length) {
        try {
          const results = await queryOsvPackages(uniquePackages);
          packageMatches = new Map(results.map((result) => [packageKey(result.package), result.matches]));
        } catch (error) {
          dependencyLookupError = error instanceof Error ? error.message : "OSV dependency lookup failed.";
          repository.artifacts.filter((artifact) => artifact.sbom.available).forEach((artifact) => {
            artifact.securityCoverage.container = "partial";
            artifact.securityCoverage.reason = "An SBOM was found, but remote vulnerability matching could not be completed.";
          });
        }
      }
      for (const inventory of inventories) {
        const artifact = repository.artifacts.find((candidate) => candidate.id === inventory.artifactId)!;
        const registryMatches = registryData.advisories.get(artifact.imageReference.toLowerCase()) ?? [];
        for (const packageItem of inventory.parsed.packages) {
          for (const match of registryMatches.length ? [] : packageMatches.get(packageKey(packageItem)) ?? []) {
            const finding = findingFromMatch({ match, repository: repositoryId, packageId: artifact.packageId, artifactId: artifact.id, applicationId: artifact.applicationId, component: artifact.componentName, flavor: artifact.flavor, category: containerFindingCategory(packageItem), affectedPackage: packageItem.name, installedVersion: packageItem.version, vulnerabilities, previous: oldFindings, now });
            findings.push(finding);
            artifact.findingIds.push(finding.id);
          }
        }
        if (registryMatches.length) artifact.securityCoverage.sources.push("Defense Unicorns Registry");
        for (const registryMatch of registryMatches) {
          const finding = findingFromMatch({ match: registryMatch.match, repository: repositoryId, packageId: artifact.packageId, artifactId: artifact.id, applicationId: artifact.applicationId, component: artifact.componentName, flavor: artifact.flavor, category: registryMatch.category, affectedPackage: registryMatch.affectedPackage, installedVersion: registryMatch.installedVersion, vulnerabilities, previous: oldFindings, now });
          findings.push(finding);
          artifact.findingIds.push(finding.id);
        }
      }
      const registryMatchCount = repository.artifacts.reduce((total, artifact) => total + (registryData.advisories.get(artifact.imageReference.toLowerCase())?.length ?? 0), 0);
      setStage(repository, "dependencies", dependencyLookupError || repository.artifacts.some((artifact) => artifact.securityCoverage.container !== "full") ? "limited" : "complete", dependencyLookupError ?? (registryMatchCount ? `${registryMatchCount} registry vulnerability records evaluated` : `${uniquePackages.length} unique packages evaluated`));

      const normalizedFindings = deduplicateFindings(findings);
      repository.applications.forEach((application) => { application.findingIds = [...new Set(application.findingIds)]; });
      repository.artifacts.forEach((artifact) => { artifact.findingIds = [...new Set(artifact.findingIds)]; artifact.securityCoverage.sources = [...new Set(artifact.securityCoverage.sources)]; });
      repository.vulnerabilities = vulnerabilities;
      repository.findings = normalizedFindings;
      repository.counts = countsFor(normalizedFindings);
      repository.coverage = {
        applicationsIdentified: repository.applications.filter((application) => application.confidence !== "unknown").length,
        applicationsTotal: repository.applications.length,
        containerImages: repository.artifacts.length,
        fullContainerCoverage: repository.artifacts.filter((artifact) => artifact.securityCoverage.container === "full").length,
        partialContainerCoverage: repository.artifacts.filter((artifact) => artifact.securityCoverage.container === "partial").length,
        unavailableContainerCoverage: repository.artifacts.filter((artifact) => artifact.securityCoverage.container === "unavailable").length,
      };
      repository.state = "ready";
      repository.stale = false;
      repository.analyzedAt = now;
      this.store.repositoryAnalysisVersions[key] = SECURITY_ANALYSIS_VERSION;
      this.checkpoint(repository);
    } catch (error) {
      repository.state = "error";
      repository.error = error instanceof Error ? error.message : "Security enrichment failed.";
      repository.stale = true;
      repository.stages = repository.stages.map((stage) => stage.state === "running" ? { ...stage, state: "error", detail: repository.error ?? undefined } : stage);
      this.checkpoint(repository);
    }
  }
}

const SERVICE_IMPLEMENTATION_VERSION = 21;
const runtimeState = globalThis as typeof globalThis & { __udsScoutSecurityService?: SecurityRefreshService; __udsScoutSecurityServiceVersion?: number };

export function securityRefreshService() {
  if (!runtimeState.__udsScoutSecurityService || runtimeState.__udsScoutSecurityServiceVersion !== SERVICE_IMPLEMENTATION_VERSION) {
    runtimeState.__udsScoutSecurityService = new SecurityRefreshService();
    runtimeState.__udsScoutSecurityServiceVersion = SERVICE_IMPLEMENTATION_VERSION;
  }
  return runtimeState.__udsScoutSecurityService;
}

