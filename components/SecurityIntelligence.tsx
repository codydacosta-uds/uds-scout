"use client";

import Badge from "@cloudscape-design/components/badge";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Container from "@cloudscape-design/components/container";
import ContentLayout from "@cloudscape-design/components/content-layout";
import Flashbar from "@cloudscape-design/components/flashbar";
import ExpandableSection from "@cloudscape-design/components/expandable-section";
import Header from "@cloudscape-design/components/header";
import KeyValuePairs from "@cloudscape-design/components/key-value-pairs";
import Link from "@cloudscape-design/components/link";
import Pagination from "@cloudscape-design/components/pagination";
import Select from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Spinner from "@cloudscape-design/components/spinner";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import Table from "@cloudscape-design/components/table";
import { useMemo, useState } from "react";
import { InfoPopover } from "./info-ui";
import type { DrawerSelection } from "./operations-types";
import { EmptyState, relativeTime } from "./operations-ui";
import type { RepositorySecurity, SecurityFinding, SecuritySeverity, SecurityWorkspace, Vulnerability } from "./security-types";
import type { Overview, PullRequest, Repository, RepositoryRelease } from "./types";

function severityBadge(value: SecuritySeverity) {
  if (value === "critical") return <Badge color="red">Critical</Badge>;
  if (value === "high") return <Badge color="severity-high">High</Badge>;
  if (value === "medium") return <Badge color="severity-medium">Medium</Badge>;
  if (value === "low") return <Badge color="grey">Low</Badge>;
  return <Badge color="grey">Unknown</Badge>;
}

function hasSecurityCoverage(item: RepositorySecurity) {
  return item.applications.some((application) => application.coverage !== "unknown")
    || item.artifacts.some((artifact) => artifact.securityCoverage.container !== "unavailable");
}

function hasCompleteSecurityCoverage(item: RepositorySecurity) {
  return item.applications.every((application) => application.coverage === "full")
    && item.artifacts.every((artifact) => artifact.securityCoverage.container === "full");
}

function posture(item: RepositorySecurity) {
  if (item.counts.critical) return <StatusIndicator type="error">Critical</StatusIndicator>;
  if (item.counts.high) return <StatusIndicator type="warning">High</StatusIndicator>;
  if (item.counts.medium) return <StatusIndicator type="warning">Medium</StatusIndicator>;
  if (item.state === "error") return <StatusIndicator type="error">Analysis failed</StatusIndicator>;
  if (item.state === "pending" || item.state === "queued" || item.state === "refreshing") return <StatusIndicator type="in-progress">Analyzing</StatusIndicator>;
  if (!item.applicable) return <StatusIndicator type="stopped">Not applicable</StatusIndicator>;
  if (!hasSecurityCoverage(item)) return <StatusIndicator type="pending">Visibility unavailable</StatusIndicator>;
  if (!hasCompleteSecurityCoverage(item)) return <StatusIndicator type="pending">Visibility limited</StatusIndicator>;
  return <StatusIndicator type="success">No known Critical or High findings</StatusIndicator>;
}

function containerCoverage(item: RepositorySecurity) {
  if (!item.artifacts.length) return <Box color="text-body-secondary">No images discovered</Box>;
  const evaluated = item.coverage.fullContainerCoverage + item.coverage.partialContainerCoverage;
  if (!evaluated) return <StatusIndicator type="pending">Unavailable for all {item.coverage.containerImages}</StatusIndicator>;
  if (item.coverage.unavailableContainerCoverage || item.coverage.partialContainerCoverage) return <SpaceBetween size="xxs"><StatusIndicator type="warning">{evaluated} evaluated</StatusIndicator><Box color="text-body-secondary">{item.coverage.unavailableContainerCoverage} unavailable</Box></SpaceBetween>;
  return <StatusIndicator type="success">Full for {item.coverage.fullContainerCoverage}</StatusIndicator>;
}

function analysisProgress(item: RepositorySecurity) {
  if (item.state !== "queued" && item.state !== "refreshing") return null;
  return (
    <Container header={<Header variant="h3">Security enrichment in progress</Header>}>
      <div className="security-stage-list">
        {item.stages.map((stage) => (
          <StatusIndicator key={stage.id} type={stage.state === "complete" ? "success" : stage.state === "running" ? "in-progress" : stage.state === "error" ? "error" : stage.state === "limited" ? "warning" : "pending"}>
            {stage.label}{stage.detail ? ` · ${stage.detail}` : ""}
          </StatusIndicator>
        ))}
      </div>
    </Container>
  );
}

