import "server-only";

import { spawn } from "node:child_process";
import { load } from "js-yaml";
import type { TestLabBranch, TestLabCatalog, TestLabImageInventory, TestLabPlan, TestLabSession, TestLabWorkflowMode } from "@/components/test-lab-types";
import type { ZeusHealth } from "@/components/types";
import { githubAllPages, githubRequest } from "@/lib/github";
import { TEST_LAB_REPOSITORIES, trackedRepositories } from "@/lib/tracked-repositories";

const SSH_TARGET = "d2d-test-lab";
const TARGET_ADDRESS = "zeus@100.99.63.8";
const MAX_OUTPUT = 64 * 1024;
const ALLOWED_DEV_ACTIONS = new Set([
  "create-dev-package",
  "dependencies:create",
  "create:test-bundle",
  "deploy:test-bundle",
]);
const ALLOWED_CREATE_ACTIONS = new Set(["create:package"]);
const ALLOWED_DEPLOY_TEST_ACTIONS = new Set([
  "dependencies:create",
  "create:package",
  "create:test-bundle",
  "deploy:test-bundle",
  "setup:create-doug-user",
  "test:all",
]);
const REQUIRED_DEPLOY_TEST_ACTIONS = [
  "create:test-bundle",
  "deploy:test-bundle",
  "setup:create-doug-user",
  "test:all",
];

type RawBranch = { name: string; commit: { sha: string } };
type ContentResponse = { content: string; html_url: string };
type TaskDefinition = {
  name?: string;
  description?: string;
  actions?: Array<{ task?: string; cmd?: unknown; wait?: unknown }>;
};
type TasksDocument = {
  includes?: Array<Record<string, string>>;
  tasks?: TaskDefinition[];
};
type BundleDocument = {
  kind?: string;
  metadata?: { name?: string; version?: string };
};
type ZarfDocument = {
  components?: Array<{ only?: { flavor?: string } }>;
};

type RemoteResult = { code: number | null; stdout: string; stderr: string };

let zeusHealthCache: { expiresAt: number; value: ZeusHealth } | null = null;

function managedRepositories() {
  const configured = new Set(trackedRepositories().map((repository) => repository.toLowerCase()));
  return TEST_LAB_REPOSITORIES.filter((repository) => configured.has(repository.toLowerCase()));
}

export function testLabCatalog(): TestLabCatalog {
  return {
    target: {
      hostname: "zeus",
      address: TARGET_ADDRESS,
      transport: "Restricted SSH key via d2d-test-lab",
    },
    repositories: managedRepositories().map((fullName) => ({
      fullName,
      name: fullName.split("/")[1],
    })),
  };
}

export function isManagedTestRepository(repository: string) {
  return managedRepositories().some((candidate) => candidate.toLowerCase() === repository.toLowerCase());
}

export async function testLabBranches(repository: string): Promise<TestLabBranch[]> {
  if (!isManagedTestRepository(repository)) return [];
  const branches = await githubAllPages<RawBranch>(`/repos/${repository}/branches`, 10);
  return branches
    .map((branch) => ({ name: branch.name, sha: branch.commit.sha }))
    .sort((a, b) => a.name === "main" ? -1 : b.name === "main" ? 1 : a.name.localeCompare(b.name));
}

function decodeContent(file: ContentResponse) {
  return Buffer.from(file.content, "base64").toString("utf8");
}

function safeMetadataValue(value: string | undefined) {
  return Boolean(value && /^[a-zA-Z0-9._-]+$/.test(value));
}

