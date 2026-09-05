import "server-only";

import { currentGitHubViewer, githubRequest } from "@/lib/github";
import { loadRepositoryOperations } from "@/lib/github-operations";
import { notifyPackageWorkflowFailuresSlack, notifyPullRequestsSlack, notifySonicDeployedSecurity, type WorkflowRun } from "@/lib/security-slack";
import { securityRefreshService } from "@/lib/security-service";
import { trackedRepositories } from "@/lib/tracked-repositories";

const MONITOR_INTERVAL = 15 * 60_000;
const runtimeState = globalThis as typeof globalThis & { __udsScoutSecurityMonitorStarted?: boolean };
let monitorInFlight = false;
let successfulCheck = false;

async function runSecurityMonitor() {
  if (monitorInFlight) return;
  monitorInFlight = true;
  try {
    const viewer = currentGitHubViewer() ?? (await githubRequest<{ login: string }>("/user")).login;
    const repositories = trackedRepositories();
    securityRefreshService().snapshot(repositories);
    await Promise.all(repositories.map(async (repository) => {
      const operations = await loadRepositoryOperations(repository, viewer);
      await notifyPullRequestsSlack(repository, operations.pulls);
      if (repository.toLowerCase().startsWith("uds-packages/")) {
        const response = await githubRequest<{ workflow_runs: WorkflowRun[] }>(`/repos/${repository}/actions/runs?per_page=100`);
        await notifyPackageWorkflowFailuresSlack(repository, response.workflow_runs);
      }
    }));
    await notifySonicDeployedSecurity();
    successfulCheck = true;
    console.info(`[security-monitor] checked ${repositories.length} repositories`);
  } catch (error) {
    console.error("[security-monitor] check failed", error instanceof Error ? error.message : error);
  } finally {
    monitorInFlight = false;
  }
}

export function startSecurityMonitor() {
  if (runtimeState.__udsScoutSecurityMonitorStarted) return;
  runtimeState.__udsScoutSecurityMonitorStarted = true;
  void runSecurityMonitor();
  setTimeout(() => {
    if (!successfulCheck) void runSecurityMonitor();
  }, 30_000);
  setInterval(() => { void runSecurityMonitor(); }, MONITOR_INTERVAL);
}
