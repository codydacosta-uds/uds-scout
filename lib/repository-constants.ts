export const SONIC_REPOSITORY = "nswccd-devsecops/sonic-swf-iac";

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
};

export const DEFAULT_WORKSPACE_PRESETS: WorkspacePreset[] = [
  {
    id: "sonic-maintainer",
    label: "SONIC maintainer",
    repositories: [SONIC_REPOSITORY, ...TEST_LAB_REPOSITORIES],
  },
];
