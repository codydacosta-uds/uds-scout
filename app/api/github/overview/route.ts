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
import { loadRepositoryOperations, type RecentMergedPull } from "@/lib/github-operations";
import { gitlabRequest, gitlabTokenStatus, type GitlabViewer } from "@/lib/gitlab";
import { readLocalSettings } from "@/lib/local-settings";
import { SONIC_REPOSITORY, TEST_LAB_ENABLED, TEST_LAB_REPOSITORIES } from "@/lib/repository-constants";
import { DEFAULT_RENOVATE_REVIEW_DAY } from "@/lib/renovate-review";
import { trackedRepositories } from "@/lib/tracked-repositories";
import { parseUdsCommonIncludes } from "@/lib/uds-common";
import type { DailyBriefingItem, PipelineRun, PullRequest, WorkflowFailure } from "@/components/types";

export const runtime = "nodejs";

type Viewer = { login: string; name: string | null; avatar_url: string; html_url: string };
type RunsResponse = { total_count: number; workflow_runs: RawRun[] };
type ContentResponse = { content: string; html_url: string };
type ReleaseResponse = { tag_name: string; html_url: string; body: string | null; published_at?: string | null; draft?: boolean; prerelease?: boolean };
type CommonTasksResult = { repository: string; file: ContentResponse | null };
type RawJob = {
  id: number;
  name: string;
  html_url: string;
  status: string;
  conclusion: string | null;
  steps?: { name: string; status: string; conclusion: string | null; number: number }[];
};
type JobsResponse = { total_count: number; jobs: RawJob[] };
type OperationalGroup = {
  repository: RawRepo;
  openPulls: (PullRequest & { repository: string })[];
  mergedPulls: RecentMergedPull[];
  assignedIssues: Array<import("@/components/types").Issue & { repository: string }>;
  runs: RawRun[];
};

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

function isRenovate(pull: PullRequest) {
  return pull.workflow.renovate;
}

function presentRun(run: RawRun, defaultBranch: string, details?: { failedJob: string | null; failedStep: string | null }): PipelineRun {
  const failedJob = details?.failedJob ?? null;
  const failedStep = details?.failedStep ?? null;
  return {
    id: run.id,
    name: run.name,
    title: run.display_title,
    url: run.html_url,
    status: run.status,
    conclusion: run.conclusion,
    event: run.event,
    number: run.run_number,
    branch: run.head_branch,
    createdAt: run.created_at,
    updatedAt: run.updated_at,
    actor: run.actor?.login ?? "system",
    actorAvatar: run.actor?.avatar_url ?? null,
    commitSha: run.head_sha || null,
    commitMessage: run.head_commit?.message?.split("\n")[0] ?? null,
    commitAuthor: run.head_commit?.author?.username ?? run.head_commit?.author?.name ?? null,
    failedJob,
    failedStep,
    failureSummary: failedJob
      ? `${failedJob}${failedStep ? ` failed at ${failedStep}` : " failed"}.`
      : pipelineFailed(run.conclusion) ? "GitHub reported a failed run; failed job details are unavailable." : null,
    blocksPullRequest: null,
    defaultBranch: run.head_branch === defaultBranch,
  };
}

function unresolvedFailures(runs: RawRun[], defaultBranch: string) {
  const latestByWorkflowBranch = new Map<string, RawRun>();
  [...runs]
    .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime())
    .forEach((run) => {
      const key = run.head_branch === defaultBranch
        ? `default:${defaultBranch}`
        : `${run.name}:${run.head_branch ?? "unknown"}`;
      if (!latestByWorkflowBranch.has(key)) latestByWorkflowBranch.set(key, run);
    });
  return [...latestByWorkflowBranch.values()].filter((run) => pipelineFailed(run.conclusion));
}

