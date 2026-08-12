import { beforeEach, describe, expect, it, vi } from "vitest";

const github = vi.hoisted(() => ({
  allPages: vi.fn(),
  request: vi.fn(),
}));
const repositories = vi.hoisted(() => ({
  tracked: vi.fn(),
}));

vi.mock("@/lib/github", () => ({
  githubAllPages: github.allPages,
  githubRequest: github.request,
}));
vi.mock("@/lib/tracked-repositories", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/tracked-repositories")>();
  return { ...original, trackedRepositories: repositories.tracked };
});

import { isManagedTestRepository, testLabCatalog, testLabPlan } from "@/lib/test-lab";

const REPOSITORY = "uds-packages/jenkins";
const SHA = "a".repeat(40);

function encoded(content: string) {
  return { content: Buffer.from(content).toString("base64"), html_url: "https://github.example/file" };
}

function safeFiles(overrides: Partial<Record<"tasks" | "testTasks" | "bundle" | "zarf", string>> = {}) {
  return {
    tasks: `
includes:
  - test: ./tasks/test.yaml
tasks:
  - name: dev
    actions:
      - task: create-dev-package
  - name: create-dev-package
    actions:
      - task: create:package
  - name: create-deploy-test-bundle
    actions:
      - task: dependencies:create
      - task: create:package
      - task: create:test-bundle
      - task: deploy:test-bundle
      - task: setup:create-doug-user
      - task: test:all
`,
    testTasks: `
tasks:
  - name: all
    actions:
      - task: test:smoke
  - name: smoke
    actions:
      - cmd: ./tasks/run-smoke-test.sh
`,
    bundle: `kind: UDSBundle\nmetadata:\n  name: jenkins-test\n  version: 1.2.3\n`,
    zarf: `components:\n  - name: jenkins\n    only:\n      flavor: amd64\n`,
    ...overrides,
  };
}

function mockFiles(files = safeFiles()) {
  github.allPages.mockResolvedValue([{ name: "main", commit: { sha: SHA } }]);
  github.request.mockImplementation((path: string) => {
    if (path.includes("tasks/test.yaml")) return Promise.resolve(encoded(files.testTasks));
    if (path.includes("bundle/uds-bundle.yaml")) return Promise.resolve(encoded(files.bundle));
    if (path.includes("zarf.yaml")) return Promise.resolve(encoded(files.zarf));
    if (path.includes("tasks.yaml")) return Promise.resolve(encoded(files.tasks));
    throw new Error(`Unexpected path: ${path}`);
  });
}

describe("Test Lab policy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    repositories.tracked.mockReturnValue([REPOSITORY, "nswccd-devsecops/sonic-swf-iac"]);
  });

  it("offers only configured package repositories and never SONIC", () => {
    expect(isManagedTestRepository(REPOSITORY.toUpperCase())).toBe(true);
    expect(isManagedTestRepository("nswccd-devsecops/sonic-swf-iac")).toBe(false);
    expect(isManagedTestRepository("uds-packages/not-configured")).toBe(false);
    expect(testLabCatalog().repositories.map((item) => item.fullName)).toEqual([REPOSITORY]);
  });

  it("locks a safe plan to the resolved SHA and declared flavor", async () => {
    mockFiles();
    const plan = await testLabPlan(REPOSITORY, "main");
    expect(plan).toMatchObject({
      repository: REPOSITORY,
      branch: "main",
      sha: SHA,
      flavors: ["amd64"],
      safe: true,
      bundle: { name: "jenkins-test", version: "1.2.3" },
    });
    expect(github.request.mock.calls.every(([path]) => String(path).includes(`ref=${SHA}`))).toBe(true);
  });

  it("rejects direct commands and cluster setup in fixed workflow tasks", async () => {
    const files = safeFiles({
      tasks: safeFiles().tasks.replace("- task: create:package", "- cmd: k3d cluster create unsafe"),
    });
    mockFiles(files);
    const plan = await testLabPlan(REPOSITORY, "main");
    expect(plan?.safe).toBe(false);
    expect(plan?.blockers.join(" ")).toMatch(/direct command|K3d/i);
  });

  it("rejects unknown fixed actions and missing required ordering", async () => {
    const files = safeFiles({
      tasks: safeFiles().tasks.replace("- task: dependencies:create", "- task: arbitrary:command")
        .replace("- task: deploy:test-bundle\n      - task: setup:create-doug-user", "- task: setup:create-doug-user\n      - task: deploy:test-bundle"),
    });
    mockFiles(files);
    const plan = await testLabPlan(REPOSITORY, "main");
    expect(plan?.blockers.join(" ")).toMatch(/unapproved actions/);
    expect(plan?.blockers.join(" ")).toMatch(/required order/);
  });

  it("rejects unsafe package flavors and bundle metadata", async () => {
    mockFiles(safeFiles({
      zarf: `components:\n  - only:\n      flavor: "amd64; rm -rf /"\n`,
      bundle: `kind: UDSBundle\nmetadata:\n  name: "bad name"\n  version: "1.0;evil"\n`,
    }));
    const plan = await testLabPlan(REPOSITORY, "main");
    expect(plan?.safe).toBe(false);
    expect(plan?.flavors).toEqual([]);
    expect(plan?.blockers.join(" ")).toMatch(/unsafe package flavor/);
    expect(plan?.blockers.join(" ")).toMatch(/bundle name is missing or unsafe/i);
  });

  it("rejects missing and unsafe nested repository test tasks", async () => {
    mockFiles(safeFiles({
      testTasks: `
tasks:
  - name: all
    actions:
      - task: test:smoke
  - name: smoke
    actions:
      - task: test:missing
      - cmd: k3d cluster delete uds
`,
    }));
    const plan = await testLabPlan(REPOSITORY, "main");
    expect(plan?.safe).toBe(false);
    expect(plan?.blockers.join(" ")).toMatch(/missing test task: missing/);
    expect(plan?.blockers.join(" ")).toMatch(/cluster setup or K3d/);
  });

  it("does not resolve branches for an unmanaged repository", async () => {
    expect(await testLabPlan("attacker/repository", "main")).toBeNull();
    expect(github.allPages).not.toHaveBeenCalled();
  });
});
