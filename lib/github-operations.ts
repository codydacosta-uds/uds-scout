import "server-only";

import { githubGraphQL } from "@/lib/github";
import type { Issue, PullRequest, PullRequestWorkflow } from "@/components/types";

const OPERATIONS_QUERY = `
  query RepositoryOperations($owner: String!, $name: String!, $viewer: String!) {
    repository(owner: $owner, name: $name) {
      pullRequests(first: 100, states: OPEN, orderBy: {field: UPDATED_AT, direction: DESC}) {
        nodes {
          databaseId number title url state isDraft createdAt updatedAt closedAt mergedAt
          body headRefName baseRefName mergeable mergeStateStatus reviewDecision
          author { login avatarUrl url __typename }
          headRepository { nameWithOwner }
          labels(first: 30) { nodes { name color } }
          assignees(first: 30) { nodes { login avatarUrl url } }
          reviewRequests(first: 30) { nodes { requestedReviewer {
            ... on User { login avatarUrl url }
            ... on Team { name slug url organization { login } }
          } } }
          latestReviews(first: 50) { nodes { state submittedAt author { login } } }
          commits(last: 1) { nodes { commit {
            oid
            statusCheckRollup { state contexts(first: 100) { nodes {
              ... on CheckRun { name status conclusion detailsUrl }
              ... on StatusContext { context state targetUrl description }
            } } }
          } } }
        }
      }
      mergedPullRequests: pullRequests(first: 30, states: MERGED, orderBy: {field: UPDATED_AT, direction: DESC}) {
        nodes { databaseId number title url mergedAt updatedAt headRefName author { login __typename } labels(first: 30) { nodes { name } } }
      }
      issues(first: 50, states: OPEN, filterBy: {assignee: $viewer}, orderBy: {field: UPDATED_AT, direction: DESC}) {
        nodes {
          databaseId number title url createdAt updatedAt
          author { login }
          labels(first: 20) { nodes { name color } }
          assignees(first: 20) { nodes { login } }
        }
      }
    }
  }
`;

const PROTECTION_QUERY = `
  query RepositoryProtection($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) {
      branchProtectionRules(first: 100) {
        nodes {
          pattern
          requiresApprovingReviews
          requiredApprovingReviewCount
          requiresStatusChecks
          requiredStatusCheckContexts
        }
      }
    }
  }
`;

type Actor = { login: string; avatarUrl?: string; url?: string; __typename?: string } | null;
type ReviewActor = { login: string } | null;
type GraphCheck = {
  name?: string;
  context?: string;
  status?: string;
  conclusion?: string | null;
  state?: string;
  detailsUrl?: string | null;
  targetUrl?: string | null;
  description?: string | null;
};
type GraphPull = {
  databaseId: number;
  number: number;
  title: string;
  url: string;
  state: string;
  isDraft: boolean;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  mergedAt: string | null;
  body: string | null;
  headRefName: string;
  baseRefName: string;
  mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
  mergeStateStatus: string;
  reviewDecision: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null;
  author: Actor;
  headRepository: { nameWithOwner: string } | null;
  labels: { nodes: { name: string; color: string }[] };
  assignees: { nodes: { login: string; avatarUrl: string; url: string }[] };
  reviewRequests: { nodes: { requestedReviewer: { login?: string; avatarUrl?: string; url?: string; name?: string; slug?: string; organization?: { login: string } } | null }[] };
  latestReviews: { nodes: { state: string; submittedAt: string | null; author: ReviewActor }[] };
  commits: { nodes: { commit: { oid: string; statusCheckRollup: { state: string; contexts: { nodes: GraphCheck[] } } | null } }[] };
};
type GraphMergedPull = Pick<GraphPull, "databaseId" | "number" | "title" | "url" | "updatedAt" | "mergedAt" | "headRefName"> & { author: Actor; labels: { nodes: { name: string }[] } };
type GraphIssue = {
  databaseId: number;
  number: number;
  title: string;
  url: string;
  createdAt: string;
  updatedAt: string;
  author: { login: string } | null;
  labels: { nodes: { name: string; color: string }[] };
  assignees: { nodes: { login: string }[] };
};
type OperationsResult = { repository: { pullRequests: { nodes: GraphPull[] }; mergedPullRequests: { nodes: GraphMergedPull[] }; issues: { nodes: GraphIssue[] } } | null };
type ProtectionRule = {
  pattern: string;
  requiresApprovingReviews: boolean;
  requiredApprovingReviewCount: number;
  requiresStatusChecks: boolean;
  requiredStatusCheckContexts: string[];
};
type ProtectionResult = { repository: { branchProtectionRules: { nodes: ProtectionRule[] } | null } | null };

