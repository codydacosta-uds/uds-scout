import "server-only";

import { readFileSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { load } from "js-yaml";
import { loadEnvConfig } from "@next/env";
import type { SecuritySeverity, Vulnerability } from "@/components/security-types";
import type { PullRequest } from "@/components/types";
import { localSettingsPath } from "@/lib/local-settings";
import { githubRequest } from "@/lib/github";
import { SECURITY_PRODUCT_PROFILES, normalizeAdvisoryVersion } from "@/lib/security-products";
import { queryNvdApplicationAdvisories, type AdvisoryMatch } from "@/lib/security-advisories";

const SONIC_REPOSITORY = "nswccd-devsecops/sonic-swf-iac";
const BUNDLE_PATH = "bundles/swf/uds-bundle.yaml";
const SONIC_ARCHITECTURE = "amd64";
const CRITICAL_INTERVAL = 24 * 60 * 60_000;
const HIGH_INTERVAL = 48 * 60 * 60_000;
const PULL_REQUEST_STORE = "security-slack-pull-requests.json";

loadEnvConfig(process.cwd());

type BundlePackage = { name?: string; repository?: string; ref?: string; "<<"?: { repository?: string; ref?: string } };
type BundleDocument = { packages?: BundlePackage[] };
type NotificationRecord = { lastSentAt: string; severity: "critical" | "high" };
type NotificationStore = { records: Record<string, NotificationRecord> };
type GithubContent = { content?: string; encoding?: string; sha?: string };
type Alert = { severity: "critical" | "high"; fixedVersion: string | null; vulnerability: Vulnerability };
type PullNotificationStore = { fingerprints: Record<string, string> };
export type WorkflowRun = { id: number; name: string; display_title: string; html_url: string; status: string; conclusion: string | null; head_branch: string | null; head_sha: string; created_at: string; run_attempt?: number };

function storePath() {
  return process.env.UDS_SCOUT_SECURITY_SLACK_PATH ?? join(dirname(localSettingsPath()), "security-slack-notifications.json");
}

function pullStorePath() {
  return process.env.UDS_SCOUT_SECURITY_SLACK_PULL_REQUEST_PATH ?? join(dirname(localSettingsPath()), PULL_REQUEST_STORE);
}

function loadPullStore(): PullNotificationStore {
  try {
    const value = JSON.parse(readFileSync(/* turbopackIgnore: true */ pullStorePath(), "utf8")) as PullNotificationStore;
    return value?.fingerprints && typeof value.fingerprints === "object" ? value : { fingerprints: {} };
  } catch {
    return { fingerprints: {} };
  }
}

function savePullStore(store: PullNotificationStore) {
  const path = pullStorePath();
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, JSON.stringify(store, null, 2));
  renameSync(temporary, path);
}

function loadStore(): NotificationStore {
  try {
    const value = JSON.parse(readFileSync(/* turbopackIgnore: true */ storePath(), "utf8")) as NotificationStore;
    return value?.records && typeof value.records === "object" ? value : { records: {} };
  } catch {
    return { records: {} };
  }
}

