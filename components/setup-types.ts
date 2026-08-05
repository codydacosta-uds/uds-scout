export type SetupStatus = {
  configured: boolean;
  hasToken: boolean;
  tokenSource: "environment" | "session" | null;
  repositorySource: "environment" | "local" | "unconfigured";
  repositories: string[];
  viewer: SetupViewer | null;
};

export type SetupViewer = {
  login: string;
  name: string | null;
  avatar: string;
  url: string;
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
