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
import type { Overview, PullRequest, Repository } from "./types";

const SEVERITY_ORDER: SecuritySeverity[] = ["critical", "high", "medium", "low", "unknown"];

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

const FINDING_FILTERS = [
  { label: "Decision-relevant", value: "priority" },
  { label: "All findings", value: "all" },
  { label: "Application advisories", value: "application" },
  { label: "Container dependencies", value: "container" },
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
  const [inventoryPage, setInventoryPage] = useState(1);
  const pulls = overview.pullRequests.filter((pull) => pull.repository === repository.fullName);
  const filteredOccurrences = useMemo(() => (security?.findings ?? []).filter((finding) => {
    if (filter === "priority") return finding.category === "application" || ((finding.severity === "critical" || finding.severity === "high") && Boolean(relatedUpdate(finding, security?.vulnerabilities[finding.vulnerabilityId], pulls)));
    if (filter === "application") return finding.category === "application";
    if (filter === "container") return finding.category !== "application";
    if (filter === "fix") return Boolean(finding.fixedVersion);
    if (["critical", "high", "medium"].includes(filter)) return finding.severity === filter;
    return true;
  }), [filter, pulls, security?.findings, security?.vulnerabilities]);
  const findingGroups = useMemo(() => {
    const groups = new Map<string, { id: string; finding: SecurityFinding; occurrences: SecurityFinding[] }>();
    for (const finding of filteredOccurrences) {
      const category = finding.category === "application" ? "application" : "container";
      const id = `${category}:${finding.vulnerabilityId}`;
      const group = groups.get(id);
      if (!group) groups.set(id, { id, finding, occurrences: [finding] });
      else {
        group.occurrences.push(finding);
        if (SEVERITY_ORDER.indexOf(finding.severity) < SEVERITY_ORDER.indexOf(group.finding.severity)) group.finding = finding;
      }
    }
    return [...groups.values()].sort((left, right) => SEVERITY_ORDER.indexOf(left.finding.severity) - SEVERITY_ORDER.indexOf(right.finding.severity) || left.finding.vulnerabilityId.localeCompare(right.finding.vulnerabilityId));
  }, [filteredOccurrences]);
  const findingsPageCount = Math.max(1, Math.ceil(findingGroups.length / 25));
  const currentFindingsPage = Math.min(findingsPage, findingsPageCount);
  const visibleFindingGroups = findingGroups.slice((currentFindingsPage - 1) * 25, currentFindingsPage * 25);
  const inventoryPageCount = Math.max(1, Math.ceil((security?.artifacts.length ?? 0) / 10));
  const currentInventoryPage = Math.min(inventoryPage, inventoryPageCount);
  const visibleArtifacts = (security?.artifacts ?? []).slice((currentInventoryPage - 1) * 10, currentInventoryPage * 10);
  const directApplicationFindings = (security?.findings ?? []).filter((finding) => finding.category === "application");
  const highImpactApplicationFindings = directApplicationFindings.filter((finding) => finding.severity === "critical" || finding.severity === "high");
  const highImpactApplicationCves = new Set(highImpactApplicationFindings.map((finding) => finding.vulnerabilityId));
  const otherApplicationCves = new Set(directApplicationFindings.filter((finding) => finding.severity !== "critical" && finding.severity !== "high").map((finding) => finding.vulnerabilityId));
  const affectedApplicationVersions = new Set(highImpactApplicationFindings.map((finding) => finding.applicationId).filter(Boolean));
  const evaluatedImages = (security?.coverage.fullContainerCoverage ?? 0) + (security?.coverage.partialContainerCoverage ?? 0);
  const severeContainerFindings = (security?.findings ?? []).filter((finding) => finding.category !== "application" && (finding.severity === "critical" || finding.severity === "high"));
  const severeContainerCves = new Set(severeContainerFindings.map((finding) => finding.vulnerabilityId));
  const affectedContainerImages = new Set(severeContainerFindings.map((finding) => finding.artifactId).filter(Boolean));
  const dependencyUpdatePulls = new Set(severeContainerFindings.map((finding) => relatedUpdate(finding, security?.vulnerabilities[finding.vulnerabilityId], pulls)?.id).filter(Boolean));

  if (!security) return <Container><Box textAlign="center"><Spinner /> Loading cached security intelligence</Box></Container>;
  if (security.applicable === false) return <Container><EmptyState title="No Zarf packages discovered" detail="Scout found no valid ZarfPackageConfig definitions in this repository. Repository operations remain available normally." /></Container>;

  return (
    <SpaceBetween size="l">
      {security.error ? <Flashbar items={[{ type: "warning", header: "Security intelligence could not be refreshed", content: `${security.error} Cached findings remain visible when available.` }]} /> : null}
      {analysisProgress(security)}
      <Container header={<Header variant="h2" description="Upstream application advisories first; container dependencies remain supporting evidence." info={<InfoPopover header="Security decision">Scout prioritizes unique Critical and High application CVEs from upstream and authoritative sources. It analyzes each shipped image for accuracy, but collapses repeated package and flavor occurrences into one maintainer decision.</InfoPopover>}>Security decision</Header>}>
        <KeyValuePairs columns={3} items={[
          { label: "High-impact application CVEs", value: highImpactApplicationCves.size || (security.applications.every((application) => application.coverage === "full") ? 0 : <Box color="text-body-secondary">None in checked sources</Box>) },
          { label: "Application versions requiring action", value: affectedApplicationVersions.size },
          { label: "Other application advisories", value: otherApplicationCves.size },
          { label: "Dependency update PRs", value: dependencyUpdatePulls.size },
          { label: "Security visibility", value: `${security.applications.filter((application) => application.coverage !== "unknown").length} / ${security.coverage.applicationsTotal} app versions · ${evaluatedImages} / ${security.coverage.containerImages} images` },
          { label: "Last checked", value: security.analyzedAt ? relativeTime(security.analyzedAt, new Date().toISOString()) : <Box color="text-body-secondary">Not analyzed</Box> },
        ]} />
      </Container>
      <Table
        variant="container" trackBy="id" items={security.applications}
        header={<Header variant="h2" counter={`(${security.applications.length})`} description="Affected versions and the next maintainer action." info={<InfoPopover header="Application advisory coverage">Checked sources are shown for each version. Missing vendor coverage remains explicit and must not be interpreted as zero vulnerabilities.</InfoPopover>}>Application security decisions</Header>}
        columnDefinitions={[
          { id: "application", header: "Application version", cell: (item) => <SpaceBetween size="xxs"><Box variant="strong">{item.name} {item.version ?? "version unknown"}</Box><Box color="text-body-secondary">{item.upstreamRepository ? `Upstream: ${item.upstreamRepository}` : "Upstream identity not established"}</Box></SpaceBetween> },
          { id: "decision", header: "Decision", cell: (item) => { const appFindings = security.findings.filter((finding) => item.findingIds.includes(finding.id)).sort((left, right) => SEVERITY_ORDER.indexOf(left.severity) - SEVERITY_ORDER.indexOf(right.severity)); const critical = appFindings.filter((finding) => finding.severity === "critical").length; const high = appFindings.filter((finding) => finding.severity === "high").length; const highImpact = critical + high; const level: SecuritySeverity = critical ? "critical" : high ? "high" : appFindings.some((finding) => finding.severity === "medium") ? "medium" : appFindings.some((finding) => finding.severity === "low") ? "low" : "unknown"; if (item.coverage === "unknown") return <SpaceBetween size="xxs"><StatusIndicator type="pending">Upstream advisory coverage not established</StatusIndicator><Box color="text-body-secondary">{item.coverageReason}</Box></SpaceBetween>; if (!appFindings.length) return item.coverage === "partial" ? <SpaceBetween size="xxs"><StatusIndicator type="pending">No direct CVEs found in checked sources</StatusIndicator><Box color="text-body-secondary">{item.coverageReason}</Box><Box color="text-body-secondary">Checked {item.advisorySources.join(", ")}</Box></SpaceBetween> : <SpaceBetween size="xxs"><StatusIndicator type="success">No known direct application CVEs</StatusIndicator><Box color="text-body-secondary">Checked {item.advisorySources.join(", ")}</Box></SpaceBetween>; return <SpaceBetween size="xxs"><SpaceBetween direction="horizontal" size="xs">{severityBadge(level)}<Box>{highImpact ? `${highImpact} high-impact upstream ${highImpact === 1 ? "CVE" : "CVEs"}` : `${appFindings.length} other direct ${appFindings.length === 1 ? "advisory" : "advisories"}`}</Box></SpaceBetween><Box>{appFindings.slice(0, 3).map((finding, index) => { const vulnerability = security.vulnerabilities[finding.vulnerabilityId]; return <span key={finding.id}>{index ? " · " : ""}<Button variant="inline-link" onClick={() => openDrawer(findingDrawerSelection(finding, security, pulls))}>{vulnerability?.id ?? finding.vulnerabilityId}</Button></span>; })}{appFindings.length > 3 ? <Box color="text-body-secondary" display="inline"> · +{appFindings.length - 3} more below</Box> : null}</Box><Box color="text-body-secondary">Checked {item.advisorySources.join(", ")}</Box></SpaceBetween>; } },
          { id: "action", header: "Required action", cell: (item) => { const appFindings = security.findings.filter((finding) => item.findingIds.includes(finding.id)); if (!appFindings.length) return item.coverage === "unknown" ? <Box color="text-body-secondary">No maintainer action · upstream identity not established</Box> : item.coverage === "partial" ? <Box color="text-body-secondary">No maintainer action · upstream visibility incomplete</Box> : <Box color="text-body-secondary">No application update required from checked advisories.</Box>; const representative = [...appFindings].sort((left, right) => SEVERITY_ORDER.indexOf(left.severity) - SEVERITY_ORDER.indexOf(right.severity))[0]; return <SpaceBetween size="xxs"><Box>{item.fixedVersion ? `Update to ${item.fixedVersion}` : "Review the vendor advisory; no fixed version is reported."}</Box>{managementContext(representative, security.vulnerabilities[representative.vulnerabilityId], pulls, openDrawer)}{item.expectedAdvisorySources?.length > item.advisorySources.length ? <StatusIndicator type="warning">An expected source is unavailable</StatusIndicator> : null}</SpaceBetween>; } },
        ]}
        empty={<EmptyState title="No applications identified" detail="Scout could not reliably identify a primary application from the discovered package metadata." />}
      />
      <ExpandableSection variant="container" headerText={`Container dependency evidence (${severeContainerCves.size} high-impact ${severeContainerCves.size === 1 ? "CVE" : "CVEs"})`}>
        <SpaceBetween size="m">
          <KeyValuePairs columns={3} items={[
            { label: "Images evaluated", value: `${evaluatedImages} / ${security.coverage.containerImages}` },
            { label: "Critical / High dependency CVEs", value: severeContainerCves.size },
            { label: "Affected images", value: affectedContainerImages.size },
          ]} />
          <ExpandableSection headerText={`Image inventory coverage (${security.artifacts.length})`}>
            <Table
              variant="embedded" trackBy="id" items={visibleArtifacts}
              pagination={inventoryPageCount > 1 ? <Pagination currentPageIndex={currentInventoryPage} pagesCount={inventoryPageCount} onChange={({ detail }) => setInventoryPage(detail.currentPageIndex)} /> : undefined}
              header={<Header variant="h3" description="Exact image evidence is available for coverage investigation, not as a separate maintainer queue.">Container images</Header>}
              columnDefinitions={[
                { id: "image", header: "Container image", cell: (item) => <SpaceBetween size="xxs"><Box variant="code">{item.imageReference}</Box><Box color="text-body-secondary">{item.digest ? item.digest.slice(0, 28) + "…" : item.resolutionError ?? "Digest unavailable"}</Box></SpaceBetween> },
                { id: "component", header: "Component", cell: (item) => item.componentName },
                { id: "inventory", header: "Dependency inventory", cell: (item) => item.sbom.available ? <SpaceBetween size="xxs"><StatusIndicator type="success">Available</StatusIndicator><Box color="text-body-secondary">{item.sbom.source}</Box></SpaceBetween> : <StatusIndicator type="pending">Not available</StatusIndicator> },
                { id: "priority", header: "High-impact CVEs", cell: (item) => new Set(security.findings.filter((finding) => item.findingIds.includes(finding.id) && (finding.severity === "critical" || finding.severity === "high")).map((finding) => finding.vulnerabilityId)).size },
              ]}
              empty={<EmptyState title="No container images discovered" detail="The Zarf definitions do not declare container images directly." />}
            />
          </ExpandableSection>
        </SpaceBetween>
      </ExpandableSection>
      <Table
        variant="container" trackBy="id" items={visibleFindingGroups}
        pagination={findingsPageCount > 1 ? <Pagination currentPageIndex={currentFindingsPage} pagesCount={findingsPageCount} onChange={({ detail }) => setFindingsPage(detail.currentPageIndex)} /> : undefined}
        filter={<Select selectedOption={FINDING_FILTERS.find((option) => option.value === filter) ?? FINDING_FILTERS[0]} options={FINDING_FILTERS} onChange={({ detail }) => { setFilter(detail.selectedOption.value ?? "priority"); setFindingsPage(1); }} />}
        header={<Header variant="h2" counter={`(${findingGroups.length})`} description="Unique upstream application advisories and high-impact dependency CVEs." info={<InfoPopover header="Decision-relevant findings">Scout collapses repeated image and package occurrences into one CVE decision. The default includes direct application advisories and Critical or High dependency CVEs only when Scout finds a matching update pull request. Complete container evidence remains available through the filters.</InfoPopover>}>Findings requiring review</Header>}
        columnDefinitions={[
          { id: "finding", header: "Finding", cell: (item) => { const finding = item.finding; const vulnerability = security.vulnerabilities[finding.vulnerabilityId]; return <SpaceBetween size="xxs"><SpaceBetween direction="horizontal" size="xs"><Button variant="inline-link" onClick={() => openDrawer(findingDrawerSelection(finding, security, pulls))}>{vulnerability?.id ?? finding.vulnerabilityId}</Button>{severityBadge(finding.severity)}</SpaceBetween><Box color="text-body-secondary">{vulnerability?.summary ?? finding.vulnerabilityId}</Box><Box color="text-body-secondary">{finding.sources.join(", ")}</Box></SpaceBetween>; } },
          { id: "affected", header: "Affected scope", cell: (item) => { const finding = item.finding; if (finding.category === "application") { const versions = [...new Set(item.occurrences.map((occurrence) => `${occurrence.affectedPackage} ${occurrence.installedVersion ?? "version unknown"}`))]; return <SpaceBetween size="xxs"><Box>{versions.slice(0, 2).join(", ")}</Box>{versions.length > 2 ? <Box color="text-body-secondary">+{versions.length - 2} more affected versions</Box> : null}</SpaceBetween>; } const packages = [...new Set(item.occurrences.map((occurrence) => `${occurrence.affectedPackage} ${occurrence.installedVersion ?? "version unknown"}`))]; const images = new Set(item.occurrences.map((occurrence) => occurrence.artifactId).filter(Boolean)); return <SpaceBetween size="xxs"><Box>{packages.slice(0, 2).join(", ")}</Box><Box color="text-body-secondary">{images.size} affected image{images.size === 1 ? "" : "s"}{packages.length > 2 ? ` · +${packages.length - 2} more packages` : ""}</Box></SpaceBetween>; } },
          { id: "fix", header: "Required action", cell: (item) => { const finding = item.finding; return <SpaceBetween size="xxs"><Box>{finding.fixedVersion ? `Update to ${finding.fixedVersion}` : "No fixed version reported"}</Box>{managementContext(finding, security.vulnerabilities[finding.vulnerabilityId], pulls, openDrawer)}</SpaceBetween>; } },
        ]}
        empty={<EmptyState title={security.findings.length ? "No findings match this filter" : hasCompleteSecurityCoverage(security) ? "No known findings returned" : "Findings not established"} detail={security.findings.length ? "Choose another finding filter." : hasSecurityCoverage(security) ? "Some sources were queried, but visibility is incomplete." : "Scout has no advisory or dependency visibility for this repository yet."} />}
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
  const highImpactDirectFindings = directFindings.filter((finding) => finding.severity === "critical" || finding.severity === "high");
  const highImpactDirectCves = new Set(highImpactDirectFindings.map((finding) => finding.vulnerabilityId));
  const otherDirectCves = new Set(directFindings.filter((finding) => finding.severity !== "critical" && finding.severity !== "high").map((finding) => finding.vulnerabilityId));
  const affectedApplications = new Set(highImpactDirectFindings.map((finding) => finding.applicationId).filter(Boolean));
  const repositoriesWithDependencyUpdates = repositories.filter((repository) => {
    const pulls = overview.pullRequests.filter((pull) => pull.repository === repository.repositoryId);
    return repository.findings.some((finding) => finding.category !== "application" && (finding.severity === "critical" || finding.severity === "high") && Boolean(relatedUpdate(finding, repository.vulnerabilities[finding.vulnerabilityId], pulls)));
  }).length;
  const orderedRepositories = [...repositories].sort((left, right) => {
    const priority = (item: RepositorySecurity) => { const pulls = overview.pullRequests.filter((pull) => pull.repository === item.repositoryId); return item.findings.some((finding) => finding.category === "application" && finding.severity === "critical") ? 0 : item.findings.some((finding) => finding.category === "application" && finding.severity === "high") ? 1 : item.findings.some((finding) => finding.category === "application") ? 2 : item.findings.some((finding) => finding.category !== "application" && (finding.severity === "critical" || finding.severity === "high") && Boolean(relatedUpdate(finding, item.vulnerabilities[finding.vulnerabilityId], pulls))) ? 3 : item.applications.some((application) => application.coverage !== "full") ? 4 : 5; };
    return priority(left) - priority(right) || left.repositoryId.localeCompare(right.repositoryId);
  });
  return (
    <ContentLayout header={<Header variant="h1" description="High-impact upstream application advisories with container dependency context." info={<InfoPopover header="Security Intelligence">Scout identifies the upstream product from package, chart, image, and SBOM metadata, then prioritizes authoritative Critical and High application advisories. Exact package and flavor evidence remains internal unless needed to explain container visibility. Coverage reflects only sources Scout could evaluate, never an implied zero.</InfoPopover>} actions={<Button iconName="refresh" variant="icon" ariaLabel="Refresh security intelligence" loading={loading} onClick={refresh} />}>Security intelligence</Header>}>
      <SpaceBetween size="l">
        {error ? <Flashbar items={[{ type: workspace ? "warning" : "error", header: "Security intelligence could not be refreshed", content: workspace ? "Showing the last security state loaded by Scout." : error }]} /> : null}
        <Container header={<Header variant="h2" description="Security state that may change a maintainer decision.">Maintainer security queue</Header>}>
          {workspace ? <KeyValuePairs columns={3} items={[
            { label: "Application versions requiring action", value: affectedApplications.size },
            { label: "High-impact application CVEs", value: highImpactDirectCves.size },
            { label: "Other application advisories", value: otherDirectCves.size },
            { label: "Repositories with dependency update PRs", value: repositoriesWithDependencyUpdates },
            { label: "Application versions checked", value: `${repositories.flatMap((repository) => repository.applications).filter((application) => application.coverage !== "unknown").length} / ${workspace.summary.applications}` },
            { label: "Container visibility", value: `${workspace.summary.coverage.full} full · ${workspace.summary.coverage.partial} mixed · ${workspace.summary.coverage.unavailable} unavailable` },
          ]} /> : <Box textAlign="center"><Spinner /> Loading cached security intelligence</Box>}
        </Container>
        <Table
          variant="container" stickyHeader stripedRows trackBy="repositoryId" loading={loading && !workspace} items={orderedRepositories}
          header={<Header variant="h2" counter={workspace ? `(${repositories.length})` : undefined} description="Critical and High upstream application decisions first, then dependency and visibility follow-up.">Repository security decisions</Header>}
          columnDefinitions={[
            { id: "repository", header: "Repository", cell: (item) => { const [owner, name] = item.repositoryId.split("/"); return <SpaceBetween size="xxs"><Button variant="inline-link" onClick={() => navigate(`/repositories/${item.repositoryId}?tab=security`)}>{name}</Button><Box color="text-body-secondary">{owner}</Box></SpaceBetween>; } },
            { id: "applications", header: "Upstream application decision", cell: (item) => { const appFindings = item.findings.filter((finding) => finding.category === "application"); const highImpact = appFindings.filter((finding) => finding.severity === "critical" || finding.severity === "high"); const affectedIds = new Set(highImpact.map((finding) => finding.applicationId)); const affected = item.applications.filter((application) => affectedIds.has(application.id)); const highImpactCves = new Set(highImpact.map((finding) => finding.vulnerabilityId)); const otherCves = new Set(appFindings.filter((finding) => finding.severity !== "critical" && finding.severity !== "high").map((finding) => finding.vulnerabilityId)); const critical = highImpact.some((finding) => finding.severity === "critical"); if (affected.length) return <SpaceBetween size="xxs"><StatusIndicator type={critical ? "error" : "warning"}>{highImpactCves.size} high-impact {highImpactCves.size === 1 ? "CVE" : "CVEs"}</StatusIndicator><Box color="text-body-secondary">{affected.map((application) => `${application.name} ${application.version ?? ""}`.trim()).join(", ")}</Box></SpaceBetween>; if (otherCves.size) return <StatusIndicator type="info">{otherCves.size} other application {otherCves.size === 1 ? "advisory" : "advisories"}</StatusIndicator>; const checked = item.applications.filter((application) => application.coverage !== "unknown").length; const incomplete = item.applications.some((application) => application.coverage !== "full"); return checked && !incomplete ? <StatusIndicator type="success">No known direct CVEs in {checked} checked version{checked === 1 ? "" : "s"}</StatusIndicator> : checked ? <StatusIndicator type="pending">No CVEs in checked upstream sources; visibility incomplete</StatusIndicator> : <StatusIndicator type="pending">Upstream application visibility not established</StatusIndicator>; } },
            { id: "dependencies", header: "Container context", cell: (item) => { const severeFindings = item.findings.filter((finding) => finding.category !== "application" && (finding.severity === "critical" || finding.severity === "high")); const severe = new Set(severeFindings.map((finding) => finding.vulnerabilityId)); const pulls = overview.pullRequests.filter((pull) => pull.repository === item.repositoryId); const updateAvailable = severeFindings.some((finding) => Boolean(relatedUpdate(finding, item.vulnerabilities[finding.vulnerabilityId], pulls))); return severe.size ? <StatusIndicator type={updateAvailable ? "warning" : "info"}>{severe.size} high-impact dependency {severe.size === 1 ? "CVE" : "CVEs"}</StatusIndicator> : containerCoverage(item); } },
            { id: "action", header: "Next action", cell: (item) => { const highImpactApp = item.findings.some((finding) => finding.category === "application" && (finding.severity === "critical" || finding.severity === "high")); if (highImpactApp) return <Button variant="inline-link" onClick={() => navigate(`/repositories/${item.repositoryId}?tab=security`)}>Review upstream update</Button>; if (item.findings.some((finding) => finding.category === "application")) return <Button variant="inline-link" onClick={() => navigate(`/repositories/${item.repositoryId}?tab=security`)}>Review application advisories</Button>; const pulls = overview.pullRequests.filter((pull) => pull.repository === item.repositoryId); const dependencyUpdate = item.findings.some((finding) => finding.category !== "application" && (finding.severity === "critical" || finding.severity === "high") && Boolean(relatedUpdate(finding, item.vulnerabilities[finding.vulnerabilityId], pulls))); if (dependencyUpdate) return <Button variant="inline-link" onClick={() => navigate(`/repositories/${item.repositoryId}?tab=security`)}>Review dependency update</Button>; if (item.applications.some((application) => application.coverage !== "full")) return <Box color="text-body-secondary">No maintainer action</Box>; return <Box color="text-body-secondary">No immediate action</Box>; } },
            { id: "activity", header: "Last checked", cell: (item) => item.analyzedAt ? relativeTime(item.analyzedAt, workspace?.generatedAt ?? overview.generatedAt) : item.state === "refreshing" || item.state === "queued" ? <StatusIndicator type="in-progress">Refreshing</StatusIndicator> : <Box color="text-body-secondary">Not analyzed</Box> },
          ]}
          empty={<EmptyState title="No tracked repositories" detail="Choose repositories in Workspace settings before loading security intelligence." />}
        />
      </SpaceBetween>
    </ContentLayout>
  );
}