function normalizedVersion(value: string) {
  return value.toLowerCase().replace(/^v/, "").replace(/-(?:fips|distroless).*$/, "");
}

function relatedUpdate(finding: SecurityFinding, vulnerability: Vulnerability | undefined, pulls: PullRequest[]) {
  if (!finding.fixedVersion) return null;
  const fixed = normalizedVersion(finding.fixedVersion);
  const packageTokens = [finding.affectedPackage, vulnerability?.id, ...(vulnerability?.aliases ?? [])].filter(Boolean).map((value) => value!.toLowerCase());
  return pulls.find((pull) => {
    const text = `${pull.title}\n${pull.body ?? ""}\n${pull.head}`.toLowerCase();
    return text.includes(fixed) && packageTokens.some((token) => text.includes(token));
  }) ?? null;
}

function managementContext(finding: SecurityFinding, vulnerability: Vulnerability | undefined, pulls: PullRequest[], openDrawer: (selection: DrawerSelection) => void) {
  if (!finding.fixedVersion) return <Box color="text-body-secondary">No fixed version is reported by the advisory source.</Box>;
  const pull = relatedUpdate(finding, vulnerability, pulls);
  if (!pull) return <StatusIndicator type="warning">No matching open update PR was found</StatusIndicator>;
  const state = pull.workflow.checks.rollup.failing || pull.workflow.checks.rollup.cancelled
    ? <StatusIndicator type="error">Related update is blocked by checks</StatusIndicator>
    : pull.workflow.checks.rollup.pending
      ? <StatusIndicator type="in-progress">Related update checks are running</StatusIndicator>
      : pull.workflow.state === "ready-to-merge"
        ? <StatusIndicator type="success">Related update is ready to merge</StatusIndicator>
        : <StatusIndicator type="info">Related update is {pull.workflow.label.toLowerCase()}</StatusIndicator>;
  return <SpaceBetween size="xxs">{state}<Button variant="inline-link" onClick={() => openDrawer({ type: "pull-request", pull, repository: pull.repository })}>Open PR #{pull.number}</Button></SpaceBetween>;
}

function findingDrawerSelection(finding: SecurityFinding, security: RepositorySecurity, pulls: PullRequest[]): DrawerSelection {
  const vulnerability = security.vulnerabilities[finding.vulnerabilityId] ?? {
    id: finding.vulnerabilityId,
    aliases: [],
    summary: finding.vulnerabilityId,
    description: null,
    severity: finding.severity,
    cvss: null,
    publishedAt: null,
    modifiedAt: null,
    references: [],
    providers: finding.sources,
  };
  const application = finding.applicationId ? security.applications.find((candidate) => candidate.id === finding.applicationId) : null;
  return {
    type: "security-finding",
    repository: finding.repositoryId,
    finding,
    vulnerability,
    occurrences: security.findings.filter((candidate) => candidate.vulnerabilityId === finding.vulnerabilityId),
    exposure: application?.exposure,
    pull: relatedUpdate(finding, vulnerability, pulls),
  };
}

function releaseFlavor(tag: string) {
  return tag.match(/-(upstream|registry1|unicorn)$/i)?.[1].toLowerCase() ?? "default";
}

function numericReleaseVersion(value: string | null) {
  const match = value?.replace(/^v/i, "").match(/^(\d+)\.(\d+)(?:\.(\d+))?/);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)] : null;
}

function versionComparison(current: string | null, latest: string) {
  const left = numericReleaseVersion(current);
  const right = numericReleaseVersion(latest);
  if (!left || !right) return "unknown" as const;
  for (let index = 0; index < 3; index += 1) {
    if (left[index] < right[index]) return "behind" as const;
    if (left[index] > right[index]) return "ahead" as const;
  }
  return "current" as const;
}

