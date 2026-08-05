import { NextResponse } from "next/server";
import {
  apiError,
  githubAllPages,
  githubRequest,
  presentPull,
  presentRepo,
  RawPull,
  RawRepo,
  RawRun,
} from "@/lib/github";
import { SONIC_REPOSITORY, TEST_LAB_REPOSITORIES } from "@/lib/repository-constants";
import { trackedRepositories } from "@/lib/tracked-repositories";
import { parseUdsCommonIncludes } from "@/lib/uds-common";

export const runtime = "nodejs";

type Viewer = { login: string; name: string | null; avatar_url: string; html_url: string };
type RateLimit = {
  resources: { core: { remaining: number; limit: number; reset: number } };
};
type RunsResponse = { total_count: number; workflow_runs: RawRun[] };
type ContentResponse = { content: string; html_url: string };
type ReleaseResponse = { tag_name: string; html_url: string; body: string | null };
type CommonTasksResult = { repository: string; file: ContentResponse | null };

type SemanticVersion = { normalized: string; parts: [number, number, number] };

function semanticVersion(value: string | null): SemanticVersion | null {
  const match = value?.match(/(?:^|[^0-9])(\d+)\.(\d+)\.(\d+)(?:$|[^0-9])/);
  if (!match) return null;
  const parts: [number, number, number] = [Number(match[1]), Number(match[2]), Number(match[3])];
  return { normalized: parts.join("."), parts };
}

function compareVersions(current: SemanticVersion | null, upstream: SemanticVersion | null) {
  if (!current || !upstream) return "unknown" as const;
  for (let index = 0; index < current.parts.length; index += 1) {
    if (current.parts[index] < upstream.parts[index]) return "behind" as const;
    if (current.parts[index] > upstream.parts[index]) return "ahead" as const;
  }
  return "current" as const;
}

function pipelineFailed(conclusion: string | null | undefined) {
  return ["failure", "timed_out", "action_required", "startup_failure"].includes(conclusion ?? "");
}

function renovatePull(pull: RawPull) {
  return pull.head.ref.toLowerCase().startsWith("renovate/") && pull.user?.login.toLowerCase().includes("renovate");
}

