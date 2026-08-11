import type { RenovateReviewDay } from "@/lib/renovate-review";
import type { WorkspacePreset } from "@/lib/repository-constants";

export type SetupStatus = {
  configured: boolean;
  hasToken: boolean;
  tokenSource: "environment" | "session" | null;
  repositorySource: "environment" | "local" | "unconfigured";
  repositories: string[];
  viewer: SetupViewer | null;
  renovateReviewDay: RenovateReviewDay;
  workspacePresets: WorkspacePreset[];
  registry: {
    connected: boolean;
    credentialSource: "environment" | "session" | null;
    environmentAvailable: boolean;
  };
  gitlab: {
    hasToken: boolean;
    tokenSource: "environment" | "session" | null;
    environmentAvailable: boolean;
    viewer: SetupGitlabViewer | null;
    projects: string[];
    defaultProject: string | null;
  };
};

export type SetupViewer = {
  login: string;
  name: string | null;
  avatar: string;
  url: string;
};

export type SetupGitlabViewer = {
  username: string;
  name: string | null;
  avatar: string | null;
  url: string;
};

export type SetupGitlabProject = {
  id: number;
  name: string;
  fullPath: string;
  url: string;
  description: string | null;
  updatedAt: string;
  canCreateTickets: boolean;
  ticketValidation: string;
};

export type SetupRepository = {
  id: number;
  name: string;
  fullName: string;
  private: boolean;
  description: string | null;
  url: string;
  owner: string;
  updatedAt: string;
};

export type SetupRepositoryCatalog = {
  repositories: SetupRepository[];
};

export type SetupGitlabProjectCatalog = {
  projects: SetupGitlabProject[];
  selectedProjects: string[];
  defaultProject: string | null;
};
