import "server-only";

import { loadAll } from "js-yaml";
import { githubGraphQL, githubRequest, type RawRepo } from "@/lib/github";
import type { ZarfChart, ZarfComponent, ZarfPackage } from "@/components/security-types";

type GitTreeItem = { path: string; mode: string; type: "blob" | "tree"; sha: string; size?: number };
type GitTree = { sha: string; truncated: boolean; tree: GitTreeItem[] };
type ContentFile = { content: string; encoding: string; html_url: string; size: number; sha: string };
type UnknownRecord = Record<string, unknown>;

export type RepositorySecuritySource = {
  repository: string;
  defaultBranch: string;
  revision: string;
  tree: GitTreeItem[];
  truncated: boolean;
  packages: ZarfPackage[];
};

function record(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : null;
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function pathUrl(repository: string, branch: string, path: string) {
  return `https://github.com/${repository}/blob/${encodeURIComponent(branch).replace(/%2F/g, "/")}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

function contentPath(path: string) {
  return path.split("/").map(encodeURIComponent).join("/");
}

async function readYamlBlobs(repository: string, branch: string, paths: string[]) {
  const [owner, name] = repository.split("/");
  const batches: Array<{ path: string; text: string }[]> = [];
  for (let offset = 0; offset < paths.length; offset += 50) {
    const batch = paths.slice(offset, offset + 50);
    const variableDefinitions = batch.map((_, index) => `$expression${index}: String!`).join(", ");
    const fields = batch.map((_, index) => `file${index}: object(expression: $expression${index}) { ... on Blob { text byteSize isBinary } }`).join("\n");
    const query = `query SecurityYaml($owner: String!, $name: String!, ${variableDefinitions}) { repository(owner: $owner, name: $name) { ${fields} } }`;
    const variables = Object.fromEntries(batch.map((path, index) => [`expression${index}`, `${branch}:${path}`]));
    const result = await githubGraphQL<{ repository: Record<string, { text: string | null; byteSize: number; isBinary: boolean } | null> | null }>(query, { owner, name, ...variables }, 30 * 60_000);
    if (!result.repository) throw new Error(`GitHub did not return repository content for ${repository}.`);
    batches.push(batch.flatMap((path, index) => {
      const blob = result.repository?.[`file${index}`];
      return blob && !blob.isBinary && typeof blob.text === "string" ? [{ path, text: blob.text }] : [];
    }));
  }
  return batches.flat();
}

function charts(value: unknown): ZarfChart[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    const chart = record(candidate);
    if (!chart) return [];
    const name = text(chart.name);
    if (!name) return [];
    return [{ name, version: text(chart.version), url: text(chart.url), localPath: text(chart.localPath) }];
  });
}

function parsePackage(repository: string, branch: string, path: string, htmlUrl: string, input: string): ZarfPackage[] {
  const documents: unknown[] = [];
  try {
    loadAll(input, (document) => documents.push(document));
  } catch {
    return [];
  }

  return documents.flatMap((document, documentIndex) => {
    const root = record(document);
    if (!root || text(root.kind) !== "ZarfPackageConfig") return [];
    const metadata = record(root.metadata) ?? {};
    const name = text(metadata.name) ?? path.split("/").at(-2) ?? "zarf-package";
    const packageId = `${repository}:${path}:${documentIndex}`;
    const parsedComponents: ZarfComponent[] = Array.isArray(root.components) ? root.components.flatMap((candidate, componentIndex) => {
      const component = record(candidate);
      const componentName = text(component?.name);
      if (!component || !componentName) return [];
      const only = record(component.only);
      const flavorValue = only?.flavor;
      const flavor = text(flavorValue) ?? (Array.isArray(flavorValue) ? flavorValue.map(text).filter(Boolean).join(", ") || null : null);
      const imageReferences = Array.isArray(component.images)
        ? component.images.map(text).filter((image): image is string => Boolean(image) && !image!.includes("{{") && !image!.includes("${"))
        : [];
      return [{
        id: `${packageId}:${componentName}:${flavor ?? "default"}:${componentIndex}`,
        name: componentName,
        flavor,
        packageId,
        charts: charts(component.charts),
        imageReferences: [...new Set(imageReferences)],
      }];
    }) : [];

    return [{
      id: packageId,
      name,
      description: text(metadata.description),
      version: text(metadata.version),
      sourcePath: path,
      sourceUrl: htmlUrl || pathUrl(repository, branch, path),
      upstreamUrl: text(metadata.url),
      components: parsedComponents,
    }];
  });
}

export async function loadRepositorySecurityTree(repository: string): Promise<Omit<RepositorySecuritySource, "packages">> {
  const details = await githubRequest<RawRepo>(`/repos/${repository}`, 5 * 60_000);
  const tree = await githubRequest<GitTree>(`/repos/${repository}/git/trees/${encodeURIComponent(details.default_branch)}?recursive=1`, 30 * 60_000);
  return { repository, defaultBranch: details.default_branch, revision: tree.sha, tree: tree.tree, truncated: tree.truncated };
}

export async function discoverZarfPackages(repository: string, existingSource?: Omit<RepositorySecuritySource, "packages">): Promise<RepositorySecuritySource> {
  const source = existingSource ?? await loadRepositorySecurityTree(repository);
  if (source.truncated) {
    throw new Error("GitHub returned a truncated repository tree, so Scout could not complete content-based Zarf discovery.");
  }
  const paths = source.tree.filter((item) => item.type === "blob" && /\.ya?ml$/i.test(item.path) && (item.size ?? 0) <= 1_000_000).map((item) => item.path).sort();
  const files = await readYamlBlobs(repository, source.defaultBranch, paths);
  return {
    ...source,
    packages: files.flatMap((file) => parsePackage(repository, source.defaultBranch, file.path, pathUrl(repository, source.defaultBranch, file.path), file.text)),
  };
}

export async function readRepositoryJson(repository: string, branch: string, path: string) {
  const file = await githubRequest<ContentFile>(`/repos/${repository}/contents/${contentPath(path)}?ref=${encodeURIComponent(branch)}`, 30 * 60_000);
  if (file.encoding !== "base64" || file.size > 20_000_000) throw new Error("Repository SBOM is too large to inspect safely.");
  return JSON.parse(Buffer.from(file.content, "base64").toString("utf8")) as unknown;
}