export async function testLabPlan(repository: string, branch: string): Promise<TestLabPlan | null> {
  if (!isManagedTestRepository(repository)) return null;
  const branches = await testLabBranches(repository);
  const selected = branches.find((candidate) => candidate.name === branch);
  if (!selected) return null;

  const ref = encodeURIComponent(selected.sha);
  const [tasksFile, testTasksFile, bundleFile, zarfFile] = await Promise.all([
    githubRequest<ContentResponse>(`/repos/${repository}/contents/tasks.yaml?ref=${ref}`, 30_000),
    githubRequest<ContentResponse>(`/repos/${repository}/contents/tasks/test.yaml?ref=${ref}`, 30_000),
    githubRequest<ContentResponse>(`/repos/${repository}/contents/bundle/uds-bundle.yaml?ref=${ref}`, 30_000),
    githubRequest<ContentResponse>(`/repos/${repository}/contents/zarf.yaml?ref=${ref}`, 30_000),
  ]);
  const tasks = load(decodeContent(tasksFile)) as TasksDocument | null;
  const testTasks = load(decodeContent(testTasksFile)) as TasksDocument | null;
  const bundle = load(decodeContent(bundleFile)) as BundleDocument | null;
  const zarf = load(decodeContent(zarfFile)) as ZarfDocument | null;
  const declaredFlavors = zarf?.components?.flatMap((component) => component.only?.flavor ? [component.only.flavor] : []) ?? [];
  const flavors = [...new Set(declaredFlavors.filter((flavor) => safeMetadataValue(flavor)))].sort();
  const dev = tasks?.tasks?.find((task) => task.name === "dev");
  const createDev = tasks?.tasks?.find((task) => task.name === "create-dev-package");
  const deployTest = tasks?.tasks?.find((task) => task.name === "create-deploy-test-bundle");
  const testAll = testTasks?.tasks?.find((task) => task.name === "all");
  const devActions = dev?.actions?.flatMap((action) => action.task ? [action.task] : []) ?? [];
  const createActions = createDev?.actions?.flatMap((action) => action.task ? [action.task] : []) ?? [];
  const deployTestActions = deployTest?.actions?.flatMap((action) => action.task ? [action.task] : []) ?? [];
  const testActions = testAll?.actions?.flatMap((action) => action.task ? [action.task.replace(/^test:/, "")] : []) ?? [];
  const blockers: string[] = [];
  const deployOnlyBlockers: string[] = [];

  if (declaredFlavors.some((flavor) => !safeMetadataValue(flavor))) {
    blockers.push("zarf.yaml declares an unsafe package flavor.");
    deployOnlyBlockers.push("zarf.yaml declares an unsafe package flavor.");
  }

  if (!dev) deployOnlyBlockers.push("The selected branch does not define dev.");
  if (dev?.actions?.some((action) => action.cmd !== undefined || !action.task)) {
    deployOnlyBlockers.push("The dev task contains a direct command instead of approved task references.");
  }
  const unsafeDevActions = devActions.filter((action) => !ALLOWED_DEV_ACTIONS.has(action));
  if (unsafeDevActions.length) deployOnlyBlockers.push(`The dev task references unapproved actions: ${unsafeDevActions.join(", ")}.`);
  if (/k3d|setup:k3d/i.test(JSON.stringify(dev ?? {}))) deployOnlyBlockers.push("The dev task references cluster setup or K3d.");

  const createBlockers: string[] = [];
  if (!createDev) createBlockers.push("The selected branch does not define create-dev-package.");
  if (createDev?.actions?.some((action) => action.cmd !== undefined || !action.task)) {
    createBlockers.push("create-dev-package contains a direct command instead of an approved task reference.");
  }
  const unsafeCreateActions = createActions.filter((action) => !ALLOWED_CREATE_ACTIONS.has(action));
  if (unsafeCreateActions.length) createBlockers.push(`create-dev-package references unapproved actions: ${unsafeCreateActions.join(", ")}.`);
  if (/k3d|setup:k3d/i.test(JSON.stringify(createDev ?? {}))) createBlockers.push("create-dev-package references cluster setup or K3d.");
  blockers.push(...createBlockers);
  if (devActions.includes("create-dev-package")) deployOnlyBlockers.push(...createBlockers);

  if (!deployTest) blockers.push("The selected branch does not define create-deploy-test-bundle.");
  if (deployTest?.actions?.some((action) => action.cmd !== undefined || !action.task)) {
    blockers.push("create-deploy-test-bundle contains a direct command instead of approved task references.");
  }
  const unsafeDeployTestActions = deployTestActions.filter((action) => !ALLOWED_DEPLOY_TEST_ACTIONS.has(action));
  if (unsafeDeployTestActions.length) blockers.push(`create-deploy-test-bundle references unapproved actions: ${unsafeDeployTestActions.join(", ")}.`);
  const requiredIndexes = REQUIRED_DEPLOY_TEST_ACTIONS.map((action) => deployTestActions.indexOf(action));
  if (requiredIndexes.some((index) => index < 0)) {
    blockers.push("create-deploy-test-bundle must create the bundle, deploy it, create the test user, and run test:all.");
  } else if (requiredIndexes.some((index, position) => position > 0 && index <= requiredIndexes[position - 1])) {
    blockers.push("create-deploy-test-bundle does not run deployment and tests in the required order.");
  }
  if (/k3d|setup:k3d/i.test(JSON.stringify(deployTest ?? {}))) blockers.push("create-deploy-test-bundle references cluster setup or K3d.");

  const testInclude = tasks?.includes?.find((include) => include.test)?.test;
  if (testInclude !== "./tasks/test.yaml") blockers.push("The test task include must resolve to ./tasks/test.yaml.");
  if (!testAll) blockers.push("tasks/test.yaml does not define test:all.");
  if (!testActions.length) blockers.push("test:all does not reference any repository tests.");
  if (testAll?.actions?.some((action) => action.cmd !== undefined)) {
    blockers.push("test:all must delegate to named repository tests instead of running a direct command.");
  }

  const testTasksByName = new Map((testTasks?.tasks ?? []).flatMap((task) => task.name ? [[task.name, task]] : []));
  const reachableTestTasks = [...testActions];
  const visitedTestTasks = new Set<string>();
  while (reachableTestTasks.length) {
    const testAction = reachableTestTasks.shift()!;
    if (!/^[a-zA-Z0-9._-]+$/.test(testAction)) {
      blockers.push(`test:all references an invalid test task: ${testAction}.`);
      continue;
    }
    if (visitedTestTasks.has(testAction)) continue;
    visitedTestTasks.add(testAction);
    const task = testTasksByName.get(testAction);
    if (!task) {
      blockers.push(`test:all references a missing test task: ${testAction}.`);
      continue;
    }
    if (/k3d|setup:k3d/i.test(JSON.stringify(task))) {
      blockers.push("The repository test suite references cluster setup or K3d.");
    }
    for (const action of task.actions ?? []) {
      if (!action.task) continue;
      reachableTestTasks.push(action.task.replace(/^test:/, ""));
    }
  }

  if (bundle?.kind !== "UDSBundle") {
    blockers.push("bundle/uds-bundle.yaml is not a UDSBundle.");
    deployOnlyBlockers.push("bundle/uds-bundle.yaml is not a UDSBundle.");
  }
  if (!safeMetadataValue(bundle?.metadata?.name)) {
    blockers.push("The bundle name is missing or unsafe.");
    deployOnlyBlockers.push("The bundle name is missing or unsafe.");
  }
  if (!safeMetadataValue(bundle?.metadata?.version)) {
    blockers.push("The bundle version is missing or unsafe.");
    deployOnlyBlockers.push("The bundle version is missing or unsafe.");
  }

  return {
    repository,
    branch,
    sha: selected.sha,
    flavors,
    deployOnly: {
      steps: [
        {
          task: "dev",
          title: "Build and deploy the development bundle",
          description: dev?.description ?? "Build and deploy the selected branch on the existing cluster.",
          actions: devActions,
        },
      ],
      tests: [],
      safe: deployOnlyBlockers.length === 0,
      blockers: deployOnlyBlockers,
    },
    workflow: {
      steps: [
        {
          task: "create-dev-package",
          title: "Build the development package",
          description: createDev?.description ?? "Build the selected branch's package.",
          actions: createActions,
        },
        {
          task: "create-deploy-test-bundle",
          title: "Create, deploy, and test the bundle",
          description: deployTest?.description ?? "Deploy to the existing cluster and run the repository test suite.",
          actions: deployTestActions,
        },
      ],
      tests: testActions,
      safe: blockers.length === 0,
      blockers,
    },
    bundle: {
      path: "bundle/uds-bundle.yaml",
      name: bundle?.metadata?.name ?? "unknown",
      version: bundle?.metadata?.version ?? "unknown",
    },
    safe: blockers.length === 0,
    blockers,
  };
}

