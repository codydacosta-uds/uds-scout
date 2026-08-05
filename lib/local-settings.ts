import "server-only";

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type LocalSettings = {
  repositories: string[];
  setupCompleted: boolean;
};

export function localSettingsPath() {
  return process.env.D2D_SETTINGS_PATH ?? join(homedir(), ".config", "d2d-operations", "settings.json");
}

export function readLocalSettings(): LocalSettings | null {
  try {
    const value = JSON.parse(readFileSync(/* turbopackIgnore: true */ localSettingsPath(), "utf8")) as Partial<LocalSettings>;
    const repositories = value.repositories
      ?.filter((repository): repository is string => typeof repository === "string")
      .map((repository) => repository.trim())
      .filter(Boolean);
    return repositories?.length ? { repositories: [...new Set(repositories)], setupCompleted: value.setupCompleted === true } : null;
  } catch {
    return null;
  }
}

export function writeLocalSettings(settings: LocalSettings) {
  const path = localSettingsPath();
  const directory = dirname(path);
  const temporaryPath = `${path}.${process.pid}.tmp`;
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  writeFileSync(temporaryPath, `${JSON.stringify(settings, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(temporaryPath, path);
}
