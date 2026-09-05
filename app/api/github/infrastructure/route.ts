import { NextResponse } from "next/server";
import type { InfrastructureExplorerData, UdsPackage } from "@/components/infrastructure-types";
import { apiError, githubRequest } from "@/lib/github";
import { SONIC_REPOSITORY } from "@/lib/repository-constants";
import { analyzeSonicDeployment } from "@/lib/sonic-deployment";
import { analyzeTerraform } from "@/lib/terraform-explorer";
import { isTrackedRepository } from "@/lib/tracked-repositories";

export const runtime = "nodejs";

const REPOSITORY = SONIC_REPOSITORY;
const BRANCH = "main";
const ROOT_PATH = "iac/swf";
const ANALYSIS_TTL = 5 * 60_000;

type TreeEntry = {
  path: string;
  type: "blob" | "tree";
  sha: string;
  size?: number;
};

type TreeResponse = {
  sha: string;
  tree: TreeEntry[];
  truncated: boolean;
};

type BlobResponse = {
  content: string;
  encoding: "base64";
};

let analysisCache: { treeSha: string; expires: number; value: InfrastructureExplorerData } | null = null;

type Release = { tag_name: string; draft: boolean; prerelease?: boolean };
type Tag = { name: string };

function packageSourceRepository(packageName: string) {
  if (packageName === "core") return "defenseunicorns/uds-core";
  if (packageName === "uds-ui") return "defenseunicorns/uds-ui";
  return `uds-packages/${packageName}`;
}

