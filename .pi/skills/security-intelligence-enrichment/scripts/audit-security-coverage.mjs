#!/usr/bin/env node

const args = new Set(process.argv.slice(2));
const baseArgument = process.argv.slice(2).find((value) => !value.startsWith("--"));
const baseUrl = (baseArgument ?? "http://127.0.0.1:3001").replace(/\/$/, "");
const refresh = args.has("--refresh");
const url = `${baseUrl}/api/security${refresh ? "?refresh=true" : ""}`;

let response;
try {
  response = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
} catch (error) {
  console.error(`Security API request failed: ${error instanceof Error ? error.message : error}`);
  process.exit(2);
}

const payload = await response.json().catch(() => null);
if (!response.ok || !payload || !Array.isArray(payload.repositories)) {
  console.error(`Security API returned ${response.status}: ${payload?.error ?? "invalid response"}`);
  process.exit(2);
}

if (refresh) console.log("Refresh requested. Results below may be stale or in progress; rerun without --refresh after refreshing=false.\n");
console.log(`Generated: ${payload.generatedAt ?? "unknown"}`);
console.log(`Refreshing: ${Boolean(payload.refreshing)}`);
console.log(`Selected repositories: ${payload.repositories.length}\n`);

const rows = payload.repositories.map((repository) => {
  const applications = repository.applications ?? [];
  const appCoverage = { full: 0, partial: 0, unknown: 0 };
  const identity = { identified: 0, probable: 0, unknown: 0 };
  for (const application of applications) {
    appCoverage[application.coverage] = (appCoverage[application.coverage] ?? 0) + 1;
    identity[application.confidence] = (identity[application.confidence] ?? 0) + 1;
  }
  const directCves = new Set((repository.findings ?? []).filter((finding) => finding.category === "application").map((finding) => finding.vulnerabilityId));
  return {
    repository: repository.repositoryId,
    state: repository.state,
    apps: applications.length,
    identity: `${identity.identified}/${identity.probable}/${identity.unknown}`,
    appCoverage: `${appCoverage.full}/${appCoverage.partial}/${appCoverage.unknown}`,
    images: `${repository.coverage?.fullContainerCoverage ?? 0}/${repository.coverage?.partialContainerCoverage ?? 0}/${repository.coverage?.unavailableContainerCoverage ?? 0}`,
    directCves: directCves.size,
  };
});
console.table(rows);
console.log("Identity and coverage columns: identified/probable/unknown; images: full/partial/unavailable.\n");

let gapCount = 0;
for (const repository of payload.repositories) {
  const gaps = (repository.applications ?? []).filter((application) => application.confidence !== "identified" || application.coverage !== "full");
  const unavailableImages = repository.coverage?.unavailableContainerCoverage ?? 0;
  if (!gaps.length && unavailableImages === 0 && !repository.error) continue;
  console.log(`## ${repository.repositoryId}`);
  if (repository.error) console.log(`- Repository error: ${repository.error}`);
  for (const application of gaps) {
    gapCount += 1;
    const checked = application.advisorySources?.join(", ") || "none";
    const missing = (application.expectedAdvisorySources ?? []).filter((source) => !(application.advisorySources ?? []).includes(source)).join(", ") || "no reliable provider established";
    console.log(`- ${application.name} ${application.version ?? "version unknown"}: identity=${application.confidence}; coverage=${application.coverage}; checked=${checked}; missing=${missing}`);
    if (application.coverageReason) console.log(`  ${application.coverageReason}`);
  }
  if (unavailableImages) console.log(`- ${unavailableImages} image inventories unavailable.`);
  console.log();
}

console.log(`Application identity/coverage gaps: ${gapCount}`);
if (payload.refreshing) console.log("Refresh is still active. Poll the API and rerun this audit before drawing conclusions.");