export function RepositoryVersionPanel({ security, releases, generatedAt, openSecurity }: {
  security: RepositorySecurity | null;
  releases: RepositoryRelease[];
  generatedAt: string;
  openSecurity: () => void;
}) {
  const [requestedPage, setRequestedPage] = useState(1);
  const publishedReleases = releases.filter((release) => !release.prerelease);
  const latestRelease = publishedReleases.find((release) => releaseFlavor(release.tag) === "upstream") ?? publishedReleases.find((release) => releaseFlavor(release.tag) === "registry1") ?? publishedReleases[0];
  const applications = (security?.applications ?? []).filter((application) => application.version && application.confidence !== "unknown");
  const primaryVersionScores = new Map<string, Map<string, number>>();
  for (const application of applications) for (const flavor of application.flavors.length ? application.flavors : ["default"]) {
    const scores = primaryVersionScores.get(flavor) ?? new Map<string, number>();
    scores.set(application.version!, (scores.get(application.version!) ?? 0) + Math.max(1, application.artifactIds.length));
    primaryVersionScores.set(flavor, scores);
  }
  const primaryVersion = new Map([...primaryVersionScores].map(([flavor, scores]) => [flavor, [...scores].sort((left, right) => right[1] - left[1])[0]?.[0] ?? null]));
  const pageCount = Math.max(1, Math.ceil(applications.length / 5));
  const currentPage = Math.min(requestedPage, pageCount);
  const visibleApplications = applications.slice((currentPage - 1) * 5, currentPage * 5);
  if (!latestRelease && !applications.length) return null;
  return (
    <Container header={<Header variant="h2" description="Default-branch application versions, package releases, and direct advisories." info={<InfoPopover header="Application version correlation">Scout identifies versions from Zarf package metadata and image references. Application advisory coverage is separate from dependency findings found inside container images.</InfoPopover>}>Release and application versions</Header>}>
      <SpaceBetween size="m">
        <KeyValuePairs columns={3} items={[
          { label: "Latest package release", value: latestRelease ? <Link href={latestRelease.url} external>{latestRelease.tag}</Link> : <Box color="text-body-secondary">No release published</Box> },
          { label: "Published", value: latestRelease?.publishedAt ? relativeTime(latestRelease.publishedAt, generatedAt) : <Box color="text-body-secondary">Not reported</Box> },
          { label: "Application security", value: security?.counts.application ? <Button variant="inline-link" onClick={openSecurity}>{security.counts.application} direct application finding occurrences</Button> : security?.applications.length && security.applications.every((application) => application.coverage === "full") ? <Button variant="inline-link" onClick={openSecurity}>No known direct application CVEs</Button> : security?.applications.some((application) => application.coverage !== "unknown") ? <Button variant="inline-link" onClick={openSecurity}>Vendor coverage incomplete</Button> : <Button variant="inline-link" onClick={openSecurity}>Application coverage not established</Button> },
        ]} />
        <Table
          variant="embedded" trackBy="id" items={visibleApplications}
          pagination={pageCount > 1 ? <Pagination currentPageIndex={currentPage} pagesCount={pageCount} onChange={({ detail }) => setRequestedPage(detail.currentPageIndex)} /> : undefined}
          header={<Header variant="h3" counter={`(${applications.length})`}>Versions used by this repository</Header>}
          columnDefinitions={[
            { id: "application", header: "Application version", cell: (item) => <SpaceBetween size="xxs"><Box variant="strong">{item.name}</Box><Box variant="code">{item.version}</Box><Box color="text-body-secondary">{item.component}</Box></SpaceBetween> },
            { id: "flavors", header: "Flavors", cell: (item) => item.flavors.length ? item.flavors.join(", ") : "default" },
            { id: "release", header: "Package release", cell: (item) => { const flavors = (item.flavors.length ? item.flavors : ["default"]).filter((flavor) => primaryVersion.get(flavor) === item.version); const matches = flavors.flatMap((flavor) => publishedReleases.find((release) => releaseFlavor(release.tag) === flavor) ?? []).filter((release, index, values) => values.findIndex((candidate) => candidate.id === release.id) === index); const flavor = item.flavors.find((value) => value === "upstream") ?? item.flavors.find((value) => value === "registry1") ?? item.flavors[0] ?? "default"; const release = publishedReleases.find((candidate) => releaseFlavor(candidate.tag) === flavor); const comparison = primaryVersion.get(flavor) === item.version && release ? versionComparison(item.version, release.tag) : "supporting"; return <SpaceBetween size="xxs">{matches.length ? matches.map((match) => <Link key={match.id} href={match.url} external>{match.tag}</Link>) : <Box color="text-body-secondary">Managed with package</Box>}{comparison === "current" ? <StatusIndicator type="success">Current release family</StatusIndicator> : comparison === "behind" ? <StatusIndicator type="warning">Newer release available</StatusIndicator> : comparison === "ahead" ? <StatusIndicator type="info">Ahead of latest release</StatusIndicator> : comparison === "supporting" ? <StatusIndicator type="info">Supporting component</StatusIndicator> : <StatusIndicator type="pending">Unable to compare</StatusIndicator>}</SpaceBetween>; } },
            { id: "security", header: "Application security", cell: (item) => item.findingIds.length ? <Button variant="inline-link" onClick={openSecurity}>{item.findingIds.length} direct CVE occurrences</Button> : item.coverage === "unknown" ? <Box color="text-body-secondary">Not established</Box> : item.coverage === "partial" ? <Box color="text-body-secondary">Vendor coverage incomplete</Box> : <Box>No known direct CVEs</Box> },
          ]}
          empty={<EmptyState title={security?.state === "refreshing" || security?.state === "queued" ? "Application versions are being analyzed" : "No application version identified"} detail="Scout needs a versioned application identity in the repository's Zarf metadata." />}
        />
        {security?.analyzedAt ? <Box color="text-body-secondary">Application versions and security context last checked {relativeTime(security.analyzedAt, generatedAt)}.</Box> : null}
      </SpaceBetween>
    </Container>
  );
}

