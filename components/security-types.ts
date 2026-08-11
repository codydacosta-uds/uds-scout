export type SecuritySeverity = "critical" | "high" | "medium" | "low" | "unknown";
export type ApplicationCoverage = "full" | "partial" | "unknown";
export type ContainerCoverage = "full" | "partial" | "unavailable";
export type ApplicationIdentificationConfidence = "identified" | "probable" | "unknown";
export type ApplicationExposure = "external" | "internal" | "unknown";
export type SecurityFindingCategory = "application" | "container-os" | "container-language" | "container-other";
export type SecurityRefreshState = "pending" | "queued" | "refreshing" | "ready" | "error";

export type SecurityRefreshStage = {
  id: "packages" | "applications" | "application-advisories" | "images" | "sboms" | "dependencies";
  label: string;
  state: "pending" | "running" | "complete" | "limited" | "error";
  detail?: string;
};

export type SecurityCoverage = {
  application: ApplicationCoverage;
  container: ContainerCoverage;
  sources: string[];
  reason?: string;
};

export type ZarfChart = {
  name: string;
  version: string | null;
  url: string | null;
  localPath: string | null;
};

export type ZarfComponent = {
  id: string;
  name: string;
  flavor: string | null;
  packageId: string;
  charts: ZarfChart[];
  imageReferences: string[];
};

export type ZarfPackage = {
  id: string;
  name: string;
  description: string | null;
  version: string | null;
  sourcePath: string;
  sourceUrl: string;
  upstreamUrl: string | null;
  components: ZarfComponent[];
};

export type SecurityApplication = {
  id: string;
  name: string;
  version: string | null;
  upstreamRepository: string | null;
  purl: string | null;
  cpe: string | null;
  confidence: ApplicationIdentificationConfidence;
  packageId: string;
  packageName: string;
  component: string;
  flavors: string[];
  artifactIds: string[];
  coverage: ApplicationCoverage;
  coverageReason: string | null;
  advisorySources: string[];
  expectedAdvisorySources: string[];
  advisoryCheckedAt: string | null;
  exposure: ApplicationExposure;
  exposureReason: string | null;
  findingIds: string[];
  fixedVersion: string | null;
};

export type SBOMPackage = {
  name: string;
  version: string | null;
  ecosystem: string | null;
  purl: string | null;
  cpe: string | null;
  type: string | null;
  supplier: string | null;
};

export type ContainerArtifact = {
  id: string;
  repositoryId: string;
  packageId: string;
  zarfPackageName: string;
  componentName: string;
  flavor: string | null;
  imageReference: string;
  registry: string;
  imageRepository: string;
  tag: string | null;
  digest: string | null;
  applicationId: string | null;
  applicationName: string | null;
  applicationVersion: string | null;
  upstreamRepository: string | null;
  applicationIdentificationConfidence: ApplicationIdentificationConfidence;
  securityCoverage: SecurityCoverage;
  sbom: {
    available: boolean;
    source: string | null;
    format: "spdx" | "cyclonedx" | "syft" | null;
    packageCount: number | null;
    associatedDigest: string | null;
  };
  findingIds: string[];
  resolutionError: string | null;
  lastAnalyzedAt: string | null;
};

export type Vulnerability = {
  id: string;
  aliases: string[];
  summary: string;
  description: string | null;
  severity: SecuritySeverity;
  cvss: number | null;
  publishedAt: string | null;
  modifiedAt: string | null;
  references: string[];
  providers: string[];
};

export type SecurityFinding = {
  id: string;
  vulnerabilityId: string;
  repositoryId: string;
  packageId: string;
  artifactId: string | null;
  applicationId: string | null;
  component: string;
  flavor: string | null;
  category: SecurityFindingCategory;
  affectedPackage: string;
  installedVersion: string | null;
  affectedVersion: string | null;
  fixedVersion: string | null;
  severity: SecuritySeverity;
  sources: string[];
  status: "open" | "fixed" | "unknown";
  firstSeenAt: string;
  lastSeenAt: string;
};

export type SecurityCounts = {
  total: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  unknown: number;
  application: number;
  container: number;
  fixAvailable: number;
};

export type RepositorySecurity = {
  repositoryId: string;
  revision: string | null;
  applicable: boolean | null;
  state: SecurityRefreshState;
  stale: boolean;
  error: string | null;
  stages: SecurityRefreshStage[];
  packages: ZarfPackage[];
  applications: SecurityApplication[];
  artifacts: ContainerArtifact[];
  vulnerabilities: Record<string, Vulnerability>;
  findings: SecurityFinding[];
  counts: SecurityCounts;
  coverage: {
    applicationsIdentified: number;
    applicationsTotal: number;
    containerImages: number;
    fullContainerCoverage: number;
    partialContainerCoverage: number;
    unavailableContainerCoverage: number;
  };
  analyzedAt: string | null;
  refreshStartedAt: string | null;
};

export type SecurityWorkspace = {
  repositories: RepositorySecurity[];
  summary: {
    repositories: number;
    applicableRepositories: number;
    applications: number;
    containerImages: number;
    counts: SecurityCounts;
    repositoriesRequiringAttention: number;
    coverage: {
      full: number;
      partial: number;
      unavailable: number;
    };
  };
  refreshing: boolean;
  generatedAt: string;
};