export async function GET() {
  try {
    const tracked = trackedRepositories();
    const trackedNames = new Set(tracked.map((repository) => repository.toLowerCase()));
    const hasSonic = trackedNames.has(SONIC_REPOSITORY.toLowerCase());
    const hasTestLabRepository = TEST_LAB_REPOSITORIES.some((repository) => trackedNames.has(repository.toLowerCase()));
    const [repositories, viewer, rate] = await Promise.all([
      Promise.all(tracked.map((repository) => githubRequest<RawRepo>(`/repos/${repository}`))),
      githubRequest<Viewer>("/user", 5 * 60_000),
      githubRequest<RateLimit>("/rate_limit", 30_000),
    ]);

    const reviewRequestedForViewer = (pull: RawPull) => pull.requested_reviewers?.some(
      (reviewer) => reviewer.login.toLowerCase() === viewer.login.toLowerCase(),
    ) ?? false;

    const commonRepositories = repositories.filter((repository) => repository.full_name !== SONIC_REPOSITORY);
    const [operationalGroups, coreFile, upstreamCoreRelease, commonTaskFiles, upstreamCommonRelease, latestZarfRelease, latestPeprRelease] = await Promise.all([
      Promise.all(
        repositories.map(async (repository) => {
          const [openPulls, runs] = await Promise.all([
            githubAllPages<RawPull>(
              `/repos/${repository.full_name}/pulls?state=open&sort=updated&direction=desc`,
              10,
            ),
            githubRequest<RunsResponse>(`/repos/${repository.full_name}/actions/runs?per_page=10`).catch(() => null),
          ]);
          return {
            repository: repository.full_name,
            openPulls,
            renovatePulls: openPulls.filter(renovatePull),
            runs: runs?.workflow_runs ?? [],
          };
        }),
      ),
      hasSonic
        ? githubRequest<ContentResponse>(
            `/repos/${SONIC_REPOSITORY}/contents/bundles/swf/uds-bundle.yaml`,
            5 * 60_000,
          ).catch(() => null)
        : Promise.resolve(null),
      githubRequest<ReleaseResponse>(
        "/repos/defenseunicorns/uds-core/releases/latest",
        5 * 60_000,
      ).catch(() => null),
      Promise.all(commonRepositories.map(async (repository): Promise<CommonTasksResult> => ({
        repository: repository.full_name,
        file: await githubRequest<ContentResponse>(`/repos/${repository.full_name}/contents/tasks.yaml`, 5 * 60_000).catch(() => null),
      }))),
      githubRequest<ReleaseResponse>(
        "/repos/defenseunicorns/uds-common/releases/latest",
        5 * 60_000,
      ).catch(() => null),
      githubRequest<ReleaseResponse>(
        "/repos/zarf-dev/zarf/releases/latest",
        5 * 60_000,
      ).catch(() => null),
      githubRequest<ReleaseResponse>(
        "/repos/defenseunicorns/pepr/releases/latest",
        5 * 60_000,
      ).catch(() => null),
    ]);

    const renovatePulls = operationalGroups
      .flatMap((group) =>
        group.renovatePulls.map((pull) => ({
          ...presentPull(pull),
          repository: group.repository,
        })),
      )
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const allOpenPulls = operationalGroups
      .flatMap((group) =>
        group.openPulls.map((pull) => ({
          ...presentPull(pull),
          repository: group.repository,
        })),
      )
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    const reviewRequests = allOpenPulls.filter((pull) =>
      pull.requestedReviewers.some((reviewer) => reviewer.login.toLowerCase() === viewer.login.toLowerCase()),
    );
    const reviewRequestIds = new Set(reviewRequests.map((pull) => pull.id));
    const renovatePullIds = new Set(renovatePulls.map((pull) => pull.id));
    const unassignedRenovatePulls = renovatePulls.filter((pull) => pull.assignees.length === 0 && !reviewRequestIds.has(pull.id));
    const unassignedPullRequests = allOpenPulls.filter((pull) =>
      pull.assignees.length === 0 && !renovatePullIds.has(pull.id) && !reviewRequestIds.has(pull.id),
    );
    const operationalByRepository = new Map(
      operationalGroups.map((group) => [group.repository, group]),
    );
    const coreText = coreFile ? Buffer.from(coreFile.content, "base64").toString("utf8") : "";
    const coreVersion = coreText.match(/x-core:\s*&x-core[\s\S]{0,400}?\n\s*ref:\s*["']?([^\s"']+)/i)?.[1] ?? null;
    const trackedCoreSemver = semanticVersion(coreVersion);
    const upstreamCoreSemver = semanticVersion(upstreamCoreRelease?.tag_name ?? null);
    const upstreamCommonSemver = semanticVersion(upstreamCommonRelease?.tag_name ?? null);
    const udsCommonRepositories = commonTaskFiles.map(({ repository, file }) => {
      if (!file) {
        return { repository, tasksUrl: null, includes: [], versions: [], status: "missing" as const };
      }

      try {
        const includes = parseUdsCommonIncludes(Buffer.from(file.content, "base64").toString("utf8"));
        const versions = [...new Set(includes.flatMap((include) => include.version ? [include.version] : []))];
        const status = !includes.length
          ? "not-configured" as const
          : !upstreamCommonSemver || includes.some((include) => !include.version)
            ? "unknown" as const
            : includes.every((include) => include.version === upstreamCommonSemver.normalized)
              ? "current" as const
              : "outdated" as const;
        return { repository, tasksUrl: file.html_url, includes, versions, status };
      } catch {
        return { repository, tasksUrl: file.html_url, includes: [], versions: [], status: "unknown" as const };
      }
    });
    const udsCommonByRepository = new Map(udsCommonRepositories.map((item) => [item.repository, item]));

    repositories.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());

    const now = Date.now();
    const day = 86_400_000;
    const languages = new Map<string, number>();
    repositories.forEach((repo) => {
      if (repo.language) languages.set(repo.language, (languages.get(repo.language) ?? 0) + 1);
    });

    const activity = [
      { label: "24h", count: repositories.filter((repo) => now - new Date(repo.updated_at).getTime() <= day).length },
      { label: "7d", count: repositories.filter((repo) => now - new Date(repo.updated_at).getTime() <= 7 * day).length },
      { label: "30d", count: repositories.filter((repo) => now - new Date(repo.updated_at).getTime() <= 30 * day).length },
      { label: "90d", count: repositories.filter((repo) => now - new Date(repo.updated_at).getTime() <= 90 * day).length },
    ];

    const core = rate.resources.core;
    return NextResponse.json({
      organization: {
        login: "tracked-repositories",
        name: "Operations workspace",
        avatar: viewer.avatar_url,
        url: "https://github.com",
        description: "A focused view of the repositories used in day-to-day operations.",
      },
      viewer: { login: viewer.login, name: viewer.name, avatar: viewer.avatar_url, url: viewer.html_url },
      capabilities: {
        sonic: hasSonic,
        testLab: hasTestLabRepository,
        gitlab: hasSonic && Boolean(process.env.GITLAB_TOKEN),
      },
      metrics: {
        repositories: repositories.length,
        private: repositories.filter((repo) => repo.private).length,
        public: repositories.filter((repo) => !repo.private).length,
        archived: repositories.filter((repo) => repo.archived).length,
        forks: repositories.filter((repo) => repo.fork).length,
        openItems: repositories.reduce((total, repo) => total + repo.open_issues_count, 0),
        active30d: activity[2].count,
        renovatePulls: unassignedRenovatePulls.length,
        openPullRequests: unassignedPullRequests.length,
        issueCount: repositories.reduce((total, repository) => {
          const openPulls = operationalByRepository.get(repository.full_name)?.openPulls.length ?? 0;
          return total + Math.max(0, repository.open_issues_count - openPulls);
        }, 0),
        pipelineFailures: operationalGroups.filter((group) => pipelineFailed(group.runs[0]?.conclusion)).length,
        repositoriesRequiringAttention: operationalGroups.filter((group) =>
          pipelineFailed(group.runs[0]?.conclusion) ||
          group.openPulls.some((pull) => !pull.assignees?.length && !renovatePull(pull) && !reviewRequestedForViewer(pull)) ||
          group.renovatePulls.some((pull) => !pull.assignees?.length && !reviewRequestedForViewer(pull)) ||
          group.openPulls.some(reviewRequestedForViewer) ||
          Boolean(udsCommonByRepository.get(group.repository) && udsCommonByRepository.get(group.repository)?.status !== "current"),
        ).length,
      },
      udsCommon: {
        latestVersion: upstreamCommonSemver?.normalized ?? null,
        latestUrl: upstreamCommonRelease?.html_url ?? "https://github.com/defenseunicorns/uds-common/releases",
        latestReleaseNotes: upstreamCommonRelease?.body ?? null,
        repository: "defenseunicorns/uds-common",
        needsAttention: udsCommonRepositories.filter((item) => item.status !== "current").length,
        repositories: udsCommonRepositories,
      },
      udsCore: {
        version: coreVersion,
        repository: SONIC_REPOSITORY,
        sourcePath: "bundles/swf/uds-bundle.yaml",
        url: coreFile?.html_url ?? null,
        upstreamVersion: upstreamCoreSemver?.normalized ?? null,
        upstreamUrl: upstreamCoreRelease?.html_url ?? "https://github.com/defenseunicorns/uds-core",
        upstreamReleaseNotes: upstreamCoreRelease?.body ?? null,
        comparison: compareVersions(trackedCoreSemver, upstreamCoreSemver),
      },
      tools: {
        zarf: {
          name: "Zarf",
          repository: "zarf-dev/zarf",
          version: latestZarfRelease?.tag_name ?? null,
          url: latestZarfRelease?.html_url ?? "https://github.com/zarf-dev/zarf/releases",
        },
        pepr: {
          name: "Pepr",
          repository: "defenseunicorns/pepr",
          version: latestPeprRelease?.tag_name ?? null,
          url: latestPeprRelease?.html_url ?? "https://github.com/defenseunicorns/pepr/releases",
        },
      },
      pullRequests: allOpenPulls,
      unassignedPullRequests,
      reviewRequests,
      renovate: {
        total: renovatePulls.length,
        unassignedTotal: unassignedRenovatePulls.length,
        pulls: renovatePulls,
      },
      activity,
      languages: [...languages.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count),
      repositories: repositories.map((repository) => {
        const operational = operationalByRepository.get(repository.full_name);
        const latestRun = operational?.runs[0] ?? null;
        const openPulls = operational?.openPulls.length ?? 0;
        const unassignedPulls = operational?.openPulls.filter((pull) =>
          !pull.assignees?.length && !renovatePull(pull) && !reviewRequestedForViewer(pull),
        ).length ?? 0;
        const renovateCount = operational?.renovatePulls.length ?? 0;
        const unassignedRenovateCount = operational?.renovatePulls.filter((pull) =>
          !pull.assignees?.length && !reviewRequestedForViewer(pull),
        ).length ?? 0;
        const reviewRequestCount = operational?.openPulls.filter(reviewRequestedForViewer).length ?? 0;
        const issueCount = Math.max(0, repository.open_issues_count - openPulls);
        const udsCommon = udsCommonByRepository.get(repository.full_name) ?? null;
        const requiresAttention = pipelineFailed(latestRun?.conclusion) || unassignedPulls > 0 || unassignedRenovateCount > 0 || reviewRequestCount > 0 || Boolean(udsCommon && udsCommon.status !== "current");
        return {
          ...presentRepo(repository),
          openPullRequests: openPulls,
          unassignedPullRequests: unassignedPulls,
          issueCount,
          renovatePulls: renovateCount,
          unassignedRenovatePulls: unassignedRenovateCount,
          reviewRequests: reviewRequestCount,
          udsCommon: udsCommon ? { status: udsCommon.status, versions: udsCommon.versions } : null,
          health: requiresAttention ? "attention" : latestRun ? "healthy" : "unknown",
          pipeline: latestRun
            ? {
                name: latestRun.name,
                status: latestRun.status,
                conclusion: latestRun.conclusion,
                url: latestRun.html_url,
                updatedAt: latestRun.updated_at,
              }
            : null,
        };
      }),
      rateLimit: {
        remaining: core.remaining,
        limit: core.limit,
        resetsAt: new Date(core.reset * 1000).toISOString(),
      },
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    const failure = apiError(error);
    return NextResponse.json({ error: failure.message }, { status: failure.status });
  }
}