async function loadFailureDetails(repository: string, run: RawRun) {
  const jobs = await githubRequest<JobsResponse>(`/repos/${repository}/actions/runs/${run.id}/jobs?filter=latest&per_page=100`).catch(() => null);
  if (!jobs) return { failedJob: null, failedStep: null };
  const failedJob = jobs.jobs.find((job) => pipelineFailed(job.conclusion));
  const failedStep = failedJob?.steps?.find((step) => pipelineFailed(step.conclusion));
  return { failedJob: failedJob?.name ?? null, failedStep: failedStep?.name ?? null };
}

function relevantPulls(pulls: Array<PullRequest & { repository: string }>) {
  return pulls.filter((pull) => !pull.workflow.ignored && (!pull.workflow.automation || pull.workflow.elevatedAutomation));
}

function routineAutomationRun(group: OperationalGroup, run: RawRun) {
  if (run.head_branch === group.repository.default_branch) return false;
  const pull = group.openPulls.find((candidate) => candidate.workflow.headSha === run.head_sha || candidate.head === run.head_branch);
  return Boolean(pull?.workflow.ignored || (pull?.workflow.renovate && !pull.workflow.elevatedAutomation && pull.workflow.checks.failing === 0));
}

function attentionForRepository(group: OperationalGroup, latestDefaultRun: RawRun | null, udsCommonAttention: boolean) {
  const pulls = relevantPulls(group.openPulls);
  const waitingOnMe = pulls.filter((pull) => pull.workflow.state === "waiting-on-me");
  const blocked = pulls.filter((pull) => pull.workflow.state === "blocked");
  const ready = pulls.filter((pull) => pull.workflow.state === "ready-to-merge");
  const needsOwnership = pulls.filter((pull) => !pull.workflow.automation && pull.assignees.length === 0 && !pull.draft);
  const nonDefaultFailure = unresolvedFailures(group.runs, group.repository.default_branch).find((run) => run.head_branch !== group.repository.default_branch && !routineAutomationRun(group, run));

  if (latestDefaultRun && pipelineFailed(latestDefaultRun.conclusion)) {
    return { level: "action-required" as const, reason: `The latest ${group.repository.default_branch} workflow failed.` };
  }
  if (waitingOnMe.length) {
    return { level: "action-required" as const, reason: `${waitingOnMe.length} pull ${waitingOnMe.length === 1 ? "request is" : "requests are"} waiting on you.` };
  }
  if (blocked.length) {
    return { level: "needs-attention" as const, reason: `${blocked.length} pull ${blocked.length === 1 ? "request is" : "requests are"} blocked.` };
  }
  if (ready.length) {
    return { level: "needs-attention" as const, reason: `${ready.length} approved pull ${ready.length === 1 ? "request is" : "requests are"} ready to merge.` };
  }
  if (needsOwnership.length) {
    return { level: "needs-attention" as const, reason: `${needsOwnership.length} human-created pull ${needsOwnership.length === 1 ? "request has" : "requests have"} no assignee.` };
  }
  if (udsCommonAttention) return { level: "needs-attention" as const, reason: "UDS Common configuration needs alignment." };
  if (nonDefaultFailure) return { level: "monitor" as const, reason: `A ${nonDefaultFailure.head_branch ?? "non-default"} branch workflow is failing.` };
  if (!latestDefaultRun) return { level: "unknown" as const, reason: "No default-branch workflow result is available." };
  return { level: "healthy" as const, reason: "No selected-repository GitHub signal requires action." };
}

function recent(timestamp: string | null | undefined, since: number) {
  return Boolean(timestamp && new Date(timestamp).getTime() >= since);
}

