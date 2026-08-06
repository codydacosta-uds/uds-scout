import "server-only";

import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type LocalSettings = {
  repositories: string[];
  setupCompleted: boolean;
  gitlabProjects: string[];
  gitlabDefaultProject: string | null;
};

type StoredSettings = Partial<LocalSettings> & {
  profiles?: Record<string, Partial<LocalSettings>>;
};

export function localSettingsPath() {
  const configured = process.env.UDS_SCOUT_SETTINGS_PATH ?? process.env.D2D_SETTINGS_PATH;
  if (configured) return configured;
  const scoutPath = join(homedir(), ".config", "uds-scout", "settings.json");
  const legacyPath = join(homedir(), ".config", "d2d-operations", "settings.json");
  return !existsSync(scoutPath) && existsSync(legacyPath) ? legacyPath : scoutPath;
}

function normalize(value: Partial<LocalSettings> | undefined): LocalSettings | null {
  if (!value) return null;
  const repositories = value.repositories
    ?.filter((repository): repository is string => typeof repository === "string")
    .map((repository) => repository.trim())
    .filter(Boolean) ?? [];
  const gitlabProjects = value.gitlabProjects
    ?.filter((project): project is string => typeof project === "string")
    .map((project) => project.trim())
    .filter(Boolean) ?? [];
  const uniqueGitlabProjects = [...new Set(gitlabProjects)];
  const requestedDefault = typeof value.gitlabDefaultProject === "string" ? value.gitlabDefaultProject.trim() : null;
  const gitlabDefaultProject = requestedDefault && uniqueGitlabProjects.some((project) => project.toLowerCase() === requestedDefault.toLowerCase())
    ? uniqueGitlabProjects.find((project) => project.toLowerCase() === requestedDefault.toLowerCase()) ?? null
    : null;
  if (value.setupCompleted !== true && !repositories.length && !uniqueGitlabProjects.length) return null;
  return { repositories: [...new Set(repositories)], setupCompleted: value.setupCompleted === true, gitlabProjects: uniqueGitlabProjects, gitlabDefaultProject };
}

function readStoredSettings(): StoredSettings | null {
  try {
    return JSON.parse(readFileSync(/* turbopackIgnore: true */ localSettingsPath(), "utf8")) as StoredSettings;
  } catch {
    return null;
  }
}

export function readLocalSettings(viewer?: string | null): LocalSettings | null {
  const stored = readStoredSettings();
  if (!stored) return null;
  if (viewer && stored.profiles) return normalize(stored.profiles[viewer.toLowerCase()]);
  if (stored.profiles) return null;
  return normalize(stored);
}

export function resetLocalSettings(viewer?: string | null) {
  const path = localSettingsPath();
  const stored = readStoredSettings();
  if (!stored || !existsSync(path)) return;

  if (stored.profiles) {
    if (!viewer || !stored.profiles[viewer.toLowerCase()]) return;
    const profiles = { ...stored.profiles };
    delete profiles[viewer.toLowerCase()];
    if (!Object.keys(profiles).length) {
      unlinkSync(path);
      return;
    }
    const temporaryPath = `${path}.${process.pid}.tmp`;
    writeFileSync(temporaryPath, `${JSON.stringify({ profiles }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    renameSync(temporaryPath, path);
    return;
  }

  unlinkSync(path);
}

export function writeLocalSettings(settings: LocalSettings, viewer?: string | null) {
  const path = localSettingsPath();
  const directory = dirname(path);
  const temporaryPath = `${path}.${process.pid}.tmp`;
  const existing = readStoredSettings();
  const value: StoredSettings = viewer
    ? {
        profiles: {
          ...(existing?.profiles ?? {}),
          [viewer.toLowerCase()]: settings,
        },
      }
    : settings;
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(temporaryPath, path);
}
