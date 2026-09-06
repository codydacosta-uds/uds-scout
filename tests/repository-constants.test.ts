import { describe, expect, it } from "vitest";
import {
  CONFIGURED_WORKSPACE_PRESETS,
  isSecurityContextRepository,
  SONIC_REPOSITORY,
  TEST_LAB_REPOSITORIES,
  workspacePresetsWithConfig,
} from "@/lib/repository-constants";

describe("repository policy", () => {
  it("provides repository security context for every selected repository", () => {
    expect(isSecurityContextRepository(SONIC_REPOSITORY.toUpperCase())).toBe(true);
    expect(isSecurityContextRepository("uds-packages/jenkins")).toBe(true);
  });

  it("never includes SONIC in the Test Lab allowlist", () => {
    expect(TEST_LAB_REPOSITORIES).not.toContain(SONIC_REPOSITORY);
    expect(TEST_LAB_REPOSITORIES).toHaveLength(5);
  });

  it("prevents user presets from shadowing configured presets", () => {
    const configured = CONFIGURED_WORKSPACE_PRESETS[0];
    const result = workspacePresetsWithConfig([
      { id: configured.id.toUpperCase(), label: "shadow by id", repositories: ["owner/repo"] },
      { id: "different", label: configured.label.toUpperCase(), repositories: ["owner/repo"] },
      { id: "mine", label: "Mine", repositories: ["owner/repo"] },
    ]);
    expect(result.filter((preset) => preset.source === "user")).toEqual([
      { id: "mine", label: "Mine", repositories: ["owner/repo"], source: "user" },
    ]);
  });
});