function briefingForGroup(group: OperationalGroup, viewer: string, since: number): DailyBriefingItem[] {
  const items: DailyBriefingItem[] = [];
  relevantPulls(group.openPulls).forEach((pull) => {
    if (pull.workflow.reviewRequestedFromViewer && recent(pull.updatedAt, since)) {
      items.push({ id: `review-${group.repository.full_name}-${pull.id}`, type: "review-request", title: pull.title, detail: "Your review is requested.", repository: group.repository.full_name, timestamp: pull.updatedAt, url: pull.url, pullRequest: pull.number });
    }
    if (pull.workflow.assignedToViewer && recent(pull.updatedAt, since)) {
      items.push({ id: `assigned-${group.repository.full_name}-${pull.id}`, type: "pull-assigned", title: pull.title, detail: "Assigned to you.", repository: group.repository.full_name, timestamp: pull.updatedAt, url: pull.url, pullRequest: pull.number });
    }
    if (pull.workflow.approvals.lastApprovedAt && recent(pull.workflow.approvals.lastApprovedAt, since)) {
      items.push({ id: `approved-${group.repository.full_name}-${pull.id}`, type: "pull-approved", title: pull.title, detail: `${pull.workflow.approvals.count} current ${pull.workflow.approvals.count === 1 ? "approval" : "approvals"}; ${pull.workflow.label.toLowerCase()}.`, repository: group.repository.full_name, timestamp: pull.workflow.approvals.lastApprovedAt, url: pull.url, pullRequest: pull.number });
    }
    if (pull.workflow.state === "ready-to-merge" && recent(pull.updatedAt, since)) {
      items.push({ id: `ready-${group.repository.full_name}-${pull.id}`, type: "ready-to-merge", title: pull.title, detail: "Approved, checks passed, mergeable, and still open.", repository: group.repository.full_name, timestamp: pull.updatedAt, url: pull.url, pullRequest: pull.number });
    }
  });
  group.mergedPulls.filter((pull) => !pull.automation && recent(pull.mergedAt, since)).forEach((pull) => {
    items.push({ id: `merged-${group.repository.full_name}-${pull.id}`, type: "pull-merged", title: pull.title, detail: `Pull request #${pull.number} was merged.`, repository: group.repository.full_name, timestamp: pull.mergedAt, url: pull.url, pullRequest: pull.number });
  });
  group.assignedIssues.filter((issue) => recent(issue.updatedAt, since)).forEach((issue) => {
    items.push({ id: `issue-${group.repository.full_name}-${issue.id}`, type: "issue-assigned", title: issue.title, detail: `Issue #${issue.number} is assigned to ${viewer}.`, repository: group.repository.full_name, timestamp: issue.updatedAt, url: issue.url });
  });

  const byWorkflowBranch = new Map<string, RawRun[]>();
  group.runs.forEach((run) => {
    const key = `${run.name}:${run.head_branch ?? "unknown"}`;
    byWorkflowBranch.set(key, [...(byWorkflowBranch.get(key) ?? []), run]);
  });
  byWorkflowBranch.forEach((runs) => {
    const latest = runs[0];
    const previous = runs[1];
    if (!latest || !recent(latest.updated_at, since) || routineAutomationRun(group, latest)) return;
    if (pipelineFailed(latest.conclusion)) {
      items.push({ id: `failure-${group.repository.full_name}-${latest.id}`, type: "workflow-failure", title: latest.display_title, detail: `${latest.name} failed on ${latest.head_branch ?? "an unknown branch"}.`, repository: group.repository.full_name, timestamp: latest.updated_at, url: latest.html_url });
    } else if (latest.conclusion === "success" && previous && pipelineFailed(previous.conclusion)) {
      items.push({ id: `recovery-${group.repository.full_name}-${latest.id}`, type: "workflow-recovery", title: latest.display_title, detail: `${latest.name} recovered on ${latest.head_branch ?? "an unknown branch"}.`, repository: group.repository.full_name, timestamp: latest.updated_at, url: latest.html_url });
    }
  });
  return items;
}

