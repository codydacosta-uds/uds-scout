import { NextRequest, NextResponse } from "next/server";
import { apiError, githubMutation, githubRequest } from "@/lib/github";
import { SONIC_REPOSITORY } from "@/lib/repository-constants";
import { isTrackedRepository } from "@/lib/tracked-repositories";

export const runtime = "nodejs";
const VALID_FLAVORS = ["upstream", "registry1", "unicorn"] as const;
type Flavor = (typeof VALID_FLAVORS)[number];
type GithubRef = { object?: { sha?: string } };
type GithubContent = { content?: string; encoding?: string; sha?: string };
type GithubPull = { number: number; html_url: string; title: string };
type Update = { packageName: string; packageRepository: string; sourceFile: string; sourceLine: number; currentVersion: string; nextVersion: string; flavor: Flavor; architecture: string };

function sameOrigin(request: NextRequest) { const origin = request.headers.get("origin"); if (!origin) return true; try { return new URL(origin).host === request.headers.get("host"); } catch { return false; } }
function validRepository(value: string) { return /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(value); }
function safePart(value: string) { return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 42); }
function decode(content: string, encoding?: string) { return encoding === "base64" ? Buffer.from(content.replace(/\s/g, ""), "base64").toString("utf8") : content; }
function escapeRegExp(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function replacePackageRef(source: string, update: Update) {
  const lines = source.split("\n");
  const repositoryPattern = new RegExp(`^([ \\t]*repository:\\s*["']?)${escapeRegExp(update.packageRepository)}(["']?\\s*)$`);
  const refPattern = new RegExp(`^(\\s*ref:\\s*["']?)${escapeRegExp(update.currentVersion)}(["']?\\s*)$`);
  let matches = 0;
  const startIndex = update.sourceLine > 0 ? Math.max(0, update.sourceLine - 2) : 0;
  const endIndex = update.sourceLine > 0 ? Math.min(lines.length - 1, update.sourceLine + 2) : lines.length - 1;
  for (let index = startIndex; index <= endIndex; index += 1) {
    if (!repositoryPattern.test(lines[index])) continue;
    for (let next = index + 1; next <= Math.min(index + 4, lines.length - 1); next += 1) {
      const match = lines[next].match(refPattern);
      if (match) { lines[next] = `${match[1]}${update.nextVersion}${match[2]}`; matches += 1; break; }
      if (/^\s*repository:/.test(lines[next])) break;
    }
  }
  return { content: lines.join("\n"), matches };
}
function parseUpdate(value: unknown): Update | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const text = (key: string) => typeof item[key] === "string" ? (item[key] as string).trim() : "";
  const flavor = text("flavor");
  const sourceLine = Number(item.sourceLine);
  const update = { packageName: text("packageName"), packageRepository: text("packageRepository"), sourceFile: text("sourceFile"), sourceLine, currentVersion: text("currentVersion"), nextVersion: text("nextVersion"), flavor: flavor as Flavor, architecture: text("architecture") || "amd64" };
  if (!Number.isInteger(update.sourceLine) || update.sourceLine < 1 || !/^[a-zA-Z0-9._-]+$/.test(update.packageName) || !/^registry\.defenseunicorns\.com\/[a-zA-Z0-9._/-]+$/.test(update.packageRepository) || !update.sourceFile.startsWith("bundles/swf/") || update.sourceFile.includes("..") || !/^[a-zA-Z0-9][a-zA-Z0-9._+\-]*$/.test(update.currentVersion) || !/^[a-zA-Z0-9][a-zA-Z0-9._+\-]*$/.test(update.nextVersion) || update.currentVersion === update.nextVersion || !VALID_FLAVORS.includes(update.flavor) || !/^[a-zA-Z0-9_.-]+$/.test(update.architecture)) return null;
  if (!new RegExp(`-${update.flavor}(?:$|[-.])`, "i").test(update.currentVersion) || !new RegExp(`-${update.flavor}(?:$|[-.])`, "i").test(update.nextVersion)) return null;
  return update;
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Cross-origin GitHub changes are not allowed." }, { status: 403 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "The update request must be valid JSON." }, { status: 400 }); }
  const candidate = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const repository = typeof candidate.repository === "string" ? candidate.repository.trim() : "";
  const rawUpdates = Array.isArray(candidate.updates) ? candidate.updates : [candidate];
  const updates = rawUpdates.map(parseUpdate).filter((item): item is Update => Boolean(item));
  if (repository !== SONIC_REPOSITORY || !isTrackedRepository(repository) || !validRepository(repository) || updates.length !== rawUpdates.length || updates.length === 0 || updates.length > 25) return NextResponse.json({ error: "Choose valid SONIC package updates from the current bundle." }, { status: 400 });
  const uniqueUpdates = new Map<string, Update>();
  for (const update of updates) {
    const key = `${update.sourceFile}:${update.sourceLine}:${update.packageRepository}:${update.currentVersion}:${update.flavor}`;
    const existing = uniqueUpdates.get(key);
    if (existing && existing.nextVersion !== update.nextVersion) return NextResponse.json({ error: "The selected package references request conflicting versions." }, { status: 400 });
    uniqueUpdates.set(key, existing ?? update);
  }
  try {
    const viewer = await githubRequest<{ login: string }>("/user", 0);
    const base = await githubRequest<GithubRef>(`/repos/${SONIC_REPOSITORY}/git/ref/heads/main`, 0);
    const baseSha = base.object?.sha;
    if (!baseSha) return NextResponse.json({ error: "Could not resolve the current SONIC main branch." }, { status: 502 });
    const files = new Map<string, { content: string; sha: string }>();
    for (const update of updates) {
      if (files.has(update.sourceFile)) continue;
      const file = await githubRequest<GithubContent>(`/repos/${SONIC_REPOSITORY}/contents/${update.sourceFile}?ref=main`, 0);
      if (!file.content || !file.sha) return NextResponse.json({ error: `The SONIC source ${update.sourceFile} could not be read.` }, { status: 502 });
      files.set(update.sourceFile, { content: decode(file.content, file.encoding), sha: file.sha });
    }
    for (const update of uniqueUpdates.values()) {
      const file = files.get(update.sourceFile)!;
      const replacement = replacePackageRef(file.content, update);
      if (replacement.matches !== 1) return NextResponse.json({ error: `The SONIC bundle changed or ${update.packageName} could not be matched exactly. Refresh and try again.` }, { status: 409 });
      file.content = replacement.content;
    }
    const scoutLabel = await githubRequest(`/repos/${SONIC_REPOSITORY}/labels/scout`, 0).catch(() => null);
    if (!scoutLabel) await githubMutation(`/repos/${SONIC_REPOSITORY}/labels`, "POST", { name: "scout", color: "6e7781", description: "Human-triggered package update" });
    const slug = updates.length === 1 ? `${safePart(updates[0].packageName)}-${safePart(updates[0].nextVersion)}` : `packages-${safePart(updates.map((update) => update.packageName).slice(0, 3).join("-"))}`;
    const branch = `chore/sonic-${slug}`;
    if (await githubRequest<unknown>(`/repos/${SONIC_REPOSITORY}/git/ref/heads/${encodeURIComponent(branch)}`, 0).then(() => true).catch(() => false)) return NextResponse.json({ error: "A branch already exists for this update set. Review it in GitHub before trying again." }, { status: 409 });
    const existing = await githubRequest<GithubPull[]>(`/repos/${SONIC_REPOSITORY}/pulls?state=open&head=${encodeURIComponent(`${viewer.login}:${branch}`)}&per_page=10`, 0).catch(() => []);
    if (existing.length) return NextResponse.json({ error: "An update pull request already exists for this update set.", pullRequest: existing[0] }, { status: 409 });
    await githubMutation(`/repos/${SONIC_REPOSITORY}/git/refs`, "POST", { ref: `refs/heads/${branch}`, sha: baseSha });
    const commitMessage = updates.length === 1 ? `chore(deps): update SONIC ${updates[0].packageName} package` : "chore(deps): update SONIC packages";
    for (const [sourceFile, file] of files) await githubMutation(`/repos/${SONIC_REPOSITORY}/contents/${sourceFile}`, "PUT", { message: commitMessage, content: Buffer.from(file.content, "utf8").toString("base64"), branch, sha: file.sha });
    const rows = updates.map((update) => `| ${update.packageRepository} | package update | \`${update.currentVersion}\` → \`${update.nextVersion}\` |`).join("\n");
    const filesText = [...files.keys()].map((file) => `[${file}](https://github.com/${SONIC_REPOSITORY}/blob/main/${file})`).join(", ");
    const bodyText = `This updates ${updates.length === 1 ? `the SONIC ${updates[0].packageName} package` : "SONIC packages"} for the selected bundle flavors.\n\n| Package | Update | Change |\n|---|---|---|\n${rows}\n\nSource: ${filesText}`;
    const pull = await githubMutation<GithubPull>(`/repos/${SONIC_REPOSITORY}/pulls`, "POST", { title: commitMessage, head: branch, base: "main", body: bodyText });
    await githubMutation(`/repos/${SONIC_REPOSITORY}/issues/${pull.number}/labels`, "POST", { labels: ["scout"] });
    return NextResponse.json({ pullRequest: { number: pull.number, url: pull.html_url, title: pull.title } });
  } catch (error) {
    const detail = apiError(error);
    const message = detail.status === 403 ? "GitHub did not allow this change. The token needs contents, pull requests, and issues write permission for the SONIC repository." : detail.status === 404 ? "GitHub could not find the SONIC source or required label." : detail.message;
    return NextResponse.json({ error: message }, { status: detail.status });
  }
}