function versionParts(value: string | null) {
  const match = value?.match(/(?:^|[^0-9])(\d+)\.(\d+)\.(\d+)(?:$|[^0-9])/);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

function compareVersions(left: string, right: string) {
  const a = versionParts(left) ?? [0, 0, 0];
  const b = versionParts(right) ?? [0, 0, 0];
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

async function latestPackageVersion(item: UdsPackage): Promise<UdsPackage> {
  if (!item.version || !item.repository?.startsWith("registry.defenseunicorns.com/")) return { ...item, latestVersion: null, latestReleaseUrl: null, latestRegistryUrl: null, updateStatus: "unknown" };
  const registryPath = item.repository.slice("registry.defenseunicorns.com/".length);
  const packageName = registryPath.split("/").at(-1);
  if (!packageName) return { ...item, latestVersion: null, latestReleaseUrl: null, latestRegistryUrl: null, updateStatus: "unknown" };
  try {
    const sourceRepository = packageSourceRepository(packageName);
    const [releases, tags] = await Promise.all([
      githubRequest<Release[]>(`/repos/${sourceRepository}/releases?per_page=100`, 15 * 60_000).catch(() => []),
      githubRequest<Tag[]>(`/repos/${sourceRepository}/tags?per_page=100`, 15 * 60_000).catch(() => []),
    ]);
    const flavor = item.flavor ?? item.version.match(/-(upstream|registry1|unicorn)(?:$|[-.])/i)?.[1];
    const candidateNames = [...new Set([...releases.filter((release) => !release.draft && !release.prerelease).map((release) => release.tag_name), ...tags.map((tag) => tag.name)])];
    const sourceRelease = sourceRepository.startsWith("defenseunicorns/");
    const candidates = candidateNames.filter((name) => versionParts(name) && (sourceRelease || !flavor || new RegExp(`-${flavor}(?:$|[-.])`, "i").test(name)));
    const latestSourceVersion = candidates.sort((left, right) => compareVersions(right, left))[0] ?? null;
    const latestVersion = latestSourceVersion && sourceRelease && flavor ? `${latestSourceVersion.replace(/^v/i, "")}-${flavor}` : latestSourceVersion;
    const architecture = item.architecture ?? "amd64";
    const latestReleaseUrl = latestSourceVersion ? `https://github.com/${sourceRepository}/releases/tag/${encodeURIComponent(latestSourceVersion)}` : null;
    const latestRegistryUrl = latestVersion ? `https://registry.defenseunicorns.com/repo/${registryPath.split("/").map(encodeURIComponent).join("/")}/overview/${encodeURIComponent(`${latestVersion}-${architecture}`)}` : null;
    return { ...item, latestVersion, latestReleaseUrl, latestRegistryUrl, updateStatus: latestVersion ? compareVersions(latestVersion, item.version) > 0 ? "update-available" : "current" : "unknown" };
  } catch {
    return { ...item, latestVersion: null, latestReleaseUrl: null, latestRegistryUrl: null, updateStatus: "unknown" };
  }
}

async function enrichPackageVersions(packages: UdsPackage[]) {
  return Promise.all(packages.map(latestPackageVersion));
}

async function inBatches<T, R>(items: T[], size: number, callback: (item: T) => Promise<R>) {
  const results: R[] = [];
  for (let index = 0; index < items.length; index += size) {
    results.push(...await Promise.all(items.slice(index, index + size).map(callback)));
  }
  return results;
}

export async function GET(request?: Request) {
  const forced = request ? ["1", "true"].includes(new URL(request.url).searchParams.get("refresh") ?? "") : false;
  if (!isTrackedRepository(REPOSITORY)) {
    return NextResponse.json({ error: "Infrastructure Explorer is available only when the SONIC repository is selected in this workspace." }, { status: 403 });
  }

  try {
    const tree = await githubRequest<TreeResponse>(
      `/repos/${REPOSITORY}/git/trees/${BRANCH}?recursive=1`,
      ANALYSIS_TTL,
    );

    if (tree.truncated) {
      return NextResponse.json({ error: "The GitHub file tree was truncated before Terraform analysis could complete." }, { status: 502 });
    }

    if (!forced && analysisCache && analysisCache.treeSha === tree.sha && analysisCache.expires > Date.now()) {
      return NextResponse.json(analysisCache.value);
    }

    const terraformEntries = tree.tree.filter((entry) =>
      entry.type === "blob" &&
      entry.path.startsWith(`${ROOT_PATH}/`) &&
      entry.path.endsWith(".tf"),
    );

    const metadataPaths = [
      "tasks.yaml",
      "tasks/main.yaml",
      "tasks/swf.yaml",
      "tasks/utility.yaml",
      "bundles/swf/uds-bundle.yaml",
      "iac/swf/uds-config.tf",
      "docs/00-overview/deploy-flow.md",
      "docs/00-overview/environments.md",
    ];
    const metadataEntries = metadataPaths
      .map((path) => tree.tree.find((entry) => entry.type === "blob" && entry.path === path))
      .filter((entry): entry is TreeEntry => Boolean(entry));

    const [files, metadataFiles] = await Promise.all([
      inBatches(terraformEntries, 8, async (entry) => {
        const blob = await githubRequest<BlobResponse>(`/repos/${REPOSITORY}/git/blobs/${entry.sha}`, ANALYSIS_TTL);
        return {
          path: entry.path.slice(ROOT_PATH.length + 1),
          content: Buffer.from(blob.content.replace(/\n/g, ""), blob.encoding).toString("utf8"),
        };
      }),
      inBatches(metadataEntries, 8, async (entry) => {
        const blob = await githubRequest<BlobResponse>(`/repos/${REPOSITORY}/git/blobs/${entry.sha}`, ANALYSIS_TTL);
        return {
          path: entry.path,
          content: Buffer.from(blob.content.replace(/\n/g, ""), blob.encoding).toString("utf8"),
        };
      }),
    ]);

    const environments = [...new Set(
      tree.tree
        .map((entry) => entry.path.match(/^iac\/env\/([^/]+)\/tfvars\/swf\.terraform\.tfvars$/)?.[1])
        .filter((environment): environment is string => Boolean(environment)),
    )].sort();

    const infrastructure = await analyzeTerraform({
      repository: REPOSITORY,
      branch: BRANCH,
      sourceRevision: tree.sha,
      rootPath: ROOT_PATH,
      files,
      environments,
    });
    const analysis: InfrastructureExplorerData = {
      ...infrastructure,
      deployment: analyzeSonicDeployment({
        repository: REPOSITORY,
        branch: BRANCH,
        files: metadataFiles,
        nodes: infrastructure.nodes,
        detectedEnvironments: environments,
      }),
    };
    analysis.deployment.packages = await enrichPackageVersions(analysis.deployment.packages);

    analysisCache = {
      treeSha: tree.sha,
      expires: Date.now() + ANALYSIS_TTL,
      value: analysis,
    };

    return NextResponse.json(analysis);
  } catch (error) {
    const failure = apiError(error);
    return NextResponse.json({ error: failure.message }, { status: failure.status });
  }
}