export async function GET() {
  try {
    const viewer = await githubRequest<Viewer>("/user", 5 * 60_000);
    const tracked = trackedRepositories();
    const localSettings = readLocalSettings(viewer.login);
    const gitlabConfigured = localSettings?.gitlabEnabled !== false && gitlabTokenStatus().configured && Boolean(await gitlabRequest<GitlabViewer>("/user", 5 * 60_000).catch(() => null));
    const trackedNames = new Set(tracked.map((repository) => repository.toLowerCase()));
    const hasSonic = trackedNames.has(SONIC_REPOSITORY.toLowerCase());
    const hasTestLabRepository = TEST_LAB_ENABLED && TEST_LAB_REPOSITORIES.some((repository) => trackedNames.has(repository.toLowerCase()));
    const repositories = await Promise.all(tracked.map((repository) => githubRequest<RawRepo>(`/repos/${repository}`)));

    const operationalGroups: OperationalGroup[] = await Promise.all(repositories.map(async (repository) => {
      const [operations, recentRuns, defaultBranchRuns] = await Promise.all([
        loadRepositoryOperations(repository.full_name, viewer.login).catch(async () => {
          const rawPulls = await githubAllPages<RawPull>(`/repos/${repository.full_name}/pulls?state=open&sort=updated&direction=desc`, 10);
          return { pulls: rawPulls.map(presentPull), mergedPulls: [], assignedIssues: [] };
        }),
        githubRequest<RunsResponse>(`/repos/${repository.full_name}/actions/runs?per_page=30`).catch(() => null),
        githubRequest<RunsResponse>(`/repos/${repository.full_name}/actions/runs?branch=${encodeURIComponent(repository.default_branch)}&per_page=1`).catch(() => null),
      ]);
      const runs = [...(recentRuns?.workflow_runs ?? [])];
      for (const run of defaultBranchRuns?.workflow_runs ?? []) {
        if (!runs.some((candidate) => candidate.id === run.id)) runs.push(run);
      }
      runs.sort((left, right) => new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime());
      return {
        repository,
        openPulls: operations.pulls.map((pull) => ({ ...pull, repository: repository.full_name })),
        mergedPulls: operations.mergedPulls,
        assignedIssues: operations.assignedIssues.map((issue) => ({ ...issue, repository: repository.full_name })),
        runs,
      };
    }));

    const commonRepositories = repositories.filter((repository) => repository.full_name !== SONIC_REPOSITORY);
    const [coreFile, upstreamCoreRelease, commonTaskFiles, upstreamCommonRelease, zarfReleases, peprReleases, udsCliReleases] = await Promise.all([
      hasSonic ? githubRequest<ContentResponse>(`/repos/${SONIC_REPOSITORY}/contents/bundles/swf/uds-bundle.yaml`, 5 * 60_000).catch(() => null) : Promise.resolve(null),
      githubRequest<ReleaseResponse>("/repos/defenseunicorns/uds-core/releases/latest", 5 * 60_000).catch(() => null),
      Promise.all(commonRepositories.map(async (repository): Promise<CommonTasksResult> => ({ repository: repository.full_name, file: await githubRequest<ContentResponse>(`/repos/${repository.full_name}/contents/tasks.yaml`, 5 * 60_000).catch(() => null) }))),
      githubRequest<ReleaseResponse>("/repos/defenseunicorns/uds-common/releases/latest", 5 * 60_000).catch(() => null),
      githubRequest<ReleaseResponse[]>("/repos/zarf-dev/zarf/releases?per_page=10", 5 * 60_000).catch(() => []),
      githubRequest<ReleaseResponse[]>("/repos/defenseunicorns/pepr/releases?per_page=10", 5 * 60_000).catch(() => []),
      githubRequest<ReleaseResponse[]>("/repos/defenseunicorns/uds-cli/releases?per_page=10", 5 * 60_000).catch(() => []),
    ]);

    const [latestZarfRelease, previousZarfRelease] = zarfReleases.filter((release) => !release.draft && !release.prerelease);
    const [latestPeprRelease, previousPeprRelease] = peprReleases.filter((release) => !release.draft && !release.prerelease);
    const [latestUdsCliRelease, previousUdsCliRelease] = udsCliReleases.filter((release) => !release.draft && !release.prerelease);
    const allOpenPulls = operationalGroups.flatMap((group) => group.openPulls).filter((pull) => !pull.workflow.ignored).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    const renovatePulls = allOpenPulls.filter(isRenovate).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const reviewRequests = allOpenPulls.filter((pull) => !pull.workflow.ignored && pull.workflow.reviewRequestedFromViewer);
    const reviewRequestIds = new Set(reviewRequests.map((pull) => pull.id));
    const renovatePullIds = new Set(renovatePulls.map((pull) => pull.id));
    const unassignedRenovatePulls = renovatePulls.filter((pull) => pull.workflow.elevatedAutomation && pull.assignees.length === 0 && !reviewRequestIds.has(pull.id));
    const unassignedPullRequests = allOpenPulls.filter((pull) => !pull.workflow.ignored && pull.assignees.length === 0 && !renovatePullIds.has(pull.id) && !reviewRequestIds.has(pull.id));
    const assignedIssues = operationalGroups.flatMap((group) => group.assignedIssues).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    const humanWork = relevantPulls(allOpenPulls);
    const myWork = {
      waitingOnMe: humanWork.filter((pull) => pull.workflow.state === "waiting-on-me"),
      waitingOnOthers: humanWork.filter((pull) => pull.workflow.state === "waiting-on-others"),
      blocked: humanWork.filter((pull) => pull.workflow.state === "blocked"),
      readyToMerge: humanWork.filter((pull) => pull.workflow.state === "ready-to-merge"),
      needsOwnership: humanWork.filter((pull) => !pull.workflow.automation && pull.assignees.length === 0 && !pull.draft),
      assignedIssues,
    };

    const coreText = coreFile ? Buffer.from(coreFile.content, "base64").toString("utf8") : "";
    const coreVersion = coreText.match(/x-core:\s*&x-core[\s\S]{0,400}?\n\s*ref:\s*["']?([^\s"']+)/i)?.[1] ?? null;
    const trackedCoreSemver = semanticVersion(coreVersion);
    const upstreamCoreSemver = semanticVersion(upstreamCoreRelease?.tag_name ?? null);
    const upstreamCommonSemver = semanticVersion(upstreamCommonRelease?.tag_name ?? null);
    const udsCommonRepositories = commonTaskFiles.map(({ repository, file }) => {
      if (!file) return { repository, tasksUrl: null, includes: [], versions: [], status: "missing" as const };
      try {
        const includes = parseUdsCommonIncludes(Buffer.from(file.content, "base64").toString("utf8"));
        const versions = [...new Set(includes.flatMap((include) => include.version ? [include.version] : []))];
        const status = !includes.length ? "not-configured" as const : !upstreamCommonSemver || includes.some((include) => !include.version) ? "unknown" as const : includes.every((include) => include.version === upstreamCommonSemver.normalized) ? "current" as const : "outdated" as const;
        return { repository, tasksUrl: file.html_url, includes, versions, status };
      } catch {
        return { repository, tasksUrl: file.html_url, includes: [], versions: [], status: "unknown" as const };
      }
    });
    const udsCommonByRepository = new Map(udsCommonRepositories.map((item) => [item.repository, item]));

    const workflowFailures: WorkflowFailure[] = (await Promise.all(operationalGroups.flatMap((group) => unresolvedFailures(group.runs, group.repository.default_branch).filter((run) => !routineAutomationRun(group, run)).map(async (rawRun) => {
      const matchingPull = group.openPulls.find((pull) => pull.workflow.headSha === rawRun.head_sha && pull.workflow.checks.failing > 0);
      const needsDetails = rawRun.head_branch === group.repository.default_branch || Boolean(matchingPull);
      const details = needsDetails ? await loadFailureDetails(group.repository.full_name, rawRun) : { failedJob: null, failedStep: null };
      const run = presentRun(rawRun, group.repository.default_branch, details);
      const blocksPullRequest = matchingPull?.number ?? null;
      return {
        ...run,
        repository: group.repository.full_name,
        blocksPullRequest,
        attentionReason: blocksPullRequest
          ? `Blocks pull request #${blocksPullRequest} because a required check is failing.`
          : run.defaultBranch
            ? `Failed on the default branch ${group.repository.default_branch}.`
            : "Failed on a non-default branch and is not known to block a selected pull request.",
      };
    })))).sort((a, b) => Number(Boolean(b.blocksPullRequest)) - Number(Boolean(a.blocksPullRequest)) || Number(b.defaultBranch) - Number(a.defaultBranch) || new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    repositories.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
    const operationalByRepository = new Map(operationalGroups.map((group) => [group.repository.full_name, group]));
    const sevenDaysAgo = Date.now() - 7 * 86_400_000;
    const briefingItems = operationalGroups.flatMap((group) => briefingForGroup(group, viewer.login, sevenDaysAgo)).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    const presentedRepositories = repositories.map((repository) => {
      const operational = operationalByRepository.get(repository.full_name)!;
      const latestDefaultRun = operational.runs.find((run) => run.head_branch === repository.default_branch) ?? null;
      const udsCommon = udsCommonByRepository.get(repository.full_name) ?? null;
      const attention = attentionForRepository(operational, latestDefaultRun, Boolean(udsCommon && udsCommon.status !== "current"));
      const pulls = operational.openPulls;
      const renovate = pulls.filter(isRenovate);
      const relevant = relevantPulls(pulls);
      return {
        ...presentRepo(repository),
        openPullRequests: pulls.filter((pull) => !pull.workflow.ignored).length,
        unassignedPullRequests: pulls.filter((pull) => !pull.workflow.ignored && !pull.assignees.length && !pull.workflow.automation && !pull.workflow.reviewRequestedFromViewer).length,
        issueCount: Math.max(0, repository.open_issues_count - pulls.length),
        renovatePulls: renovate.length,
        unassignedRenovatePulls: renovate.filter((pull) => pull.workflow.elevatedAutomation && !pull.assignees.length && !pull.workflow.reviewRequestedFromViewer).length,
        reviewRequests: pulls.filter((pull) => !pull.workflow.ignored && pull.workflow.reviewRequestedFromViewer).length,
        udsCommon: udsCommon ? { status: udsCommon.status, versions: udsCommon.versions, tasksUrl: udsCommon.tasksUrl } : null,
        health: attention.level === "healthy" ? "healthy" as const : attention.level === "unknown" ? "unknown" as const : "attention" as const,
        attention,
        workflowCounts: {
          waitingOnMe: relevant.filter((pull) => pull.workflow.state === "waiting-on-me").length,
          waitingOnOthers: relevant.filter((pull) => pull.workflow.state === "waiting-on-others").length,
          blocked: relevant.filter((pull) => pull.workflow.state === "blocked").length,
          readyToMerge: relevant.filter((pull) => pull.workflow.state === "ready-to-merge").length,
        },
        pipeline: latestDefaultRun ? { name: latestDefaultRun.name, status: latestDefaultRun.status, conclusion: latestDefaultRun.conclusion, url: latestDefaultRun.html_url, updatedAt: latestDefaultRun.updated_at } : null,
      };
    });

    return NextResponse.json({
      viewer: { login: viewer.login, name: viewer.name, avatar: viewer.avatar_url, url: viewer.html_url },
      preferences: { renovateReviewDay: localSettings?.renovateReviewDay ?? DEFAULT_RENOVATE_REVIEW_DAY },
      capabilities: { sonic: hasSonic, testLab: hasTestLabRepository, gitlab: gitlabConfigured && Boolean(localSettings?.gitlabProjects.length), gitlabTickets: gitlabConfigured },
      metrics: {
        repositories: repositories.length,
        private: repositories.filter((repo) => repo.private).length,
        public: repositories.filter((repo) => !repo.private).length,
        archived: repositories.filter((repo) => repo.archived).length,
        forks: repositories.filter((repo) => repo.fork).length,
        openItems: repositories.reduce((total, repo) => total + repo.open_issues_count, 0),
        active30d: repositories.filter((repo) => Date.now() - new Date(repo.updated_at).getTime() <= 30 * 86_400_000).length,
        renovatePulls: unassignedRenovatePulls.length,
        openPullRequests: unassignedPullRequests.length,
        issueCount: presentedRepositories.reduce((total, repository) => total + repository.issueCount, 0),
        pipelineFailures: workflowFailures.length,
        repositoriesRequiringAttention: presentedRepositories.filter((repository) => ["action-required", "needs-attention"].includes(repository.attention.level)).length,
        waitingOnMe: myWork.waitingOnMe.length,
        waitingOnOthers: myWork.waitingOnOthers.length,
        blockedPullRequests: myWork.blocked.length,
        readyToMerge: myWork.readyToMerge.length,
      },
      udsCommon: { latestVersion: upstreamCommonSemver?.normalized ?? null, latestUrl: upstreamCommonRelease?.html_url ?? "https://github.com/defenseunicorns/uds-common/releases", latestReleaseNotes: upstreamCommonRelease?.body ?? null, repository: "defenseunicorns/uds-common", needsAttention: udsCommonRepositories.filter((item) => item.status !== "current").length, repositories: udsCommonRepositories },
      udsCore: { version: coreVersion, repository: SONIC_REPOSITORY, sourcePath: "bundles/swf/uds-bundle.yaml", url: coreFile?.html_url ?? null, upstreamVersion: upstreamCoreSemver?.normalized ?? null, upstreamUrl: upstreamCoreRelease?.html_url ?? "https://github.com/defenseunicorns/uds-core", upstreamReleaseNotes: upstreamCoreRelease?.body ?? null, comparison: compareVersions(trackedCoreSemver, upstreamCoreSemver) },
      tools: {
        zarf: { name: "Zarf", repository: "zarf-dev/zarf", version: latestZarfRelease?.tag_name ?? null, previousVersion: previousZarfRelease?.tag_name ?? null, publishedAt: latestZarfRelease?.published_at ?? null, url: latestZarfRelease?.html_url ?? "https://github.com/zarf-dev/zarf/releases" },
        pepr: { name: "Pepr", repository: "defenseunicorns/pepr", version: latestPeprRelease?.tag_name ?? null, previousVersion: previousPeprRelease?.tag_name ?? null, publishedAt: latestPeprRelease?.published_at ?? null, url: latestPeprRelease?.html_url ?? "https://github.com/defenseunicorns/pepr/releases" },
        udsCli: { name: "UDS CLI", repository: "defenseunicorns/uds-cli", version: latestUdsCliRelease?.tag_name ?? null, previousVersion: previousUdsCliRelease?.tag_name ?? null, publishedAt: latestUdsCliRelease?.published_at ?? null, url: latestUdsCliRelease?.html_url ?? "https://github.com/defenseunicorns/uds-cli/releases" },
      },
      pullRequests: allOpenPulls,
      unassignedPullRequests,
      reviewRequests,
      myWork,
      briefing: { availableSince: new Date(sevenDaysAgo).toISOString(), items: briefingItems },
      workflowFailures,
      renovate: { total: renovatePulls.length, unassignedTotal: unassignedRenovatePulls.length, pulls: renovatePulls },
      repositories: presentedRepositories,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    const failure = apiError(error);
    return NextResponse.json({ error: failure.message }, { status: failure.status });
  }
}
