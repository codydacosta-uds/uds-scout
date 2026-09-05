export type InfrastructureKind = "resource" | "data" | "module";

export type InfrastructureCategory =
  | "Networking"
  | "Compute"
  | "Kubernetes"
  | "Storage"
  | "Databases"
  | "Identity"
  | "Security"
  | "Monitoring"
  | "Integration"
  | "Platform";

export type InfrastructureNode = {
  id: string;
  address: string;
  name: string;
  type: string;
  kind: InfrastructureKind;
  managed: boolean;
  category: InfrastructureCategory;
  system: string;
  scope: string;
  provider: string;
  file: string;
  line: number;
  sourceUrl: string;
  summary: string;
  source?: string;
  version?: string;
  dependencies: string[];
  dependents: string[];
  variableReferences: string[];
  localReferences: string[];
  repetition?: string;
  attributes: { name: string; value: string }[];
  implementation: string;
};

export type InfrastructureEdge = {
  id: string;
  source: string;
  target: string;
  relationship: "depends-on" | "contains";
};

export type InfrastructureVariable = {
  name: string;
  description: string | null;
  type: string;
  defaultValue: string | null;
  required: boolean;
  sensitive: boolean;
  file: string;
  line: number;
};

export type InfrastructureOutput = {
  name: string;
  description: string | null;
  value: string;
  sensitive: boolean;
  file: string;
  line: number;
};

export type InfrastructureProvider = {
  name: string;
  source: string | null;
  version: string | null;
};

export type InfrastructurePattern = {
  name: string;
  description: string;
  count: number;
  nodeIds: string[];
};

export type DeploymentSource = {
  file: string;
  line: number;
  url: string;
};

export type DeploymentStep = {
  id: string;
  order: number;
  title: string;
  command: string;
  phase: "prepare" | "foundation" | "infrastructure" | "configuration" | "delivery" | "validation";
  frequency: "every deployment" | "first deployment" | "as needed";
  description: string;
  outcome: string;
  source: DeploymentSource;
};

export type DeploymentRoot = {
  name: string;
  path: string;
  order: number;
  purpose: string;
  command: string;
  dependsOn: string[];
  sourceUrl: string;
};

export type UdsPackage = {
  name: string;
  version: string | null;
  flavor?: "upstream" | "registry1" | "unicorn" | null;
  architecture?: string;
  repository: string | null;
  registryUrl: string | null;
  latestVersion?: string | null;
  latestReleaseUrl?: string | null;
  latestRegistryUrl?: string | null;
  updateStatus?: "current" | "update-available" | "unknown";
  local: boolean;
  optionalComponents: string[];
  configSections: string[];
  order: number;
  source: DeploymentSource;
};

export type UdsConfigSection = {
  name: string;
  variableCount: number;
  variables: string[];
  infrastructureNodeIds: string[];
  source: DeploymentSource;
};

export type EnvironmentInfo = {
  name: string;
  status: "deployed" | "vestigial";
  purpose: string;
  tfvarsUrl: string;
};

export type DeploymentKnowledge = {
  summary: string;
  preferredInterface: string;
  quickCommand: string;
  steps: DeploymentStep[];
  roots: DeploymentRoot[];
  packages: UdsPackage[];
  configSections: UdsConfigSection[];
  environments: EnvironmentInfo[];
  udsConfigFlow: { title: string; description: string; source: DeploymentSource }[];
  notices: { type: "info" | "warning"; message: string; source?: DeploymentSource }[];
};

export type InfrastructureExplorerData = {
  repository: string;
  rootPath: string;
  branch: string;
  sourceRevision: string;
  sourceUrl: string;
  summary: string;
  generatedAt: string;
  metrics: {
    managed: number;
    referenced: number;
    modules: number;
    relationships: number;
    variables: number;
    outputs: number;
    files: number;
    systems: number;
  };
  categories: { name: InfrastructureCategory; count: number; managed: number; referenced: number }[];
  systems: { name: string; count: number; summary: string }[];
  nodes: InfrastructureNode[];
  edges: InfrastructureEdge[];
  variables: InfrastructureVariable[];
  outputs: InfrastructureOutput[];
  providers: InfrastructureProvider[];
  environments: string[];
  commonTags: { name: string; value: string }[];
  patterns: InfrastructurePattern[];
  deployment: DeploymentKnowledge;
  warnings: string[];
};