function saveStore(store: NotificationStore) {
  const path = storePath();
  const temporary = `${path}.${process.pid}.tmp`;
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(temporary, `${JSON.stringify(store)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, path);
}

function normalizeVersion(value: string) {
  return normalizeAdvisoryVersion(value.replace(/-(?:uds|unicorn|registry1|upstream)(?:[.-].*)?$/i, ""));
}

function repositoryName(value: string) {
  return value.split("/").at(-1)?.toLowerCase() ?? "";
}

function cpeValue(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/([*?!:])/g, "\\$1");
}

async function sonicBundle() {
  const response = await githubRequest<GithubContent>(`/repos/${SONIC_REPOSITORY}/contents/${BUNDLE_PATH}?ref=main`, 15 * 60_000);
  if (!response.content) throw new Error("SONIC bundle content was unavailable.");
  const content = response.encoding === "base64" ? Buffer.from(response.content, "base64").toString("utf8") : response.content;
  return load(content) as BundleDocument;
}

function severityLabel(value: SecuritySeverity) {
  return value === "critical" ? "CRITICAL" : "HIGH";
}

function slackPayload(alert: Alert, packageName: string, runningVersion: string, registryUrl: string | null) {
  const advisory = alert.vulnerability.references[0] ?? `https://nvd.nist.gov/vuln/detail/${encodeURIComponent(alert.vulnerability.id)}`;
  const scoutUrl = `http://d2d.admin.uds.localhost:3001/repositories/${SONIC_REPOSITORY}`;
  return {
    attachments: [{
      color: alert.severity === "critical" ? "#d91515" : "#d6a514",
      title: `${severityLabel(alert.severity)} · SONIC package vulnerability`,
      title_link: registryUrl ?? scoutUrl,
      fields: [
        { title: "Package", value: `${packageName} ${runningVersion}`, short: false },
        { title: "CVE", value: `<${advisory}|${alert.vulnerability.id}>`, short: true },
        { title: "Severity", value: `${severityLabel(alert.severity)}${alert.vulnerability.cvss ? ` · CVSS ${alert.vulnerability.cvss}` : ""}`, short: true },
        { title: "Fixed version", value: alert.fixedVersion ?? "Not published", short: true },
        { title: "Scout", value: `<${scoutUrl}|Open SONIC repository>`, short: true },
      ],
      text: alert.vulnerability.summary,
    }],
  };
}

function profileForPackage(packageName: string) {
  return SECURITY_PRODUCT_PROFILES.find((profile) => profile.aliases.some((alias) => alias.test(packageName))) ?? null;
}

function registryUrl(repository: string | undefined, ref: string, architecture: string) {
  if (!repository?.startsWith("registry.defenseunicorns.com/")) return null;
  const path = repository.slice("registry.defenseunicorns.com/".length).split("/").map(encodeURIComponent).join("/");
  return `https://registry.defenseunicorns.com/repo/${path}/overview/${encodeURIComponent(`${ref}-${architecture}`)}`;
}

let notificationInFlight: Promise<void> | null = null;

async function notifySonicDeployedSecurityWork() {
  const webhook = process.env.UDS_SCOUT_SLACK_WEBHOOK?.trim();
  if (!webhook || !/^https:\/\/hooks\.slack\.com\/services\//.test(webhook)) return;

  let bundle: BundleDocument;
  try {
    bundle = await sonicBundle();
  } catch (error) {
    console.error("[security-slack] SONIC bundle lookup failed", error instanceof Error ? error.message : error);
    return;
  }
  const store = loadStore();
  let changed = false;
  for (const deployed of bundle.packages ?? []) {
    const deployedRepository = deployed.repository ?? deployed["<<"]?.repository;
    const deployedRef = deployed.ref ?? deployed["<<"]?.ref;
    if (!deployed.name || !deployedRef) continue;
    const packageName = repositoryName(deployedRepository ?? deployed.name);
    const profile = profileForPackage(packageName);
    if (!profile?.cpe) {
      continue;
    }
    const runningVersion = normalizeVersion(deployedRef);
    const cpe = `cpe:2.3:a:${cpeValue(profile.cpe.vendor)}:${cpeValue(profile.cpe.product)}:${cpeValue(runningVersion)}:*:*:*:*:*:*:*`;
    let matches: AdvisoryMatch[];
    try {
      matches = await queryNvdApplicationAdvisories(cpe, runningVersion);
    } catch {
      // Skip packages whose advisory provider is temporarily unavailable.
      continue;
    }
    const severe = matches.filter((match) => match.vulnerability.severity === "critical" || match.vulnerability.severity === "high");
    for (const match of severe) {
      const severity = match.vulnerability.severity === "critical" ? "critical" : "high";
      const key = `${packageName}:${runningVersion}:${match.vulnerability.id}`.toLowerCase();
      const previous = store.records[key];
      const interval = severity === "critical" ? CRITICAL_INTERVAL : HIGH_INTERVAL;
      if (previous && previous.severity === severity && Date.now() - new Date(previous.lastSentAt).getTime() < interval) continue;
      const response = await fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(slackPayload({ severity, fixedVersion: match.fixedVersion, vulnerability: match.vulnerability }, packageName, runningVersion, registryUrl(deployedRepository, deployedRef, SONIC_ARCHITECTURE))),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) continue;
      store.records[key] = { lastSentAt: new Date().toISOString(), severity };
      changed = true;
    }
  }
  if (changed) saveStore(store);
}

export function notifySonicDeployedSecurity() {
  if (notificationInFlight) return notificationInFlight;
  notificationInFlight = notifySonicDeployedSecurityWork().finally(() => { notificationInFlight = null; });
  return notificationInFlight;
}

export async function notifyPackageWorkflowFailuresSlack(repository: string, runs: WorkflowRun[]) {
  if (!repository.toLowerCase().startsWith("uds-packages/")) return;
  const webhook = process.env.UDS_SCOUT_SLACK_WEBHOOK;
  if (!webhook || !/^https:\/\/hooks\.slack\.com\/services\//.test(webhook)) return;
  const failed = (run: WorkflowRun) => ["failure", "timed_out", "action_required", "startup_failure"].includes(run.conclusion ?? "");
  const groups = new Map<string, WorkflowRun[]>();
  for (const run of runs) {
    if (!run.head_branch || !run.head_sha) continue;
    const key = `${run.name}:${run.head_branch}:${run.head_sha}`;
    groups.set(key, [...(groups.get(key) ?? []), run]);
  }
  const store = loadPullStore();
  let changed = false;
  for (const [groupKey, group] of groups) {
    const attempts = [...new Map(group.map((run) => [`${run.id}:${run.run_attempt ?? 1}`, run])).values()]
      .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime());
    const latest = attempts[0];
    const threeListedRunsFailed = attempts.length >= 3 && attempts.slice(0, 3).every(failed);
    // GitHub may expose reruns as one run with run_attempt=3 rather than three list entries.
    const thirdAttemptFailed = (latest.run_attempt ?? 1) >= 3 && failed(latest);
    if (!threeListedRunsFailed && !thirdAttemptFailed) continue;
    const key = `workflow:${repository}:${groupKey}`;
    const fingerprint = `${latest.id}:${latest.run_attempt ?? 1}`;
    if (store.fingerprints[key] === fingerprint) continue;
    const response = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ attachments: [{ color: "#d6a514", title: "Workflow failed after 3 attempts · package", title_link: latest.html_url, text: `${repository} · ${latest.display_title || latest.name} · ${latest.head_branch}` }] }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) continue;
    store.fingerprints[key] = fingerprint;
    changed = true;
  }
  if (changed) savePullStore(store);
}

export async function notifyPullRequestsSlack(repository: string, pulls: PullRequest[]) {
  const webhook = process.env.UDS_SCOUT_SLACK_WEBHOOK;
  if (!webhook || !/^https:\/\/hooks\.slack\.com\/services\//.test(webhook)) return;
  const store = loadPullStore();
  let changed = false;
  for (const pull of pulls) {
    const type = pull.workflow.reviewRequestedFromViewer ? "review" : pull.workflow.state === "ready-to-merge" ? "ready" : null;
    if (!type) continue;
    const key = `${type}:${repository}:${pull.id}`;
    const fingerprint = `${pull.updatedAt}:${pull.workflow.state}:${pull.workflow.reviewRequestedFromViewer}`;
    if (store.fingerprints[key] === fingerprint) continue;
    const response = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ attachments: [{ color: type === "review" ? "#d6a514" : "#2ea043", title: type === "review" ? "Review requested · pull request" : "Ready to merge · pull request", title_link: pull.url, text: `${repository} #${pull.number} · ${pull.title} · ${pull.author}` }] }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) continue;
    store.fingerprints[key] = fingerprint;
    changed = true;
  }
  if (changed) savePullStore(store);
}