export type RecentMergedPull = {
  id: number;
  number: number;
  title: string;
  url: string;
  mergedAt: string;
  updatedAt: string;
  author: string;
  automation: boolean;
  renovate: boolean;
};

function globMatches(pattern: string, branch: string) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`).test(branch);
}

function matchingProtection(rules: ProtectionRule[] | null, branch: string) {
  if (!rules) return null;
  return rules.find((rule) => globMatches(rule.pattern, branch)) ?? null;
}

function checkName(check: GraphCheck) {
  return check.name ?? check.context ?? "Unnamed check";
}

function checkTargetUrl(check: GraphCheck) {
  const candidate = check.detailsUrl ?? check.targetUrl;
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function checkReference(check: GraphCheck) {
  return { name: checkName(check), url: checkTargetUrl(check) };
}

function checkState(check: GraphCheck): "passed" | "pending" | "failing" {
  const state = (check.conclusion ?? check.state ?? check.status ?? "").toUpperCase();
  if (["SUCCESS", "NEUTRAL", "SKIPPED"].includes(state)) return "passed";
  if (["FAILURE", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE", "ERROR"].includes(state)) return "failing";
  return "pending";
}

function checkCancelled(check: GraphCheck) {
  const state = (check.conclusion ?? check.state ?? "").toUpperCase();
  return ["CANCELLED", "STALE"].includes(state);
}

function configuredLabels(name: "PRIORITY" | "SECURITY") {
  const value = process.env[`UDS_SCOUT_${name}_LABELS`] ?? process.env[`D2D_${name}_LABELS`] ?? "";
  return new Set(value.split(",").map((label) => label.trim().toLowerCase()).filter(Boolean));
}

function buildWorkflow(pull: GraphPull, viewer: string, rules: ProtectionRule[] | null): PullRequestWorkflow {
  const viewerName = viewer.toLowerCase();
  const reviews = pull.latestReviews.nodes.filter((review) => review.author?.login);
  const approvalReviews = reviews.filter((review) => review.state === "APPROVED");
  const approvals = approvalReviews.map((review) => review.author!.login);
  const lastApprovedAt = approvalReviews.map((review) => review.submittedAt).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;
  const changesRequestedBy = reviews.filter((review) => review.state === "CHANGES_REQUESTED").map((review) => review.author!.login);
  const protection = matchingProtection(rules, pull.baseRefName);
  const requiredContexts = new Set(protection?.requiredStatusCheckContexts ?? []);
  const allChecks = pull.commits.nodes[0]?.commit.statusCheckRollup?.contexts.nodes ?? [];
  const requiredChecks = protection?.requiresStatusChecks
    ? allChecks.filter((check) => requiredContexts.has(checkName(check)))
    : [];
  const allPassed = allChecks.filter((check) => checkState(check) === "passed");
  const allPending = allChecks.filter((check) => checkState(check) === "pending" && !checkCancelled(check));
  const allFailing = allChecks.filter((check) => checkState(check) === "failing");
  const allCancelled = allChecks.filter(checkCancelled);
  const requiredCount = protection?.requiresStatusChecks ? Math.max(requiredContexts.size, requiredChecks.length) : 0;
  const requiredKnown = rules !== null && (!protection?.requiresStatusChecks || requiredCount > 0);
  const checksToEvaluate = protection?.requiresStatusChecks ? requiredChecks : [];
  const passed = checksToEvaluate.filter((check) => checkState(check) === "passed").length;
  const pending = checksToEvaluate.filter((check) => checkState(check) === "pending").length;
  const failingChecks = checksToEvaluate.filter((check) => checkState(check) === "failing");
  const rollupFailing = allChecks.filter((check) => checkState(check) === "failing");
  const checksSummary = !requiredKnown
    ? "Unable to verify required checks"
    : !protection?.requiresStatusChecks
      ? "No required checks configured"
      : failingChecks.length
        ? `${failingChecks.length} required ${failingChecks.length === 1 ? "check is" : "checks are"} failing`
        : pending || requiredChecks.length < requiredCount
          ? "Waiting for required checks"
          : "Required checks passed";

  const author = pull.author?.login ?? "ghost";
  const automation = pull.author?.__typename === "Bot";
  const renovate = automation && pull.headRefName.toLowerCase().startsWith("renovate/");
  const ignored = pull.labels.nodes.some((label) => label.name.toLowerCase() === "stale");
  const assignees = pull.assignees.nodes.map((assignee) => assignee.login);
  const requestedReviewers = pull.reviewRequests.nodes.flatMap(({ requestedReviewer }) => {
    if (!requestedReviewer) return [];
    if (requestedReviewer.login) return [requestedReviewer.login];
    if (requestedReviewer.organization?.login && requestedReviewer.slug) return [`${requestedReviewer.organization.login}/${requestedReviewer.slug}`];
    return requestedReviewer.name ? [requestedReviewer.name] : [];
  });
  const authoredByViewer = author.toLowerCase() === viewerName;
  const assignedToViewer = assignees.some((login) => login.toLowerCase() === viewerName);
  const reviewRequestedFromViewer = pull.reviewRequests.nodes.some(({ requestedReviewer }) => requestedReviewer?.login?.toLowerCase() === viewerName);
  const requiredApprovals = protection?.requiresApprovingReviews ? protection.requiredApprovingReviewCount : protection ? 0 : null;
  const fullyApproved = pull.reviewDecision === "APPROVED";
  const conflicts = pull.mergeable === "CONFLICTING" || pull.mergeStateStatus === "DIRTY";
  const requiredChecksFailing = failingChecks.length > 0;
  const requiredChecksPending = pending > 0 || (protection?.requiresStatusChecks === true && requiredChecks.length < requiredCount);
  const unknownCheckFailure = !requiredKnown && rollupFailing.length > 0;
  const blockers: string[] = [];
  if (conflicts) blockers.push("The pull request has merge conflicts.");
  if (changesRequestedBy.length) blockers.push(`Changes requested by ${changesRequestedBy.join(", ")}.`);
  if (requiredChecksFailing) blockers.push(`${failingChecks.map(checkName).join(", ")} ${failingChecks.length === 1 ? "is" : "are"} failing.`);
  if (unknownCheckFailure) blockers.push("Checks are failing, but required-check rules could not be verified.");
  if (pull.mergeStateStatus === "BEHIND") blockers.push(`The branch is behind ${pull.baseRefName}.`);

  const policyLabels = new Set([...configuredLabels("PRIORITY"), ...configuredLabels("SECURITY")]);
  const policyMatch = pull.labels.nodes.some((label) => policyLabels.has(label.name.toLowerCase()));
  const elevatedAutomation = !ignored && automation && (conflicts || requiredChecksFailing || changesRequestedBy.length > 0 || reviewRequestedFromViewer || assignedToViewer || policyMatch);
  const waitingOn = changesRequestedBy.length
    ? [author]
    : requestedReviewers.length
      ? requestedReviewers
      : assignees.length
        ? assignees
        : [];

  let state: PullRequestWorkflow["state"] = "no-action";
  let progress: PullRequestWorkflow["progress"] = "unknown";
  let label = "Unable to verify";
  let reason = "GitHub did not return enough information to verify the next workflow step.";

  if (pull.isDraft) {
    progress = "draft";
    label = "No action required";
    reason = `Draft pull request owned by ${author}.`;
  } else if (conflicts) {
    state = "blocked";
    progress = "merge-conflict";
    label = "Merge conflict";
    reason = "The source branch must be updated before this pull request can merge.";
  } else if (changesRequestedBy.length) {
    state = authoredByViewer || assignedToViewer ? "waiting-on-me" : "blocked";
    progress = "changes-requested";
    label = "Changes requested";
    reason = `Waiting for requested changes from ${author}.`;
  } else if (requiredChecksFailing) {
    state = "blocked";
    progress = fullyApproved ? "approved-blocked" : "waiting-checks";
    label = fullyApproved ? "Approved but blocked" : "Blocked by checks";
    reason = checksSummary;
  } else if (reviewRequestedFromViewer) {
    state = "waiting-on-me";
    progress = approvals.length ? "partially-approved" : "waiting-reviewer";
    label = "Waiting on your review";
    reason = `${author} requested your review.`;
  } else if (fullyApproved && requiredChecksPending) {
    state = "waiting-on-others";
    progress = "waiting-checks";
    label = "Waiting on checks";
    reason = checksSummary;
  } else if (fullyApproved && pull.mergeable === "MERGEABLE" && ["CLEAN", "HAS_HOOKS"].includes(pull.mergeStateStatus)) {
    state = "ready-to-merge";
    progress = "ready-to-merge";
    label = "Ready to merge";
    reason = "Required approvals and checks are complete, but the pull request is still open.";
  } else if (fullyApproved) {
    state = "waiting-on-others";
    progress = "approved-unmerged";
    label = "Approved but unmerged";
    reason = pull.mergeStateStatus === "BEHIND" ? `The branch is behind ${pull.baseRefName}.` : "Approvals are complete, but merge readiness could not be confirmed.";
  } else if (assignedToViewer) {
    state = "waiting-on-me";
    progress = approvals.length ? "partially-approved" : "waiting-reviewer";
    label = "Assigned to you";
    reason = `This pull request is assigned to ${viewer}.`;
  } else if (authoredByViewer) {
    state = "waiting-on-others";
    progress = approvals.length ? "partially-approved" : "no-approvals";
    label = approvals.length ? "Needs additional approval" : "Waiting for first approval";
    reason = requestedReviewers.length ? `Waiting on ${requestedReviewers.join(", ")}.` : "Your pull request is waiting for review or approval.";
  } else if (!automation && assignees.length === 0) {
    state = "needs-review";
    progress = approvals.length ? "partially-approved" : "no-approvals";
    label = approvals.length ? "Needs ownership" : "Needs review and ownership";
    reason = "This human-created pull request has no assignee.";
  } else if (requestedReviewers.length) {
    state = "needs-approval";
    progress = approvals.length ? "partially-approved" : "waiting-reviewer";
    label = approvals.length ? "Needs additional approval" : "Waiting on reviewer";
    reason = `Waiting on ${requestedReviewers.join(", ")}.`;
  } else if (approvals.length) {
    state = "needs-approval";
    progress = "partially-approved";
    label = "Partially approved";
    reason = requiredApprovals === null ? "An approval exists, but the required approval policy is unavailable." : `${approvals.length} of ${requiredApprovals} required approvals received.`;
  } else {
    state = "needs-review";
    progress = "no-approvals";
    label = automation ? "Routine update" : "No approvals";
    reason = automation ? "This automated update has no elevated blocker or direct request." : "No approval has been submitted.";
  }

  if (ignored) {
    state = "no-action";
    progress = "unknown";
    label = "No action required";
    reason = "The stale label removes this pull request from operational attention.";
  }

  return {
    state,
    progress,
    label,
    reason,
    blockers: ignored ? [] : blockers,
    waitingOn: ignored ? [] : waitingOn,
    approvals: { count: approvals.length, required: requiredApprovals, reviewers: approvals, changesRequestedBy, decision: pull.reviewDecision, lastApprovedAt },
    checks: {
      requiredKnown,
      total: allChecks.length,
      required: requiredCount,
      passed,
      pending,
      failing: failingChecks.length,
      failingNames: failingChecks.map(checkName),
      rollup: {
        passed: allPassed.length,
        pending: allPending.length,
        pendingChecks: allPending.map(checkReference),
        failing: allFailing.length,
        failingNames: allFailing.map(checkName),
        failingChecks: allFailing.map(checkReference),
        cancelled: allCancelled.length,
        cancelledNames: allCancelled.map(checkName),
        cancelledChecks: allCancelled.map(checkReference),
      },
      summary: checksSummary,
    },
    mergeable: pull.mergeable,
    mergeStateStatus: pull.mergeStateStatus,
    headSha: pull.commits.nodes[0]?.commit.oid ?? null,
    assignedToViewer,
    authoredByViewer,
    reviewRequestedFromViewer,
    automation,
    renovate,
    elevatedAutomation,
    ignored,
  };
}

function presentGraphPull(pull: GraphPull, viewer: string, rules: ProtectionRule[] | null): PullRequest {
  const requestedReviewers: PullRequest["requestedReviewers"] = pull.reviewRequests.nodes.flatMap<PullRequest["requestedReviewers"][number]>(({ requestedReviewer }) => {
    if (!requestedReviewer) return [];
    if (requestedReviewer.login) return [{ login: requestedReviewer.login, avatar: requestedReviewer.avatarUrl ?? null, url: requestedReviewer.url, kind: "user" as const }];
    const login = requestedReviewer.organization?.login && requestedReviewer.slug
      ? `${requestedReviewer.organization.login}/${requestedReviewer.slug}`
      : requestedReviewer.name ?? "GitHub team";
    return [{ login, avatar: null, url: requestedReviewer.url, kind: "team" as const }];
  });
  return {
    id: pull.databaseId,
    number: pull.number,
    title: pull.title,
    url: pull.url,
    state: pull.state.toLowerCase(),
    draft: pull.isDraft,
    createdAt: pull.createdAt,
    updatedAt: pull.updatedAt,
    closedAt: pull.closedAt,
    mergedAt: pull.mergedAt,
    author: pull.author?.login ?? "ghost",
    authorAvatar: pull.author?.avatarUrl ?? null,
    head: pull.headRefName,
    headRepository: pull.headRepository?.nameWithOwner ?? null,
    base: pull.baseRefName,
    body: pull.body?.trim() || null,
    summary: pull.body?.replace(/[#*_`>\[\]]/g, "").replace(/\s+/g, " ").trim().slice(0, 240) || null,
    labels: pull.labels.nodes,
    assignees: pull.assignees.nodes.map((assignee) => ({ login: assignee.login, avatar: assignee.avatarUrl ?? null })),
    requestedReviewers,
    workflow: buildWorkflow(pull, viewer, rules),
  };
}