const FINDING_FILTERS = [
  { label: "Decision-relevant", value: "priority" },
  { label: "All findings", value: "all" },
  { label: "Application", value: "application" },
  { label: "Container", value: "container" },
  { label: "Critical", value: "critical" },
  { label: "High", value: "high" },
  { label: "Medium", value: "medium" },
  { label: "Fix available", value: "fix" },
];

export function RepositorySecurityPanel({ security, repository, overview, openDrawer }: {
  security: RepositorySecurity | null;
  repository: Repository;
  overview: Overview;
  openDrawer: (selection: DrawerSelection) => void;
}) {
  const [filter, setFilter] = useState("priority");
  const [findingsPage, setFindingsPage] = useState(1);
  const pulls = overview.pullRequests.filter((pull) => pull.repository === repository.fullName);
  const flavorCoverage = useMemo(() => {
    const groups = new Map<string, { flavor: string; total: number; full: number; partial: number; unavailable: number; sboms: number; findings: number }>();
    for (const artifact of security?.artifacts ?? []) {
      const flavor = artifact.flavor ?? "default";
      const group = groups.get(flavor) ?? { flavor, total: 0, full: 0, partial: 0, unavailable: 0, sboms: 0, findings: 0 };
      group.total += 1;
      group[artifact.securityCoverage.container] += 1;
      if (artifact.sbom.available) group.sboms += 1;
      group.findings += artifact.findingIds.length;
      groups.set(flavor, group);
    }
    const order = new Map([["upstream", 0], ["registry1", 1], ["default", 2], ["unicorn", 3]]);
    return [...groups.values()].sort((left, right) => (order.get(left.flavor) ?? 2) - (order.get(right.flavor) ?? 2) || left.flavor.localeCompare(right.flavor));
  }, [security?.artifacts]);
  const findings = useMemo(() => (security?.findings ?? []).filter((finding) => {
    if (filter === "priority") return finding.category === "application" || finding.severity === "critical" || finding.severity === "high";
    if (filter === "application") return finding.category === "application";
    if (filter === "container") return finding.category !== "application";
    if (filter === "fix") return Boolean(finding.fixedVersion);
    if (["critical", "high", "medium"].includes(filter)) return finding.severity === filter;
    return true;
  }), [filter, security?.findings]);
  const findingsPageCount = Math.max(1, Math.ceil(findings.length / 25));
  const currentFindingsPage = Math.min(findingsPage, findingsPageCount);
  const visibleFindings = findings.slice((currentFindingsPage - 1) * 25, currentFindingsPage * 25);
  const directApplicationFindings = (security?.findings ?? []).filter((finding) => finding.category === "application");
  const directApplicationCves = new Set(directApplicationFindings.map((finding) => finding.vulnerabilityId));
  const affectedApplicationVersions = new Set(directApplicationFindings.map((finding) => finding.applicationId).filter(Boolean));
  const evaluatedImages = (security?.coverage.fullContainerCoverage ?? 0) + (security?.coverage.partialContainerCoverage ?? 0);
  const severeContainerFindings = (security?.findings ?? []).filter((finding) => finding.category !== "application" && (finding.severity === "critical" || finding.severity === "high")).length;

  if (!security) return <Container><Box textAlign="center"><Spinner /> Loading cached security intelligence</Box></Container>;
  if (security.applicable === false) return <Container><EmptyState title="No Zarf packages discovered" detail="Scout found no valid ZarfPackageConfig definitions in this repository. Repository operations remain available normally." /></Container>;

  return (
    <SpaceBetween size="l">
      {security.error ? <Flashbar items={[{ type: "warning", header: "Security intelligence could not be refreshed", content: `${security.error} Cached findings remain visible when available.` }]} /> : null}
      {analysisProgress(security)}
      <Container header={<Header variant="h2" description="Current application action and high-priority dependency context." info={<InfoPopover header="Security decision">Direct application CVEs affect the deployed product version and are prioritized here. Container findings come from dependency inventories and remain separate. Finding totals may include the same CVE in multiple package or flavor contexts.</InfoPopover>}>Security decision</Header>}>
        <KeyValuePairs columns={4} items={[
          { label: "Overall", value: posture(security) },
          { label: "Application versions requiring action", value: affectedApplicationVersions.size },
          { label: "Direct application CVEs", value: directApplicationCves.size || (security.applications.some((application) => application.coverage !== "unknown") ? 0 : <Box color="text-body-secondary">Not established</Box>) },
          { label: "Critical / High container findings", value: severeContainerFindings || (evaluatedImages === security.coverage.containerImages ? 0 : <Box color="text-body-secondary">Not established</Box>) },
          { label: "Application versions checked", value: `${security.applications.filter((application) => application.coverage !== "unknown").length} / ${security.coverage.applicationsTotal}` },
          { label: "Container images evaluated", value: `${evaluatedImages} / ${security.coverage.containerImages}` },
          { label: "Last checked", value: security.analyzedAt ? relativeTime(security.analyzedAt, new Date().toISOString()) : <Box color="text-body-secondary">Not analyzed</Box> },
        ]} />
      </Container>
      <Table
        variant="container" trackBy="id" items={security.applications}
        header={<Header variant="h2" counter={`(${security.applications.length})`} description="Affected versions and the next maintainer action." info={<InfoPopover header="Application advisory coverage">Checked sources are shown for each version. Missing vendor coverage remains explicit and must not be interpreted as zero vulnerabilities.</InfoPopover>}>Application security decisions</Header>}
        columnDefinitions={[
          { id: "application", header: "Application version", cell: (item) => <SpaceBetween size="xxs"><Box variant="strong">{item.name} {item.version ?? "version unknown"}</Box><Box color="text-body-secondary">{item.flavors.length ? item.flavors.join(", ") : item.component}</Box></SpaceBetween> },
          { id: "decision", header: "Decision", cell: (item) => { const appFindings = security.findings.filter((finding) => item.findingIds.includes(finding.id)); const critical = appFindings.filter((finding) => finding.severity === "critical").length; const high = appFindings.filter((finding) => finding.severity === "high").length; const level: SecuritySeverity = critical ? "critical" : high ? "high" : appFindings.some((finding) => finding.severity === "medium") ? "medium" : appFindings.some((finding) => finding.severity === "low") ? "low" : "unknown"; if (item.coverage === "unknown") return <SpaceBetween size="xxs"><StatusIndicator type="pending">Application advisory coverage not established</StatusIndicator><Box color="text-body-secondary">{item.coverageReason}</Box></SpaceBetween>; if (!appFindings.length) return item.coverage === "partial" ? <SpaceBetween size="xxs"><StatusIndicator type="warning">No direct CVEs found in checked sources</StatusIndicator><Box color="text-body-secondary">{item.coverageReason}</Box><Box color="text-body-secondary">Checked {item.advisorySources.join(", ")}</Box></SpaceBetween> : <SpaceBetween size="xxs"><StatusIndicator type="success">No known direct application CVEs</StatusIndicator><Box color="text-body-secondary">Checked {item.advisorySources.join(", ")}</Box></SpaceBetween>; return <SpaceBetween size="xxs">{severityBadge(level)}<Box>{appFindings.length} direct CVEs affect this version</Box><Box>{appFindings.map((finding, index) => { const vulnerability = security.vulnerabilities[finding.vulnerabilityId]; return <span key={finding.id}>{index ? " · " : ""}<Button variant="inline-link" onClick={() => openDrawer(findingDrawerSelection(finding, security, pulls))}>{vulnerability?.id ?? finding.vulnerabilityId}</Button></span>; })}</Box><Box color="text-body-secondary">{critical} Critical · {high} High · Exposure {item.exposure ?? "unknown"}</Box><Box color="text-body-secondary">Checked {item.advisorySources.join(", ")}</Box></SpaceBetween>; } },
          { id: "action", header: "Required action", cell: (item) => { const appFindings = security.findings.filter((finding) => item.findingIds.includes(finding.id)); if (!appFindings.length) return item.coverage === "unknown" ? <StatusIndicator type="pending">Check the upstream advisory source before treating this version as clear</StatusIndicator> : item.coverage === "partial" ? <StatusIndicator type="warning">Check the missing vendor source before treating this version as clear</StatusIndicator> : <Box color="text-body-secondary">No application update required from checked advisories.</Box>; const representative = [...appFindings].sort((left, right) => ["critical", "high", "medium", "low", "unknown"].indexOf(left.severity) - ["critical", "high", "medium", "low", "unknown"].indexOf(right.severity))[0]; return <SpaceBetween size="xxs"><Box>{item.fixedVersion ? `Update to ${item.fixedVersion}` : "Review the vendor advisory; no fixed version is reported."}</Box>{managementContext(representative, security.vulnerabilities[representative.vulnerabilityId], pulls, openDrawer)}{item.expectedAdvisorySources?.length > item.advisorySources.length ? <StatusIndicator type="warning">An expected source is unavailable</StatusIndicator> : null}</SpaceBetween>; } },
        ]}
        empty={<EmptyState title="No applications identified" detail="Scout could not reliably identify a primary application from the discovered package metadata." />}
      />
      <ExpandableSection variant="container" headerText={`Container dependency evidence (${security.counts.container} findings)`}>
        <SpaceBetween size="m">
          {flavorCoverage.length > 1 ? <Table
            variant="embedded" trackBy="flavor" items={flavorCoverage}
            header={<Header variant="h3" counter={`(${flavorCoverage.length})`}>Package flavor coverage</Header>}
            columnDefinitions={[
              { id: "flavor", header: "Flavor", cell: (item) => <Box variant="strong">{item.flavor}</Box> },
              { id: "images", header: "Images evaluated", cell: (item) => `${item.full + item.partial} / ${item.total}` },
              { id: "sboms", header: "Dependency inventories", cell: (item) => `${item.sboms} / ${item.total}` },
              { id: "findings", header: "Known findings", cell: (item) => item.findings ? item.findings : item.full === item.total ? 0 : <Box color="text-body-secondary">Not established</Box> },
            ]}
          /> : null}
          <Table
        variant="embedded" trackBy="id" items={security.artifacts}
        header={<Header variant="h3" counter={`(${security.artifacts.length})`} description="Image evidence supporting the dependency finding totals.">Container images</Header>}
        columnDefinitions={[
          { id: "image", header: "Container image", cell: (item) => <SpaceBetween size="xxs"><Box variant="code">{item.imageReference}</Box><Box color="text-body-secondary">{item.digest ? item.digest.slice(0, 28) + "…" : item.resolutionError ?? "Digest unavailable"}</Box></SpaceBetween> },
          { id: "component", header: "Component / flavor", cell: (item) => `${item.componentName}${item.flavor ? ` · ${item.flavor}` : ""}` },
          { id: "sbom", header: "SBOM", cell: (item) => item.sbom.available ? <SpaceBetween size="xxs"><StatusIndicator type="success">Available</StatusIndicator><Box color="text-body-secondary">{item.sbom.source}</Box></SpaceBetween> : <StatusIndicator type="pending">Not available</StatusIndicator> },
          { id: "packages", header: "Packages evaluated", cell: (item) => item.sbom.packageCount ?? <Box color="text-body-secondary">Not evaluated</Box> },
          { id: "findings", header: "Container findings", cell: (item) => item.securityCoverage.container === "unavailable" ? <Box color="text-body-secondary">Not evaluated</Box> : <SpaceBetween size="xxs"><Box>{item.findingIds.length} known</Box><Box color="text-body-secondary">{security.findings.filter((finding) => item.findingIds.includes(finding.id) && finding.severity === "critical").length} Critical · {security.findings.filter((finding) => item.findingIds.includes(finding.id) && finding.severity === "high").length} High</Box></SpaceBetween> },
          { id: "coverage", header: "Coverage", cell: (item) => item.securityCoverage.container === "full" ? <StatusIndicator type="success">Full</StatusIndicator> : item.securityCoverage.container === "partial" ? <StatusIndicator type="warning">Partial</StatusIndicator> : <span title={item.securityCoverage.reason}><StatusIndicator type="pending">Unavailable</StatusIndicator></span> },
        ]}
        empty={<EmptyState title="No container images discovered" detail="The Zarf definitions do not declare container images directly." />}
          />
        </SpaceBetween>
      </ExpandableSection>
      <Table
        variant="container" trackBy="id" items={visibleFindings}
        pagination={findingsPageCount > 1 ? <Pagination currentPageIndex={currentFindingsPage} pagesCount={findingsPageCount} onChange={({ detail }) => setFindingsPage(detail.currentPageIndex)} /> : undefined}
        filter={<Select selectedOption={FINDING_FILTERS.find((option) => option.value === filter) ?? FINDING_FILTERS[0]} options={FINDING_FILTERS} onChange={({ detail }) => { setFilter(detail.selectedOption.value ?? "priority"); setFindingsPage(1); }} />}
        header={<Header variant="h2" counter={`(${findings.length}${security.findings.length !== findings.length ? ` of ${security.findings.length}` : ""})`} description="Application advisories and high-priority dependency evidence." info={<InfoPopover header="Decision-relevant findings">The default filter includes every direct application finding plus Critical and High container dependency findings. Use the filter to inspect lower-severity or complete dependency evidence.</InfoPopover>}>Findings requiring review</Header>}
        columnDefinitions={[
          { id: "finding", header: "Finding", cell: (item) => { const vulnerability = security.vulnerabilities[item.vulnerabilityId]; return <SpaceBetween size="xxs"><SpaceBetween direction="horizontal" size="xs"><Button variant="inline-link" onClick={() => openDrawer(findingDrawerSelection(item, security, pulls))}>{vulnerability?.id ?? item.vulnerabilityId}</Button>{severityBadge(item.severity)}</SpaceBetween><Box color="text-body-secondary">{[...(vulnerability?.aliases ?? []), vulnerability?.summary].filter(Boolean).join(" · ")}</Box><Box color="text-body-secondary">{item.sources.join(", ")}</Box></SpaceBetween>; } },
          { id: "affected", header: "Affected version", cell: (item) => <SpaceBetween size="xxs"><Box>{item.affectedPackage} {item.installedVersion ?? "version unknown"}</Box><Box color="text-body-secondary">{item.component}{item.flavor ? ` · ${item.flavor}` : ""} · {item.category.replace("container-", "container ")}</Box></SpaceBetween> },
          { id: "fix", header: "Required action", cell: (item) => <SpaceBetween size="xxs"><Box>{item.fixedVersion ? `Update to ${item.fixedVersion}` : "No fixed version reported"}</Box>{managementContext(item, security.vulnerabilities[item.vulnerabilityId], pulls, openDrawer)}</SpaceBetween> },
        ]}
        empty={<EmptyState title={security.findings.length ? "No findings match this filter" : hasCompleteSecurityCoverage(security) ? "No known findings returned" : "Findings not established"} detail={security.findings.length ? "Choose another finding filter." : hasSecurityCoverage(security) ? "Some sources were queried, but coverage is incomplete." : "Scout has no advisory or dependency coverage for this repository yet."} />}
      />
    </SpaceBetween>
  );
}

