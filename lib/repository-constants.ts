import repositoryGroups from "@/config/repository-groups.json";

export const UDS_SCOUT_REPOSITORY_URL = "https://github.com/codydacosta-uds/uds-scout";

// SONIC capabilities are keyed to the selected repository, not to any quick-select group.
export const SONIC_REPOSITORY = "nswccd-devsecops/sonic-swf-iac";

export function isSecurityContextRepository(repository: string) {
  return Boolean(repository.trim());
}

/** @deprecated Use isSecurityContextRepository. */
export const isSecurityIntelligenceRepository = isSecurityContextRepository;

// The implementation remains available for a future release, but no Test Lab
// route, API, navigation item, or pull-request handoff is exposed yet.
export const TEST_LAB_ENABLED = false;

export const TEST_LAB_REPOSITORIES = [
  "uds-packages/artifactory",
  "uds-packages/jira",
  "uds-packages/xray",
  "uds-packages/confluence",
  "uds-packages/jenkins",
] as const;

export type WorkspacePreset = {
  id: string;
  label: string;
  repositories: string[];
  source?: "config" | "user";
};

function groupId(name: string) {
  return `config-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

export const CONFIGURED_WORKSPACE_PRESETS: WorkspacePreset[] = Object.entries(repositoryGroups).flatMap(([name, repositories]) => {
  const label = name.trim();
  const validRepositories = [...new Set(repositories.map((repository) => repository.trim()).filter((repository) => /^[^/\s]+\/[^/\s]+$/.test(repository)))];
  return label && validRepositories.length ? [{ id: groupId(label), label, repositories: validRepositories, source: "config" as const }] : [];
});

export function workspacePresetsWithConfig(userPresets: WorkspacePreset[] = []) {
  const configuredIds = new Set(CONFIGURED_WORKSPACE_PRESETS.map((preset) => preset.id.toLowerCase()));
  const configuredLabels = new Set(CONFIGURED_WORKSPACE_PRESETS.map((preset) => preset.label.toLowerCase()));
  return [
    ...CONFIGURED_WORKSPACE_PRESETS,
    ...userPresets.filter((preset) => !configuredIds.has(preset.id.toLowerCase()) && !configuredLabels.has(preset.label.toLowerCase())).map((preset) => ({ ...preset, source: "user" as const })),
  ];
}
