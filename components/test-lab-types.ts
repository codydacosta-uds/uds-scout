export type TestLabRepository = {
  name: string;
  fullName: string;
};

export type TestLabBranch = {
  name: string;
  sha: string;
};

export type TestLabWorkflowPlan = {
  steps: Array<{
    task: "dev" | "create-dev-package" | "create-deploy-test-bundle";
    title: string;
    description: string;
    actions: string[];
  }>;
  tests: string[];
  safe: boolean;
  blockers: string[];
};

export type TestLabPlan = {
  repository: string;
  branch: string;
  sha: string;
  flavors: string[];
  deployOnly: TestLabWorkflowPlan;
  workflow: TestLabWorkflowPlan;
  bundle: {
    path: "bundle/uds-bundle.yaml";
    name: string;
    version: string;
  };
  safe: boolean;
  blockers: string[];
};

export type TestLabWorkflowMode = "deploy-only" | "build-deploy-test";

export type TestLabCatalog = {
  target: {
    hostname: string;
    address: string;
    transport: string;
  };
  repositories: TestLabRepository[];
};

export type TestLabSessionState = "idle" | "prepared" | "deploying" | "deployed" | "failed" | "cleaning" | "complete";

export type TestLabSession = {
  state: TestLabSessionState;
  repository: string | null;
  branch: string | null;
  sha: string | null;
  bundleName: string | null;
  bundleVersion: string | null;
  bundleArtifact: string | null;
  flavor: string | null;
  workflow: string | null;
  phase: string | null;
  startedAt: string | null;
  updatedAt: string | null;
  clusterReachable: boolean;
  context: string | null;
  stdout: string;
  stderr: string;
  workloads: string;
};

export type TestLabContainerImage = {
  package: string;
  namespace: string;
  pod: string;
  podPhase: string;
  ownerKind: string | null;
  ownerName: string | null;
  container: string;
  containerType: "container" | "init";
  image: string;
  runtimeImage: string;
  digest: string | null;
  ready: boolean;
  sessionChange: "session" | "existing" | "unknown";
};

export type TestLabImageInventory = {
  capturedAt: string;
  baselineAvailable: boolean;
  packages: string[];
  podCount: number;
  items: TestLabContainerImage[];
};

export type TestLabActionResult = {
  ok: boolean;
  message: string;
  session: TestLabSession;
};