export function GlobalSecurityPage({ workspace, overview, loading, error, refresh, navigate }: {
  workspace: SecurityWorkspace | null;
  overview: Overview;
  loading: boolean;
  error: string | null;
  refresh: () => void;
  navigate: (href: string) => void;
}) {
  const repositories = workspace?.repositories ?? [];
  const directFindings = repositories.flatMap((repository) => repository.findings.filter((finding) => finding.category === "application"));
  const directCves = new Set(directFindings.map((finding) => finding.vulnerabilityId));
  const affectedApplications = new Set(directFindings.map((finding) => finding.applicationId).filter(Boolean));
  const repositoriesWithSevereContainerFindings = repositories.filter((repository) => repository.findings.some((finding) => finding.category !== "application" && (finding.severity === "critical" || finding.severity === "high"))).length;
  return (
    <ContentLayout header={<Header variant="h1" description="Application security decisions for tracked package repositories." info={<InfoPopover header="Security Intelligence">Scout keeps direct application advisories separate from container dependency findings. Coverage reflects only sources that could be evaluated, never an implied zero. Finding totals can include the same CVE in multiple package or flavor contexts. Infrastructure and deployment repositories such as SONIC are not included.</InfoPopover>} actions={<Button iconName="refresh" variant="icon" ariaLabel="Refresh security intelligence" loading={loading} onClick={refresh} />}>Security intelligence</Header>}>
      <SpaceBetween size="l">
        {error ? <Flashbar items={[{ type: workspace ? "warning" : "error", header: "Security intelligence could not be refreshed", content: workspace ? "Showing the last security state loaded by Scout." : error }]} /> : null}
        <Container header={<Header variant="h2" description="Security state that may change a maintainer decision.">Maintainer security queue</Header>}>
          {workspace ? <KeyValuePairs columns={3} items={[
            { label: "Tracked repositories", value: workspace.summary.repositories },
            { label: "Application versions requiring action", value: affectedApplications.size },
            { label: "Direct application CVEs", value: directCves.size },
            { label: "Repositories with Critical / High dependencies", value: repositoriesWithSevereContainerFindings },
            { label: "Application versions checked", value: `${repositories.flatMap((repository) => repository.applications).filter((application) => application.coverage !== "unknown").length} / ${workspace.summary.applications}` },
            { label: "Container coverage", value: `${workspace.summary.coverage.full} full · ${workspace.summary.coverage.partial} mixed · ${workspace.summary.coverage.unavailable} unavailable` },
          ]} /> : <Box textAlign="center"><Spinner /> Loading cached security intelligence</Box>}
        </Container>
        <Table
          variant="container" stickyHeader stripedRows trackBy="repositoryId" loading={loading && !workspace} items={repositories}
          header={<Header variant="h2" counter={workspace ? `(${repositories.length})` : undefined} description="Open a repository for the affected version, required update, related PR, and supporting evidence.">Repository security decisions</Header>}
          columnDefinitions={[
            { id: "repository", header: "Repository", cell: (item) => { const [owner, name] = item.repositoryId.split("/"); return <SpaceBetween size="xxs"><Button variant="inline-link" onClick={() => navigate(`/repositories/${item.repositoryId}?tab=security`)}>{name}</Button><Box color="text-body-secondary">{owner}</Box></SpaceBetween>; } },
            { id: "applications", header: "Application decision", cell: (item) => { const affectedIds = new Set(item.findings.filter((finding) => finding.category === "application").map((finding) => finding.applicationId)); const affected = item.applications.filter((application) => affectedIds.has(application.id)); if (affected.length) { const cves = new Set(item.findings.filter((finding) => finding.category === "application").map((finding) => finding.vulnerabilityId)); return <SpaceBetween size="xxs"><StatusIndicator type="error">{affected.length} version{affected.length === 1 ? "" : "s"} affected</StatusIndicator><Box color="text-body-secondary">{cves.size} direct CVE{cves.size === 1 ? "" : "s"} · {affected.map((application) => `${application.name} ${application.version ?? ""}`.trim()).join(", ")}</Box></SpaceBetween>; } const checked = item.applications.filter((application) => application.coverage !== "unknown").length; const incomplete = item.applications.some((application) => application.coverage !== "full"); return checked && !incomplete ? <StatusIndicator type="success">No known direct CVEs in {checked} checked version{checked === 1 ? "" : "s"}</StatusIndicator> : checked ? <StatusIndicator type="warning">No direct CVEs found; vendor coverage is incomplete</StatusIndicator> : <StatusIndicator type="pending">Application coverage not established</StatusIndicator>; } },
            { id: "dependencies", header: "Container priority", cell: (item) => { const severe = item.findings.filter((finding) => finding.category !== "application" && (finding.severity === "critical" || finding.severity === "high")); return severe.length ? <StatusIndicator type="warning">{severe.length} Critical / High occurrences</StatusIndicator> : containerCoverage(item); } },
            { id: "action", header: "Next action", cell: (item) => { const appFindings = item.findings.filter((finding) => finding.category === "application"); if (appFindings.length) return <Button variant="inline-link" onClick={() => navigate(`/repositories/${item.repositoryId}?tab=security`)}>Review application update</Button>; const severe = item.findings.some((finding) => finding.category !== "application" && (finding.severity === "critical" || finding.severity === "high")); if (severe) return <Button variant="inline-link" onClick={() => navigate(`/repositories/${item.repositoryId}?tab=security`)}>Review dependency findings</Button>; if (item.applications.some((application) => application.coverage !== "full")) return <Button variant="inline-link" onClick={() => navigate(`/repositories/${item.repositoryId}?tab=security`)}>Review coverage gap</Button>; return <Box color="text-body-secondary">No immediate action</Box>; } },
            { id: "activity", header: "Last checked", cell: (item) => item.analyzedAt ? relativeTime(item.analyzedAt, workspace?.generatedAt ?? overview.generatedAt) : item.state === "refreshing" || item.state === "queued" ? <StatusIndicator type="in-progress">Refreshing</StatusIndicator> : <Box color="text-body-secondary">Not analyzed</Box> },
          ]}
          empty={<EmptyState title="No tracked repositories" detail="Choose repositories in Workspace settings before loading security intelligence." />}
        />
      </SpaceBetween>
    </ContentLayout>
  );
}
