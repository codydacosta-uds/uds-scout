import { githubRequest } from "@/lib/github";

export type RenovateAutomergeStatus = {
  status: "enabled" | "disabled" | "not-configured" | "unknown";
  source: string | null;
  detail: string;
};

type GithubContent = { content?: string; encoding?: string; html_url?: string };

const CONFIG_PATHS = ["renovate.json", ".renovaterc", ".github/renovate.json"] as const;

function decodeContent(content: string, encoding?: string) {
  if (encoding === "base64") return Buffer.from(content.replace(/\s/g, ""), "base64").toString("utf8");
  return content;
}

function hasAutomergeRule(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const config = value as { automerge?: unknown; packageRules?: unknown };
  if (config.automerge === true) return true;
  if (!Array.isArray(config.packageRules)) return false;
  return config.packageRules.some((rule) => hasAutomergeRule(rule));
}

function hasExplicitDisabledRule(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const config = value as { automerge?: unknown; packageRules?: unknown };
  if (config.automerge === false) return true;
  if (!Array.isArray(config.packageRules)) return false;
  return config.packageRules.some((rule) => hasExplicitDisabledRule(rule));
}

export async function renovateAutomergeStatus(repository: string): Promise<RenovateAutomergeStatus> {
  for (const path of CONFIG_PATHS) {
    const file = await githubRequest<GithubContent>(`/repos/${repository}/contents/${path}`, 5 * 60_000).catch(() => null);
    if (!file?.content) continue;
    try {
      const config = JSON.parse(decodeContent(file.content, file.encoding)) as unknown;
      if (hasAutomergeRule(config)) return { status: "enabled", source: file.html_url ?? null, detail: `Enabled in ${path}.` };
      if (hasExplicitDisabledRule(config)) return { status: "disabled", source: file.html_url ?? null, detail: `Disabled in ${path}.` };
      return { status: "disabled", source: file.html_url ?? null, detail: `No automerge rule is enabled in ${path}.` };
    } catch {
      return { status: "unknown", source: file.html_url ?? null, detail: `Could not parse ${path}.` };
    }
  }
  return { status: "not-configured", source: null, detail: "No Renovate configuration file was found." };
}
