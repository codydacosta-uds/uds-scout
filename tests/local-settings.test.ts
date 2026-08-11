import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readLocalSettings, writeLocalSettings, type LocalSettings } from "@/lib/local-settings";

const previousPath = process.env.UDS_SCOUT_SETTINGS_PATH;
afterEach(() => {
  if (previousPath === undefined) delete process.env.UDS_SCOUT_SETTINGS_PATH;
  else process.env.UDS_SCOUT_SETTINGS_PATH = previousPath;
});

function settings(): LocalSettings {
  return {
    repositories: ["uds-packages/jenkins"],
    setupCompleted: true,
    gitlabEnabled: true,
    gitlabProjects: ["group/project"],
    gitlabDefaultProject: "group/project",
    renovateReviewDay: "friday",
    workspacePresets: [],
  };
}

describe("local settings", () => {
  it("writes non-secret settings with owner-only file permissions", () => {
    const directory = mkdtempSync(join(tmpdir(), "uds-scout-settings-"));
    const path = join(directory, "nested", "settings.json");
    process.env.UDS_SCOUT_SETTINGS_PATH = path;
    writeLocalSettings(settings(), "Engineer");

    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(join(directory, "nested")).mode & 0o777).toBe(0o700);
    expect(readLocalSettings("engineer")).toEqual(settings());
    expect(readFileSync(path, "utf8")).not.toMatch(/github_pat_|glpat-/i);
  });

  it("keeps viewer profiles isolated", () => {
    const directory = mkdtempSync(join(tmpdir(), "uds-scout-settings-"));
    process.env.UDS_SCOUT_SETTINGS_PATH = join(directory, "settings.json");
    writeLocalSettings(settings(), "Engineer");
    expect(readLocalSettings("someone-else")).toBeNull();
    expect(readLocalSettings()).toBeNull();
  });
});