export async function loadRepositoryOperations(repository: string, viewer: string) {
  const [owner, name] = repository.split("/");
  const [operations, protection] = await Promise.all([
    githubGraphQL<OperationsResult>(OPERATIONS_QUERY, { owner, name, viewer }),
    githubGraphQL<ProtectionResult>(PROTECTION_QUERY, { owner, name }).catch(() => null),
  ]);
  if (!operations.repository) throw new Error(`GitHub did not return ${repository}.`);
  const rules = protection?.repository?.branchProtectionRules?.nodes ?? null;
  const pulls = operations.repository.pullRequests.nodes.map((pull) => presentGraphPull(pull, viewer, rules));
  const mergedPulls: RecentMergedPull[] = operations.repository.mergedPullRequests.nodes.flatMap((pull) => pull.mergedAt && !pull.labels.nodes.some((label) => label.name.toLowerCase() === "stale") ? [{
    id: pull.databaseId,
    number: pull.number,
    title: pull.title,
    url: pull.url,
    mergedAt: pull.mergedAt,
    updatedAt: pull.updatedAt,
    author: pull.author?.login ?? "ghost",
    automation: pull.author?.__typename === "Bot",
    renovate: pull.author?.__typename === "Bot" && pull.headRefName.toLowerCase().startsWith("renovate/"),
  }] : []);
  const issues: Issue[] = operations.repository.issues.nodes.map((issue) => ({
    id: issue.databaseId,
    number: issue.number,
    title: issue.title,
    url: issue.url,
    author: issue.author?.login ?? "ghost",
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt,
    labels: issue.labels.nodes,
    assignees: issue.assignees.nodes.map((assignee) => assignee.login),
  }));
  return { pulls, mergedPulls, assignedIssues: issues };
}
