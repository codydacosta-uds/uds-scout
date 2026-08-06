import "server-only";

import { currentGitHubViewer } from "@/lib/github";
import { readLocalSettings } from "@/lib/local-settings";
import { TEST_LAB_REPOSITORIES } from "@/lib/repository-constants";

export { TEST_LAB_REPOSITORIES };

export function configuredRepositorySource() {
  const environment = process.env.GITHUB_REPOSITORIES
    ?.split(",")
    .map((repository) => repository.trim())
    .filter(Boolean);
  const local = readLocalSettings(currentGitHubViewer());
  if (environment?.length) return { source: "environment" as const, repositories: environment, setupCompleted: local?.setupCompleted === true };
  if (local) return { source: "local" as const, repositories: local.repositories, setupCompleted: local.setupCompleted };

  return { source: "unconfigured" as const, repositories: [], setupCompleted: false };
}

export function trackedRepositories() {
  return configuredRepositorySource().repositories;
}

export function isTrackedRepository(repository: string) {
  return trackedRepositories().some(
    (tracked) => tracked.toLowerCase() === repository.toLowerCase(),
  );
}