function cleanOutput(value: string) {
  return value
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/[^\n]*\r/g, "")
    .slice(-MAX_OUTPUT)
    .trimEnd();
}

async function remoteCommand(action: string, args: string[] = [], timeoutMs = 30_000): Promise<RemoteResult> {
  const command = [action, ...args].join(" ");
  return new Promise((resolve, reject) => {
    const child = spawn("/usr/bin/ssh", [
      "-o", "BatchMode=yes",
      "-o", "ConnectTimeout=8",
      "-o", "StrictHostKeyChecking=yes",
      SSH_TARGET,
      command,
    ], { shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) return reject(new Error("The remote Test Lab command timed out."));
      resolve({ code, stdout: cleanOutput(stdout), stderr: cleanOutput(stderr) });
    });
  });
}

function validUsage(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
}

export async function zeusHealth(): Promise<ZeusHealth> {
  if (zeusHealthCache && zeusHealthCache.expiresAt > Date.now()) return zeusHealthCache.value;
  const result = await remoteCommand("host-status", [], 10_000);
  if (result.code !== 0) throw new Error(result.stderr || "Zeus host status could not be read.");

  let value: ZeusHealth;
  try {
    value = JSON.parse(result.stdout) as ZeusHealth;
  } catch {
    throw new Error("Zeus returned an invalid host status response.");
  }
  if (
    typeof value.hostname !== "string" ||
    !value.hostname ||
    !value.capturedAt ||
    !Number.isInteger(value.cpuCount) ||
    value.cpuCount < 1 ||
    !validUsage(value.cpuUsagePercent) ||
    !Array.isArray(value.loadAverage) ||
    value.loadAverage.length !== 3 ||
    !value.memory ||
    !validUsage(value.memory.usagePercent) ||
    !Array.isArray(value.filesystems) ||
    !value.filesystems.length ||
    value.filesystems.some((filesystem) => !filesystem.path || !validUsage(filesystem.usagePercent)) ||
    !value.temporaryStorage ||
    value.temporaryStorage.path !== "/tmp" ||
    (value.temporaryStorage.usedBytes !== null && (typeof value.temporaryStorage.usedBytes !== "number" || value.temporaryStorage.usedBytes < 0)) ||
    typeof value.uptimeSeconds !== "number"
  ) {
    throw new Error("Zeus returned incomplete host status data.");
  }
  zeusHealthCache = { expiresAt: Date.now() + 30_000, value };
  return value;
}

