import { githubRequest } from "@/lib/github";

export type RenovateConfigOrigin = "repository" | "shared" | "unknown";
export type RenovateCapability = { status: "enabled" | "disabled" | "not-configured" | "unknown"; origin: RenovateConfigOrigin; source: string | null; detail: string };
export type RenovateAutomergeStatus = RenovateCapability & { updateTypes: string[] };
export type RenovateHealth = {
  configSource: string | null;
  configPath: string | null;
  sharedPreset: { repository: string; path: string; source: string | null } | null;
  automerge: RenovateAutomergeStatus;
  dependencyDashboard: RenovateCapability;
  grouping: RenovateCapability;
  schedule: RenovateCapability;
  concurrency: RenovateCapability;
  lockFileMaintenance: RenovateCapability;
  releaseAge: RenovateCapability;
  digestPinning: RenovateCapability;
  labels: RenovateCapability;
  localOverrides: string[];
};

type GithubContent = { content?: string; encoding?: string; html_url?: string };
type JsonObject = Record<string, unknown>;
const CONFIG_PATHS = ["renovate.json", ".renovaterc", ".github/renovate.json"] as const;

function decodeContent(content: string, encoding?: string) {
  if (encoding === "base64") return Buffer.from(content.replace(/\s/g, ""), "base64").toString("utf8");
  return content;
}

function stripJson5Comments(value: string) {
  let output = "";
  let quote: string | null = null;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    const next = value[index + 1];
    if (quote) {
      output += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") { quote = character; output += character === "'" ? '"' : character; continue; }
    if (character === "/" && next === "/") { while (index < value.length && value[index] !== "\n") index += 1; output += "\n"; continue; }
    if (character === "/" && next === "*") { index += 2; while (index < value.length && !(value[index] === "*" && value[index + 1] === "/")) index += 1; index += 1; continue; }
    output += character;
  }
  return output.replace(/,\s*([}\]])/g, "$1");
}

function parseConfig(content: string) {
  try { return JSON.parse(stripJson5Comments(content)) as JsonObject; } catch { return null; }
}

function asObject(value: unknown): JsonObject | null { return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null; }
function asArray(value: unknown) { return Array.isArray(value) ? value : []; }
function strings(value: unknown) { return asArray(value).filter((item): item is string => typeof item === "string"); }
function rules(config: JsonObject) { return asArray(config.packageRules).map(asObject).filter((rule): rule is JsonObject => Boolean(rule)); }
function sourceCapability(status: RenovateCapability["status"], origin: RenovateConfigOrigin, source: string | null, detail: string): RenovateCapability { return { status, origin, source, detail }; }
function sourceFor(origin: RenovateConfigOrigin, localSource: string | null, sharedSource: string | null) { return origin === "repository" ? localSource : origin === "shared" ? sharedSource : null; }

function inheritedPreset(extendsValues: string[]) {
  const preset = extendsValues.find((value) => value.startsWith("github>"));
  const match = preset?.match(/^github>([^/]+\/[^/]+)\/\/(.+)$/);
  return match ? { repository: match[1], path: match[2] } : null;
}

function boolCapability(config: JsonObject | null, shared: JsonObject | null, key: string, label: string, localSource: string | null, sharedSource: string | null): RenovateCapability {
  const local = config?.[key];
  if (typeof local === "boolean") return sourceCapability(local ? "enabled" : "disabled", "repository", localSource, `${label} is ${local ? "enabled" : "disabled"} in the repository configuration.`);
  const inherited = shared?.[key];
  if (typeof inherited === "boolean") return sourceCapability(inherited ? "enabled" : "disabled", "shared", sharedSource, `${label} is inherited from the shared preset.`);
  return sourceCapability("not-configured", "unknown", null, `${label} is not explicitly configured.`);
}

function findConfig(config: JsonObject | null, shared: JsonObject | null, key: string, label: string, localSource: string | null, sharedSource: string | null): RenovateCapability {
  if (config && config[key] !== undefined) return sourceCapability("enabled", "repository", localSource, `${label} is configured in this repository.`);
  if (shared && shared[key] !== undefined) return sourceCapability("enabled", "shared", sharedSource, `${label} is inherited from the shared preset.`);
  return sourceCapability("not-configured", "unknown", null, `${label} is not configured.`);
}

