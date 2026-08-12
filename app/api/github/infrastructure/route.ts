import { NextResponse } from "next/server";
import type { InfrastructureExplorerData } from "@/components/infrastructure-types";
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

async function inBatches<T, R>(items: T[], size: number, callback: (item: T) => Promise<R>) {
  const results: R[] = [];
  for (let index = 0; index < items.length; index += size) {
    results.push(...await Promise.all(items.slice(index, index + size).map(callback)));
  }
  return results;
}

export async function GET() {
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

    if (analysisCache && analysisCache.treeSha === tree.sha && analysisCache.expires > Date.now()) {
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
