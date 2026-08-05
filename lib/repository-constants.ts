export const SONIC_REPOSITORY = "nswccd-devsecops/sonic-swf-iac";

export const TEST_LAB_REPOSITORIES = [
  "uds-packages/artifactory",
  "uds-packages/jira",
  "uds-packages/xray",
  "uds-packages/confluence",
  "uds-packages/jenkins",
] as const;

export const WORKSPACE_PRESETS = [
  {
    id: "sonic-maintainer",
    label: "SONIC maintainer",
    description: "Add the SONIC infrastructure and maintained package repositories.",
    repositories: [SONIC_REPOSITORY, ...TEST_LAB_REPOSITORIES],
  },
] as const;