function analyzeAutomerge(config: JsonObject | null, shared: JsonObject | null, localSource: string | null, sharedSource: string | null): RenovateAutomergeStatus {
  const localRules = config ? rules(config) : [];
  const sharedRules = shared ? rules(shared) : [];
  const enabledRule = [...localRules.map((rule) => ({ rule, origin: "repository" as const })), ...sharedRules.map((rule) => ({ rule, origin: "shared" as const }))].find(({ rule }) => rule.automerge === true);
  if (enabledRule) {
    const updateTypes = strings(enabledRule.rule.matchUpdateTypes);
    return { ...sourceCapability("enabled", enabledRule.origin, sourceFor(enabledRule.origin, localSource, sharedSource), `Automerge is enabled${updateTypes.length ? ` for ${updateTypes.join(", ")} updates` : ""}.`), updateTypes };
  }
  const disabledRule = [...localRules, ...sharedRules].find((rule) => rule.automerge === false);
  if (disabledRule) return { ...sourceCapability("disabled", localRules.includes(disabledRule) ? "repository" : "shared", localRules.includes(disabledRule) ? localSource : sharedSource, "Automerge is explicitly disabled."), updateTypes: [] };
  return { ...sourceCapability("not-configured", "unknown", null, "No automerge rule was found."), updateTypes: [] };
}

export async function renovateHealth(repository: string): Promise<RenovateHealth> {
  let config: JsonObject | null = null;
  let localSource: string | null = null;
  let configPath: string | null = null;
  for (const path of CONFIG_PATHS) {
    const file = await githubRequest<GithubContent>(`/repos/${repository}/contents/${path}`, 5 * 60_000).catch(() => null);
    if (!file?.content) continue;
    configPath = path;
    localSource = file.html_url ?? null;
    config = parseConfig(decodeContent(file.content, file.encoding));
    break;
  }
  const extendsValues = config ? strings(config.extends) : [];
  const preset = inheritedPreset(extendsValues);
  let shared: JsonObject | null = null;
  let sharedSource: string | null = null;
  if (preset) {
    const file = await githubRequest<GithubContent>(`/repos/${preset.repository}/contents/${preset.path}`, 5 * 60_000).catch(() => null);
    if (file?.content) { shared = parseConfig(decodeContent(file.content, file.encoding)); sharedSource = file.html_url ?? null; }
  }
  const localRules = config ? rules(config) : [];
  const sharedRules = shared ? rules(shared) : [];
  const hasGroupedRules = localRules.some((rule) => rule.groupName || rule.groupAll) || sharedRules.some((rule) => rule.groupName || rule.groupAll) || extendsValues.some((value) => value.includes("group:all"));
  const hasDigestPinning = extendsValues.some((value) => value.includes("helpers:pinGitHubActionDigests")) || strings(shared?.extends).some((value) => value.includes("helpers:pinGitHubActionDigests"));
  const localOverrides = config ? Object.keys(config).filter((key) => shared?.[key] !== undefined) : [];
  return {
    configSource: localSource, configPath, sharedPreset: preset ? { ...preset, source: sharedSource } : null,
    automerge: analyzeAutomerge(config, shared, localSource, sharedSource),
    dependencyDashboard: boolCapability(config, shared, "dependencyDashboard", "Dependency Dashboard", localSource, sharedSource),
    grouping: sourceCapability(hasGroupedRules ? "enabled" : "not-configured", hasGroupedRules && (localRules.some((rule) => rule.groupName || rule.groupAll) || extendsValues.some((value) => value.includes("group:all"))) ? "repository" : "shared", hasGroupedRules ? sourceFor(localRules.some((rule) => rule.groupName || rule.groupAll) || extendsValues.some((value) => value.includes("group:all")) ? "repository" : "shared", localSource, sharedSource) : null, hasGroupedRules ? "Dependency grouping is configured." : "No dependency grouping rule was found."),
    schedule: findConfig(config, shared, "schedule", "Update schedule", localSource, sharedSource),
    concurrency: findConfig(config, shared, "prConcurrentLimit", "PR concurrency limit", localSource, sharedSource),
    lockFileMaintenance: findConfig(config, shared, "lockFileMaintenance", "Lock file maintenance", localSource, sharedSource),
    releaseAge: sourceCapability((shared && sharedRules.some((rule) => rule.minimumReleaseAge)) || (config && localRules.some((rule) => rule.minimumReleaseAge)) ? "enabled" : "not-configured", config && localRules.some((rule) => rule.minimumReleaseAge) ? "repository" : "shared", config && localRules.some((rule) => rule.minimumReleaseAge) ? localSource : sharedSource, "Release-age controls are configured."),
    digestPinning: sourceCapability(hasDigestPinning ? "enabled" : "not-configured", extendsValues.some((value) => value.includes("helpers:pinGitHubActionDigests")) ? "repository" : "shared", hasDigestPinning ? sourceFor(extendsValues.some((value) => value.includes("helpers:pinGitHubActionDigests")) ? "repository" : "shared", localSource, sharedSource) : null, hasDigestPinning ? "GitHub Action digest pinning is configured." : "Digest pinning was not detected."),
    labels: findConfig(config, shared, "addLabels", "Update labels", localSource, sharedSource),
    localOverrides,
  };
}

export async function renovateAutomergeStatus(repository: string) {
  return (await renovateHealth(repository)).automerge;
}