function valueOrNull(value: string | undefined) {
  return value && value !== "-" ? value : null;
}

function parseSession(output: string): TestLabSession {
  const [metadataText, stdoutPart = "", stderrPart = "", workloadsPart = ""] = output.split(/---(?:STDOUT|STDERR|WORKLOADS)---\n?/);
  const metadata = new Map(metadataText.split("\n").flatMap((line) => {
    const index = line.indexOf("=");
    return index > 0 ? [[line.slice(0, index), line.slice(index + 1)]] : [];
  }));
  const stateValue = valueOrNull(metadata.get("STATE"));
  const state = ["idle", "prepared", "deploying", "deployed", "failed", "cleaning", "complete"].includes(stateValue ?? "")
    ? stateValue as TestLabSession["state"]
    : "idle";
  return {
    state,
    repository: valueOrNull(metadata.get("REPOSITORY")),
    branch: valueOrNull(metadata.get("BRANCH")),
    sha: valueOrNull(metadata.get("SHA")),
    bundleName: valueOrNull(metadata.get("BUNDLE_NAME")),
    bundleVersion: valueOrNull(metadata.get("BUNDLE_VERSION")),
    bundleArtifact: valueOrNull(metadata.get("BUNDLE_ARTIFACT")),
    flavor: valueOrNull(metadata.get("FLAVOR")),
    workflow: valueOrNull(metadata.get("WORKFLOW")),
    phase: valueOrNull(metadata.get("PHASE")),
    startedAt: valueOrNull(metadata.get("STARTED_AT")),
    updatedAt: valueOrNull(metadata.get("UPDATED_AT")),
    clusterReachable: metadata.get("CLUSTER_REACHABLE") === "true",
    context: valueOrNull(metadata.get("CONTEXT")),
    stdout: stdoutPart.trimEnd(),
    stderr: stderrPart.trimEnd(),
    workloads: workloadsPart.trimEnd(),
  };
}

export async function testLabSession() {
  const result = await remoteCommand("session-status");
  if (result.code !== 0) throw new Error(result.stderr || "The Test Lab session could not be read.");
  return parseSession(result.stdout);
}

export async function testLabImages() {
  const result = await remoteCommand("session-images");
  if (result.code !== 0) throw new Error(result.stderr || "The Test Lab image inventory could not be read.");
  try {
    return JSON.parse(result.stdout) as TestLabImageInventory;
  } catch {
    throw new Error("The Test Lab image inventory returned an invalid response.");
  }
}

export async function prepareTestLabSession(plan: TestLabPlan, workflow: TestLabWorkflowMode, flavor: string | null) {
  const capabilities = await remoteCommand("runner-capabilities", [], 10_000);
  if (capabilities.code !== 0 || !capabilities.stdout.split("\n").includes("flavor-selection-v1")) {
    throw new Error("The Zeus Test Lab runner must be updated before flavor-aware deployments can start.");
  }
  const result = await remoteCommand("prepare", [plan.repository, plan.branch, plan.sha, plan.bundle.name, plan.bundle.version, workflow, flavor ?? "-"], 120_000);
  if (result.code !== 0) throw new Error(result.stderr || result.stdout || "The remote workspace could not be prepared.");
  return testLabSession();
}

export async function startTestLabDeployment() {
  const result = await remoteCommand("deploy-start");
  if (result.code !== 0) throw new Error(result.stderr || result.stdout || "The deployment could not be started.");
  return testLabSession();
}

export async function startTestLabCleanup() {
  const result = await remoteCommand("cleanup-start");
  if (result.code !== 0) throw new Error(result.stderr || result.stdout || "Cleanup could not be started.");
  return testLabSession();
}

export async function resetTestLabSession() {
  const result = await remoteCommand("session-reset");
  if (result.code !== 0) throw new Error(result.stderr || result.stdout || "The Test Lab session could not be reset.");
  return testLabSession();
}
