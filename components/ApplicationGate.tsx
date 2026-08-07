"use client";

/* eslint-disable react-hooks/set-state-in-effect -- Setup state is synchronized with local API routes. */

import Badge from "@cloudscape-design/components/badge";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ButtonDropdown from "@cloudscape-design/components/button-dropdown";
import Container from "@cloudscape-design/components/container";
import Flashbar from "@cloudscape-design/components/flashbar";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import Link from "@cloudscape-design/components/link";
import Modal from "@cloudscape-design/components/modal";
import Multiselect from "@cloudscape-design/components/multiselect";
import Pagination from "@cloudscape-design/components/pagination";
import Select from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import Table from "@cloudscape-design/components/table";
import Tabs from "@cloudscape-design/components/tabs";
import TextFilter from "@cloudscape-design/components/text-filter";
import TopNavigation from "@cloudscape-design/components/top-navigation";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { WorkspacePreset } from "@/lib/repository-constants";
import { RENOVATE_REVIEW_DAYS, type RenovateReviewDay } from "@/lib/renovate-review";
import type { SetupGitlabProject, SetupGitlabProjectCatalog, SetupGitlabViewer, SetupRepository, SetupRepositoryCatalog, SetupStatus, SetupViewer } from "./setup-types";

let cachedSetupStatus: SetupStatus | null = null;
const MAX_MANAGED_REPOSITORIES = 25;
const renovateReviewScheduleOptions = [
  ...RENOVATE_REVIEW_DAYS.slice(1),
  RENOVATE_REVIEW_DAYS[0],
].map((day) => ({ label: `${day.charAt(0).toUpperCase()}${day.slice(1)}`, value: day as RenovateReviewDay })).concat({ label: "Do not show", value: "hidden" });

const setupContinueStyle = {
  root: {
    background: { default: "var(--d2d-color-warning)", hover: "var(--d2d-color-warning-hover)", active: "var(--d2d-color-warning-active)" },
    borderColor: { default: "var(--d2d-color-warning)", hover: "var(--d2d-color-warning-hover)", active: "var(--d2d-color-warning-active)" },
    color: { default: "#0b0c0e", hover: "#0b0c0e", active: "#0b0c0e" },
  },
} as const;

function SetupLoading() {
  return <div className="setup-status-pending" role="status" aria-label="Checking Scout workspace" aria-busy="true" />;
}

function SetupWizard({ status, settingsMode, initialSettingsTab = "workspace", replayMode = false, onComplete, onReset }: {
  status: SetupStatus;
  settingsMode: boolean;
  initialSettingsTab?: "workspace" | "connections" | "github" | "gitlab";
  replayMode?: boolean;
  onComplete: (status: SetupStatus) => void;
  onReset: () => void;
}) {
  const router = useRouter();
  const startsAtRepositories = settingsMode && status.hasToken;
  const startsWithWelcome = !status.configured && !settingsMode;
  const [step, setStep] = useState<"welcome" | "token" | "repositories" | "gitlab-projects">(startsWithWelcome ? "welcome" : startsAtRepositories ? "repositories" : "token");
  const [tokenReady, setTokenReady] = useState(status.hasToken);
  const [connectedViewer, setConnectedViewer] = useState<SetupViewer | null>(status.viewer);
  const [token, setToken] = useState("");
  const [gitlabToken, setGitlabToken] = useState("");
  const [gitlabTokenReady, setGitlabTokenReady] = useState(status.gitlab.hasToken);
  const [connectedGitlabViewer, setConnectedGitlabViewer] = useState<SetupGitlabViewer | null>(status.gitlab.viewer);
  const [gitlabProjects, setGitlabProjects] = useState<SetupGitlabProject[]>([]);
  const [selectedGitlabProjects, setSelectedGitlabProjects] = useState<Set<string>>(() => new Set(status.gitlab.projects.map((project) => project.toLowerCase())));
  const [gitlabDefaultProject, setGitlabDefaultProject] = useState(status.gitlab.defaultProject);
  const [renovateReviewDay, setRenovateReviewDay] = useState<RenovateReviewDay>(status.renovateReviewDay);
  const [renovateReviewSaving, setRenovateReviewSaving] = useState(false);
  const [renovateReviewConfirmation, setRenovateReviewConfirmation] = useState<string | null>(null);
  const [gitlabProjectsLoading, setGitlabProjectsLoading] = useState(status.gitlab.hasToken);
  const [gitlabProjectsLoaded, setGitlabProjectsLoaded] = useState(false);
  const [gitlabConnecting, setGitlabConnecting] = useState(false);
  const [repositories, setRepositories] = useState<SetupRepository[]>([]);
  const [selectedNames, setSelectedNames] = useState<Set<string>>(() => new Set((replayMode && status.repositorySource !== "environment" ? [] : status.repositories).map((repository) => repository.toLowerCase())));
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [repositoryUpdateStatus, setRepositoryUpdateStatus] = useState<"saving" | "rebuilding" | "complete" | "failed" | null>(null);
  const [resetting, setResetting] = useState(false);
  const [resetConfirmVisible, setResetConfirmVisible] = useState(false);
  const [rerunSetupConfirmVisible, setRerunSetupConfirmVisible] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [settingsTab, setSettingsTab] = useState(initialSettingsTab);
  const [disconnectTarget, setDisconnectTarget] = useState<"github" | "gitlab" | null>(null);
  const [disconnectConfirmation, setDisconnectConfirmation] = useState("");
  const [repositoriesLoading, setRepositoriesLoading] = useState(startsAtRepositories);
  const [repositoriesLoaded, setRepositoriesLoaded] = useState(false);
  const [quickSelectUndo, setQuickSelectUndo] = useState<{ label: string; changed: number; action: "added" | "removed"; selection: Set<string> } | null>(null);
  const [workspacePresets, setWorkspacePresets] = useState<WorkspacePreset[]>(status.workspacePresets);
  const [presetManagerVisible, setPresetManagerVisible] = useState(false);
  const [presetEditor, setPresetEditor] = useState<WorkspacePreset | null>(null);
  const [presetSaving, setPresetSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const repositoriesLocked = status.repositorySource === "environment";
  const setupStepCount = gitlabTokenReady ? 3 : 2;

  useEffect(() => {
    if (step !== "repositories" || repositoriesLoaded) return;
    const controller = new AbortController();
    let active = true;
    setRepositoriesLoading(true);
    setError(null);
    fetch("/api/setup/repositories", { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Repositories could not be loaded.");
        return data as SetupRepositoryCatalog;
      })
      .then((data) => {
        if (!active) return;
        setRepositories(data.repositories);
        setRepositoriesLoaded(true);
      })
      .catch((reason) => {
        if (active && reason.name !== "AbortError") {
          setError(reason.message);
          setRepositoriesLoaded(true);
        }
      })
      .finally(() => {
        if (active) setRepositoriesLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [step, repositoriesLoaded]);

  useEffect(() => {
    if (!gitlabTokenReady || gitlabProjectsLoaded) return;
    const controller = new AbortController();
    let active = true;
    setGitlabProjectsLoading(true);
    fetch("/api/setup/gitlab/projects", { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Gitlab projects could not be loaded.");
        return data as SetupGitlabProjectCatalog;
      })
      .then((data) => {
        if (!active) return;
        const availableProjects = new Set(data.projects.map((project) => project.fullPath.toLowerCase()));
        const selectedProjects = new Set(data.selectedProjects.map((project) => project.toLowerCase()).filter((project) => availableProjects.has(project)));
        const defaultProject = data.defaultProject && selectedProjects.has(data.defaultProject.toLowerCase()) ? data.defaultProject : null;
        setGitlabProjects(data.projects);
        setSelectedGitlabProjects(selectedProjects);
        setGitlabDefaultProject(defaultProject);
        setGitlabProjectsLoaded(true);
      })
      .catch((reason) => {
        if (active && reason.name !== "AbortError") setError(reason.message);
      })
      .finally(() => {
        if (active) setGitlabProjectsLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [gitlabProjectsLoaded, gitlabTokenReady]);

  const continueToRepositories = () => {
    if (!repositoriesLoaded) setRepositoriesLoading(true);
    setStep("repositories");
  };

  const connect = async () => {
    if (!token.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/setup/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await response.json() as { viewer?: SetupViewer; error?: string };
      if (!response.ok || !data.viewer) throw new Error(data.error ?? "GitHub could not be connected.");
      setToken("");
      setConnectedViewer(data.viewer);
      setTokenReady(true);
      setRepositories([]);
      setRepositoriesLoaded(false);
      setSelectedNames(new Set());
      setQuickSelectUndo(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "GitHub could not be connected.");
    } finally {
      setLoading(false);
    }
  };

  const resetSetup = async () => {
    setResetting(true);
    setError(null);
    try {
      const response = await fetch("/api/setup/reset", { method: "POST" });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Setup could not be reset.");
      cachedSetupStatus = null;
      setResetConfirmVisible(false);
      onReset();
      router.replace("/");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Setup could not be reset.");
      setResetConfirmVisible(false);
    } finally {
      setResetting(false);
    }
  };

  const disconnectAccount = async () => {
    if (!disconnectTarget) return;
    setDisconnecting(true);
    setError(null);
    try {
      const provider = disconnectTarget;
      const response = await fetch("/api/setup/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? `${provider === "github" ? "GitHub" : "Gitlab"} could not be disconnected.`);
      setDisconnectTarget(null);
      setDisconnectConfirmation("");
      if (provider === "github") {
        cachedSetupStatus = null;
        onReset();
        router.replace("/setup");
        return;
      }
      setGitlabTokenReady(false);
      setConnectedGitlabViewer(null);
      setGitlabToken("");
      setGitlabProjects([]);
      setGitlabProjectsLoaded(false);
      setSelectedGitlabProjects(new Set());
      setGitlabDefaultProject(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The account could not be disconnected.");
      setDisconnectTarget(null);
      setDisconnectConfirmation("");
    } finally {
      setDisconnecting(false);
    }
  };

  const connectGitlab = async () => {
    if (!gitlabToken.trim()) return;
    setGitlabConnecting(true);
    setError(null);
    try {
      const response = await fetch("/api/setup/gitlab/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: gitlabToken }),
      });
      const data = await response.json() as { viewer?: SetupGitlabViewer; error?: string };
      if (!response.ok || !data.viewer) throw new Error(data.error ?? "Gitlab could not be connected.");
      setGitlabToken("");
      setConnectedGitlabViewer(data.viewer);
      setGitlabTokenReady(true);
      setGitlabProjectsLoaded(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Gitlab could not be connected.");
    } finally {
      setGitlabConnecting(false);
    }
  };

  const save = async () => {
    setLoading(true);
    setError(null);
    try {
      const selected = repositories
        .filter((repository) => selectedNames.has(repository.fullName.toLowerCase()))
        .map((repository) => repository.fullName);
      const savedRepositoryNames = new Set(status.repositories.map((repository) => repository.toLowerCase()));
      const repositoriesChanged = selectedNames.size !== savedRepositoryNames.size || [...selectedNames].some((repository) => !savedRepositoryNames.has(repository));
      setRepositoryUpdateStatus(settingsMode && repositoriesChanged ? "saving" : null);
      const gitlabSettings = !gitlabTokenReady
        ? { gitlabProjects: [], gitlabDefaultProject: null }
        : gitlabProjectsLoaded
          ? {
              gitlabProjects: gitlabProjects.filter((project) => selectedGitlabProjects.has(project.fullPath.toLowerCase())).map((project) => project.fullPath),
              gitlabDefaultProject,
            }
          : {};
      const response = await fetch("/api/setup/repositories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repositories: selected, ...gitlabSettings }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Managed repositories could not be saved.");
      const nextStatus: SetupStatus = {
        configured: true,
        hasToken: true,
        tokenSource: status.tokenSource ?? "session",
        repositorySource: repositoriesLocked ? "environment" : "local",
        repositories: data.repositories,
        viewer: connectedViewer ?? status.viewer,
        renovateReviewDay: data.renovateReviewDay ?? status.renovateReviewDay,
        workspacePresets: data.workspacePresets ?? status.workspacePresets,
        gitlab: {
          hasToken: gitlabTokenReady,
          tokenSource: status.gitlab.tokenSource ?? (gitlabTokenReady ? "session" : null),
          viewer: connectedGitlabViewer,
          projects: data.gitlabProjects ?? [],
          defaultProject: data.gitlabDefaultProject ?? null,
        },
      };
      cachedSetupStatus = nextStatus;
      if (!settingsMode || repositoriesChanged) {
        try {
          window.sessionStorage.setItem("uds-scout:show-initial-load-warning", "true");
        } catch {
          // The update notice remains optional when browser storage is unavailable.
        }
      }
      onComplete(nextStatus);
      if (!settingsMode) {
        router.replace("/");
      } else if (repositoriesChanged) {
        setRepositoryUpdateStatus("rebuilding");
        try {
          const rebuildResponse = await fetch(`/api/github/overview?workspaceUpdate=${Date.now()}`);
          if (!rebuildResponse.ok) throw new Error("The dashboard refresh could not be completed.");
          setRepositoryUpdateStatus("complete");
        } catch {
          setRepositoryUpdateStatus("failed");
        }
      }
    } catch (reason) {
      setRepositoryUpdateStatus(null);
      setError(reason instanceof Error ? reason.message : "Managed repositories could not be saved.");
    } finally {
      setLoading(false);
    }
  };

  const saveRenovateReviewSchedule = async () => {
    setRenovateReviewSaving(true);
    setError(null);
    setRenovateReviewConfirmation(null);
    try {
      const response = await fetch("/api/setup/preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ renovateReviewDay }),
      });
      const data = await response.json() as { renovateReviewDay?: RenovateReviewDay; error?: string };
      if (!response.ok || !data.renovateReviewDay) throw new Error(data.error ?? "The Renovate review schedule could not be saved.");
      const nextStatus = { ...status, renovateReviewDay: data.renovateReviewDay };
      cachedSetupStatus = nextStatus;
      onComplete(nextStatus);
      const scheduleLabel = renovateReviewScheduleOptions.find((option) => option.value === data.renovateReviewDay)?.label ?? data.renovateReviewDay;
      setRenovateReviewConfirmation(data.renovateReviewDay === "hidden" ? "The Renovate review table is now hidden." : `The Renovate review table will now appear on ${scheduleLabel} using your browser's local day.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The Renovate review schedule could not be saved.");
    } finally {
      setRenovateReviewSaving(false);
    }
  };

  const selectedRenovateReviewSchedule = renovateReviewScheduleOptions.find((option) => option.value === renovateReviewDay) ?? renovateReviewScheduleOptions[0];
  const query = filter.trim().toLowerCase();
  const matchingRepositories = useMemo(() => repositories
    .filter((repository) => !query || [repository.name, repository.fullName, repository.owner, repository.description ?? "", repository.private ? "private" : "public"].some((value) => value.toLowerCase().includes(query)))
    .sort((left, right) => left.fullName.localeCompare(right.fullName)), [repositories, query]);
  const selectedRepositories = useMemo(() => repositories
    .filter((repository) => selectedNames.has(repository.fullName.toLowerCase()))
    .sort((left, right) => left.fullName.localeCompare(right.fullName)), [repositories, selectedNames]);
  const filteredRepositories = settingsMode
    ? matchingRepositories.filter((repository) => !selectedNames.has(repository.fullName.toLowerCase()))
    : matchingRepositories;
  const pageSize = 15;
  const pagesCount = Math.max(1, Math.ceil(filteredRepositories.length / pageSize));
  const currentPage = Math.min(page, pagesCount);
  const items = filteredRepositories.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const selectedItems = items.filter((repository) => selectedNames.has(repository.fullName.toLowerCase()));
  const selectionCounter = repositoriesLoaded
    ? `(${selectedNames.size} of ${repositories.length} selected)`
    : `(${selectedNames.size} selected)`;

  const updatePageSelection = (nextPageItems: SetupRepository[]) => {
    setQuickSelectUndo(null);
    const pageNames = new Set(items.map((repository) => repository.fullName.toLowerCase()));
    const next = new Set([...selectedNames].filter((name) => !pageNames.has(name)));
    nextPageItems.forEach((repository) => next.add(repository.fullName.toLowerCase()));
    setSelectedNames(next);
  };

  const addAvailableSelection = (nextItems: SetupRepository[]) => {
    setQuickSelectUndo(null);
    const next = new Set(selectedNames);
    nextItems.forEach((repository) => {
      if (next.size < MAX_MANAGED_REPOSITORIES) next.add(repository.fullName.toLowerCase());
    });
    setSelectedNames(next);
  };

  const removeSelectedRepository = (repository: SetupRepository) => {
    setQuickSelectUndo(null);
    const next = new Set(selectedNames);
    next.delete(repository.fullName.toLowerCase());
    setSelectedNames(next);
  };

  const applyWorkspacePreset = (presetId: string) => {
    const preset = workspacePresets.find((candidate) => candidate.id === presetId);
    if (!preset) return;
    const availableNames = new Set(repositories.map((repository) => repository.fullName.toLowerCase()));
    const availablePresetNames = preset.repositories.map((repository) => repository.toLowerCase()).filter((repository) => availableNames.has(repository));
    const removing = availablePresetNames.length > 0 && availablePresetNames.every((repository) => selectedNames.has(repository));
    const next = new Set(selectedNames);
    if (removing) {
      availablePresetNames.forEach((repository) => next.delete(repository));
    } else {
      availablePresetNames.forEach((repository) => {
        if (next.size < MAX_MANAGED_REPOSITORIES) next.add(repository);
      });
    }
    const changed = Math.abs(next.size - selectedNames.size);
    if (!changed) return;
    setQuickSelectUndo({ label: preset.label, changed, action: removing ? "removed" : "added", selection: new Set(selectedNames) });
    setSelectedNames(next);
  };

  const persistWorkspacePresets = async (nextPresets: WorkspacePreset[]) => {
    setPresetSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/setup/presets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ presets: nextPresets }),
      });
      const data = await response.json() as { presets?: WorkspacePreset[]; error?: string };
      if (!response.ok || !data.presets) throw new Error(data.error ?? "Quick select groups could not be saved.");
      setWorkspacePresets(data.presets);
      setPresetEditor(null);
      const nextStatus = { ...status, workspacePresets: data.presets };
      cachedSetupStatus = nextStatus;
      onComplete(nextStatus);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Quick select groups could not be saved.");
    } finally {
      setPresetSaving(false);
    }
  };

  const savePresetEditor = () => {
    if (!presetEditor) return;
    const normalized = { ...presetEditor, label: presetEditor.label.trim(), repositories: [...new Set(presetEditor.repositories)] };
    const existingIndex = workspacePresets.findIndex((preset) => preset.id === normalized.id);
    const next = existingIndex >= 0 ? workspacePresets.map((preset, index) => index === existingIndex ? normalized : preset) : [...workspacePresets, normalized];
    void persistWorkspacePresets(next);
  };

  const presetRepositoryOptions = repositories.map((repository) => ({ label: repository.fullName, value: repository.fullName, description: repository.description ?? undefined }));
  const selectedPresetRepositoryOptions = presetEditor ? presetRepositoryOptions.filter((option) => presetEditor.repositories.some((repository) => repository.toLowerCase() === option.value.toLowerCase())) : [];
  const duplicatePresetName = Boolean(presetEditor && workspacePresets.some((preset) => preset.id !== presetEditor.id && preset.label.toLowerCase() === presetEditor.label.trim().toLowerCase()));

  const gitlabProjectOptions = gitlabProjects.map((project) => ({ label: project.fullPath, value: project.fullPath, description: project.description ?? undefined }));
  const selectedGitlabProjectOptions = gitlabProjectOptions.filter((option) => selectedGitlabProjects.has((option.value ?? "").toLowerCase()));
  const defaultGitlabProjectOptions = gitlabProjects
    .filter((project) => selectedGitlabProjects.has(project.fullPath.toLowerCase()))
    .map((project) => ({
      label: project.fullPath,
      value: project.fullPath,
      description: project.ticketValidation,
      disabled: Boolean(gitlabDefaultProject && project.fullPath.toLowerCase() !== gitlabDefaultProject.toLowerCase()),
    }));
  const selectedDefaultGitlabProject = defaultGitlabProjectOptions.find((option) => option.value?.toLowerCase() === gitlabDefaultProject?.toLowerCase()) ?? null;

  const githubConnection = (
    <Container header={<Header variant="h2" description="Required">Connect GitHub</Header>}>
      {tokenReady ? (
        <SpaceBetween size="l">
          {connectedViewer ? (
            <div className="setup-github-profile">
              {/* eslint-disable-next-line @next/next/no-img-element -- GitHub supplies the authenticated user's avatar URL at runtime. */}
              <img className="setup-github-avatar" src={connectedViewer.avatar} alt={`${connectedViewer.name ?? connectedViewer.login} profile`} />
              <div className="setup-github-profile-copy">
                <Box variant="h3">{connectedViewer.name ?? connectedViewer.login}</Box>
                <Link href={connectedViewer.url} external>@{connectedViewer.login}</Link>
              </div>
              <StatusIndicator type="success">Connected</StatusIndicator>
            </div>
          ) : <StatusIndicator type="success">GitHub token found</StatusIndicator>}
          {status.tokenSource !== "environment" ? (
            <FormField label="Replace GitHub token" description="The replacement is validated by the server and remains in memory for this app session.">
              <Input value={token} type="password" autoComplete="off" placeholder="github_pat_…" onChange={({ detail }) => setToken(detail.value)} onKeyDown={({ detail }) => { if (detail.key === "Enter") void connect(); }} />
            </FormField>
          ) : <Box color="text-body-secondary"><Box variant="code" display="inline">GITHUB_TOKEN</Box> was found in the server environment. Change the environment value and restart Scout to use another token.</Box>}
          {status.tokenSource !== "environment" ? (
            <SpaceBetween direction="horizontal" size="s">
              <Button loading={loading} disabled={!token.trim()} onClick={connect}>Replace GitHub connection</Button>
              {settingsMode ? <Button onClick={() => { setDisconnectConfirmation(""); setDisconnectTarget("github"); }}>Disconnect GitHub</Button> : null}
            </SpaceBetween>
          ) : null}
        </SpaceBetween>
      ) : (
        <SpaceBetween size="l">
          <Box color="text-body-secondary">Enter a GitHub personal access token with read access. The token remains in server memory for this session.</Box>
          <FormField label="GitHub token" description={<>You can also set <Box variant="code" display="inline">GITHUB_TOKEN</Box> before starting Scout.</>}>
            <Input value={token} type="password" autoComplete="off" placeholder="github_pat_…" onChange={({ detail }) => setToken(detail.value)} onKeyDown={({ detail }) => { if (detail.key === "Enter") void connect(); }} />
          </FormField>
          <SpaceBetween direction="horizontal" size="s">
            <Button variant="primary" style={setupContinueStyle} loading={loading} disabled={!token.trim()} onClick={connect}>Connect GitHub</Button>
            <Button href="https://github.com/settings/personal-access-tokens" external>Open GitHub token settings</Button>
          </SpaceBetween>
        </SpaceBetween>
      )}
    </Container>
  );

  const gitlabConnection = (
    <Container header={<Header variant="h2" description="Optional">Connect Gitlab</Header>}>
      <SpaceBetween size="m">
        {gitlabTokenReady ? (
          connectedGitlabViewer ? (
            <div className="setup-github-profile">
              {connectedGitlabViewer.avatar ? (
                // eslint-disable-next-line @next/next/no-img-element -- Gitlab supplies the authenticated user's avatar URL at runtime.
                <img className="setup-github-avatar" src={connectedGitlabViewer.avatar} alt={`${connectedGitlabViewer.name ?? connectedGitlabViewer.username} profile`} />
              ) : <div className="setup-service-avatar" aria-hidden="true">{(connectedGitlabViewer.name ?? connectedGitlabViewer.username).slice(0, 1).toUpperCase()}</div>}
              <div className="setup-github-profile-copy">
                <Box variant="h3">{connectedGitlabViewer.name ?? connectedGitlabViewer.username}</Box>
                <Link href={connectedGitlabViewer.url} external>@{connectedGitlabViewer.username}</Link>
              </div>
              <StatusIndicator type="success">Connected</StatusIndicator>
            </div>
          ) : <StatusIndicator type="success">Gitlab token found</StatusIndicator>
        ) : <Box color="text-body-secondary">Connect a token to show selected Gitlab work items and enable ticket creation for validated projects.</Box>}
        {status.gitlab.tokenSource !== "environment" ? (
          <FormField label={gitlabTokenReady ? "Replace Gitlab token" : "Gitlab token"} description="The token is validated by the server and remains in memory for this app session.">
            <Input value={gitlabToken} type="password" autoComplete="off" placeholder="glpat-…" onChange={({ detail }) => setGitlabToken(detail.value)} onKeyDown={({ detail }) => { if (detail.key === "Enter") void connectGitlab(); }} />
          </FormField>
        ) : <Box color="text-body-secondary"><Box variant="code" display="inline">GITLAB_TOKEN</Box> was found in the server environment.</Box>}
        {status.gitlab.tokenSource !== "environment" ? (
          <SpaceBetween direction="horizontal" size="s">
            <Button loading={gitlabConnecting} disabled={!gitlabToken.trim()} onClick={connectGitlab}>{gitlabTokenReady ? "Replace Gitlab connection" : "Connect Gitlab"}</Button>
            {settingsMode && gitlabTokenReady ? <Button onClick={() => { setDisconnectConfirmation(""); setDisconnectTarget("gitlab"); }}>Disconnect Gitlab</Button> : null}
          </SpaceBetween>
        ) : null}
      </SpaceBetween>
    </Container>
  );

  const gitlabProjectSettings = gitlabTokenReady ? (
    <Container header={<Header variant="h2" description={step === "gitlab-projects" ? "Step 3 of 3 · Choose zero or more projects for assigned work items." : "Choose zero or more projects for assigned work items. Ticket batches can target one selected, validated project at a time."} actions={step === "gitlab-projects" ? <SpaceBetween direction="horizontal" size="s"><Button onClick={() => setStep("repositories")}>Back</Button><Button variant="primary" style={setupContinueStyle} loading={loading} disabled={!gitlabProjectsLoaded} onClick={save}>Save and continue</Button></SpaceBetween> : settingsMode ? <Button variant="primary" style={setupContinueStyle} loading={loading} disabled={!gitlabProjectsLoaded} onClick={save}>Save changes</Button> : undefined}>{step === "gitlab-projects" ? "Choose Gitlab projects" : "Gitlab projects"}</Header>}>
      <SpaceBetween size="m">
        <FormField label="Projects shown on the overview" description="No selection hides My Gitlab work items from the overview.">
          <Multiselect
            selectedOptions={selectedGitlabProjectOptions}
            options={gitlabProjectOptions}
            filteringType="auto"
            placeholder="Choose Gitlab projects"
            loadingText="Loading Gitlab projects"
            statusType={gitlabProjectsLoading ? "loading" : "finished"}
            onChange={({ detail }) => {
              const next = new Set(detail.selectedOptions.flatMap((option) => option.value ? [option.value.toLowerCase()] : []));
              setSelectedGitlabProjects(next);
              if (gitlabDefaultProject && !next.has(gitlabDefaultProject.toLowerCase())) setGitlabDefaultProject(null);
            }}
          />
        </FormField>
        <FormField label="Default ticket project" description="Ticket creation requires Developer access. The server validates the target again before every batch.">
          <Multiselect
            selectedOptions={selectedDefaultGitlabProject ? [selectedDefaultGitlabProject] : []}
            options={defaultGitlabProjectOptions}
            filteringType="auto"
            tokenLimit={1}
            placeholder="Choose a default ticket project"
            empty="Select at least one Gitlab project first"
            onChange={({ detail }) => setGitlabDefaultProject(detail.selectedOptions.at(-1)?.value ?? null)}
          />
        </FormField>
      </SpaceBetween>
    </Container>
  ) : null;

  const availableRepositoryNames = new Set(repositories.map((repository) => repository.fullName.toLowerCase()));
  const eligibleWorkspacePresets = workspacePresets.map((preset) => ({
    ...preset,
    availableRepositories: preset.repositories.filter((repository) => availableRepositoryNames.has(repository.toLowerCase())),
  })).filter((preset) => preset.availableRepositories.length);
  const quickSelect = eligibleWorkspacePresets.length ? (
    <ButtonDropdown
      items={eligibleWorkspacePresets.map((preset) => ({
        id: preset.id,
        text: preset.label,
        secondaryText: `${preset.availableRepositories.every((repository) => selectedNames.has(repository.toLowerCase())) ? "Remove" : "Add"} ${preset.availableRepositories.length} ${preset.availableRepositories.length === 1 ? "repository" : "repositories"}`,
      }))}
      disabled={repositoriesLoading || repositoriesLocked}
      onItemClick={({ detail }) => applyWorkspacePreset(detail.id)}
    >
      Quick select
    </ButtonDropdown>
  ) : null;

  if (step === "welcome") {
    return (
      <>
        <div id="setup-top-navigation">
          <TopNavigation
            identity={{ href: "/", title: "UDS Scout", logo: { src: "/doug-lg.svg", alt: "Doug" }, onFollow: (event) => { event.preventDefault(); router.push("/"); } }}
            utilities={[]}
            i18nStrings={{ overflowMenuTriggerText: "More", overflowMenuTitleText: "All", overflowMenuDismissIconAriaLabel: "Close menu" }}
          />
        </div>
        <main className="setup-welcome-shell">
          <div className="setup-welcome-panel">
            <section className="setup-welcome-content" aria-labelledby="setup-welcome-heading">
              <div className="setup-welcome-github-context">
                {/* eslint-disable-next-line @next/next/no-img-element -- The GitHub mark is bundled locally and does not require image optimization. */}
                <img src="/github-mark.svg" alt="GitHub" />
                <Box variant="awsui-key-label">MULTI-REPOSITORY OPERATIONS</Box>
              </div>
              <SpaceBetween size="l">
                <SpaceBetween size="s">
                  <Box id="setup-welcome-heading" variant="h1">Welcome to UDS Scout</Box>
                  <Box color="text-body-secondary">GitHub is great for working in one repository at a time. UDS Scout gives you one place to manage work across all of them.</Box>
                  <Box color="text-body-secondary">See pull requests, Renovate updates, failed pipelines, releases, and package health together—so managing UDS packages doesn’t mean checking the same screens repo by repo.</Box>
                </SpaceBetween>
                <SpaceBetween size="s">
                  <div className="setup-welcome-action">
                    <Button variant="primary" style={setupContinueStyle} onClick={() => setStep("token")}>Set up UDS Scout</Button>
                  </div>
                  <Box color="text-body-secondary" fontSize="body-s">Connect your accounts and choose only the repositories that matter.</Box>
                </SpaceBetween>
              </SpaceBetween>
            </section>
            <div className="setup-welcome-visual">
              {/* eslint-disable-next-line @next/next/no-img-element -- The local SVG is the application mascot and does not require image optimization. */}
              <img className="setup-welcome-logo" src="/doug-lg.svg" alt="Doug, the UDS Scout mascot" />
              <SpaceBetween size="xxs">
                <Box variant="h2" textAlign="center">One view. Clear priorities.</Box>
                <Box color="text-body-secondary" textAlign="center">Know what needs action across your UDS repositories.</Box>
              </SpaceBetween>
            </div>
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <div id="setup-top-navigation">
        <TopNavigation
          identity={{ href: "/", title: "UDS Scout", logo: { src: "/doug-lg.svg", alt: "Doug" }, onFollow: (event) => { event.preventDefault(); router.push("/"); } }}
          utilities={settingsMode || replayMode ? [{ type: "button", text: "Back to operations", iconName: "arrow-left", onClick: () => router.push("/") }] : []}
          i18nStrings={{ overflowMenuTriggerText: "More", overflowMenuTitleText: "All", overflowMenuDismissIconAriaLabel: "Close menu" }}
        />
      </div>
      <main className="setup-shell">
        <SpaceBetween size="l">
          <SpaceBetween size="xs">
            <Box variant="awsui-key-label">{settingsMode ? "WORKSPACE CONFIGURATION" : "INITIAL SETUP"}</Box>
            <Header variant="h1" description={settingsMode ? "Manage workspace connections, repositories, and project settings." : step === "token" ? `Step 1 of ${setupStepCount} · Connect GitHub and optionally connect Gitlab.` : step === "repositories" ? `Step 2 of ${setupStepCount} · Choose the GitHub repositories Scout should manage.` : "Step 3 of 3 · Choose the Gitlab projects Scout should include."} actions={settingsMode ? <ButtonDropdown items={[{ id: "run-setup", text: "Run setup again" }]} onItemClick={() => setRerunSetupConfirmVisible(true)}>Actions</ButtonDropdown> : replayMode && status.configured ? <Button onClick={() => setResetConfirmVisible(true)}>Reset setup</Button> : undefined}>
              {settingsMode ? "Workspace settings" : "Set up your workspace"}
            </Header>
          </SpaceBetween>

          {error ? <Flashbar items={[{ type: "error", header: "Setup could not continue", content: error, dismissible: true, onDismiss: () => setError(null) }]} /> : null}
          {repositoryUpdateStatus ? <Flashbar items={[{
            type: repositoryUpdateStatus === "complete" ? "success" : repositoryUpdateStatus === "failed" ? "warning" : "info",
            header: repositoryUpdateStatus === "saving" ? "Saving repository changes" : repositoryUpdateStatus === "rebuilding" ? "Rebuilding the Scout dashboard" : repositoryUpdateStatus === "complete" ? "Dashboard rebuild complete" : "Repository changes saved",
            content: repositoryUpdateStatus === "saving"
              ? "Scout is validating and saving your repository selection."
              : repositoryUpdateStatus === "rebuilding"
                ? "Your repository changes are saved. Scout is refreshing pull requests, pipelines, releases, and package health now."
                : repositoryUpdateStatus === "complete"
                  ? "The dashboard is ready with your updated repository selection."
                  : "Scout could not prebuild the dashboard. It will retry when you return to the homepage.",
            action: ["complete", "failed"].includes(repositoryUpdateStatus) ? <div className="flashbar-centered-action"><Button onClick={() => router.push("/")}>Open dashboard</Button></div> : undefined,
            dismissible: ["complete", "failed"].includes(repositoryUpdateStatus),
            onDismiss: () => setRepositoryUpdateStatus(null),
          }]} /> : null}
          {repositoriesLoading ? <div className="setup-repository-loading-banner"><Flashbar items={[{ type: "info", header: "Fetching repository data", content: "Please wait while we load repositories available to your GitHub account." }]} /></div> : null}
          {renovateReviewConfirmation ? <Flashbar items={[{ type: "success", header: "Renovate review schedule updated", content: renovateReviewConfirmation, dismissible: true, onDismiss: () => setRenovateReviewConfirmation(null) }]} /> : null}
          {quickSelectUndo ? <Flashbar items={[{ type: "success", header: `${quickSelectUndo.label} ${quickSelectUndo.action === "added" ? "selected" : "deselected"}`, content: `${quickSelectUndo.changed} ${quickSelectUndo.changed === 1 ? "repository was" : "repositories were"} ${quickSelectUndo.action}.`, action: <div className="flashbar-centered-action"><Button onClick={() => { setSelectedNames(new Set(quickSelectUndo.selection)); setQuickSelectUndo(null); }}>Undo</Button></div>, dismissible: true, onDismiss: () => setQuickSelectUndo(null) }]} /> : null}

          {step === "token" ? (
            <SpaceBetween size="l">
            {githubConnection}
            {gitlabConnection}
            <div className="setup-step-actions">
              <Button variant="primary" style={setupContinueStyle} disabled={!tokenReady} onClick={continueToRepositories}>Continue to GitHub repositories</Button>
            </div>
            </SpaceBetween>
          ) : step === "gitlab-projects" ? (
            <SpaceBetween size="l">
              {gitlabProjectSettings}
            </SpaceBetween>
          ) : settingsMode ? (
            <SpaceBetween size="l">
              <Tabs
                activeTabId={settingsTab}
                onChange={({ detail }) => setSettingsTab(detail.activeTabId as typeof settingsTab)}
                tabs={[
                  { id: "workspace", label: "Workspace" },
                  { id: "connections", label: "Connections" },
                  { id: "github", label: "GitHub repositories" },
                  { id: "gitlab", label: "Gitlab projects" },
                ]}
              />
              {settingsTab === "workspace" ? (
                <SpaceBetween size="l">
                  <Container header={<Header variant="h2" description="Manage Scout connections and repository sources without leaving settings.">Workspace configuration</Header>}>
                    <SpaceBetween size="l">
                      <SpaceBetween size="xs"><Box variant="h3">GitHub repositories</Box><Box color="text-body-secondary">{selectedNames.size} repositories are managed by Scout.</Box><div><Button onClick={() => setSettingsTab("github")}>Manage GitHub repositories</Button></div></SpaceBetween>
                      <SpaceBetween size="xs"><Box variant="h3">Quick select groups</Box><Box color="text-body-secondary">{workspacePresets.length} {workspacePresets.length === 1 ? "group is" : "groups are"} available for repository selection.</Box><div><Button disabled={repositoriesLoading} onClick={() => setPresetManagerVisible(true)}>Manage quick select groups</Button></div></SpaceBetween>
                      <SpaceBetween size="xs"><Box variant="h3">Gitlab projects</Box><Box color="text-body-secondary">{gitlabTokenReady ? `${selectedGitlabProjects.size} projects are selected for Gitlab work items.` : "Gitlab is not connected."}</Box><div><Button onClick={() => setSettingsTab(gitlabTokenReady ? "gitlab" : "connections")}>{gitlabTokenReady ? "Manage Gitlab projects" : "Connect Gitlab"}</Button></div></SpaceBetween>
                      <SpaceBetween size="xs"><Box variant="h3">Accounts</Box><Box color="text-body-secondary">Replace or disconnect server-only account tokens.</Box><div><Button onClick={() => setSettingsTab("connections")}>Manage connections</Button></div></SpaceBetween>
                    </SpaceBetween>
                  </Container>
                  <Container header={<Header variant="h2" description="Choose one browser-local weekday, or hide the scheduled table." actions={<Button variant="primary" style={setupContinueStyle} loading={renovateReviewSaving} disabled={renovateReviewDay === status.renovateReviewDay} onClick={saveRenovateReviewSchedule}>Save schedule</Button>}>Renovate review</Header>}>
                    <FormField label="Show review table on">
                      <Select selectedOption={selectedRenovateReviewSchedule} options={renovateReviewScheduleOptions} onChange={({ detail }) => setRenovateReviewDay(detail.selectedOption.value as RenovateReviewDay)} />
                    </FormField>
                  </Container>
                </SpaceBetween>
              ) : null}
              {settingsTab === "connections" ? <SpaceBetween size="l">{githubConnection}{gitlabConnection}</SpaceBetween> : null}
              {settingsTab === "gitlab" ? (gitlabProjectSettings ?? <Container header={<Header variant="h2">Gitlab projects</Header>}><SpaceBetween size="m"><Box color="text-body-secondary">Connect Gitlab before choosing projects for work items and ticket creation.</Box><div><Button onClick={() => setSettingsTab("connections")}>Open connections</Button></div></SpaceBetween></Container>) : null}
              {settingsTab === "github" ? <SpaceBetween size="l">
              <Table
                variant="container"
                stickyHeader
                stripedRows
                trackBy="id"
                loading={repositoriesLoading}
                loadingText="Loading managed repositories"
                items={selectedRepositories}
                header={
                  <Header
                    variant="h2"
                    counter={selectionCounter}
                    description="GitHub repositories currently included in operational monitoring."
                    actions={<SpaceBetween direction="horizontal" size="s">{quickSelect}<Button disabled={repositoriesLoading} onClick={() => setPresetManagerVisible(true)}>Manage groups</Button><Button onClick={() => router.push("/")}>Cancel</Button><Button variant="primary" style={setupContinueStyle} loading={loading} disabled={repositoriesLoading} onClick={save}>Save changes</Button></SpaceBetween>}
                  >
                    Managed GitHub repositories
                  </Header>
                }
                columnDefinitions={[
                  { id: "repository", header: "Repository", cell: (repository) => <SpaceBetween size="xxs"><Box variant="strong">{repository.name}</Box><Box color="text-body-secondary">{repository.owner}</Box></SpaceBetween> },
                  { id: "visibility", header: "Visibility", cell: (repository) => <Badge color="grey">{repository.private ? "private" : "public"}</Badge> },
                  { id: "description", header: "Description", cell: (repository) => repository.description ?? <Box color="text-body-secondary">No description</Box> },
                  { id: "remove", header: "", cell: (repository) => <Button variant="inline-link" disabled={repositoriesLocked} onClick={() => removeSelectedRepository(repository)}>Remove</Button> },
                ]}
                empty={<Box textAlign="center" padding={{ vertical: "xxl" }}><SpaceBetween size="s"><Box variant="strong">No managed repositories</Box><Box color="text-body-secondary">Save an empty workspace or add repositories from the available list.</Box></SpaceBetween></Box>}
              />

              <Table
                className="selection-table-aligned"
                variant="container"
                stickyHeader
                stripedRows
                trackBy="id"
                selectionType="multi"
                selectedItems={[]}
                onSelectionChange={({ detail }) => addAvailableSelection(detail.selectedItems)}
                isItemDisabled={(repository) => repositoriesLocked || selectedNames.size >= MAX_MANAGED_REPOSITORIES || selectedNames.has(repository.fullName.toLowerCase())}
                loading={repositoriesLoading}
                loadingText="Loading available repositories"
                items={items}
                filter={<TextFilter filteringText={filter} onChange={({ detail }) => { setFilter(detail.filteringText); setPage(1); }} filteringPlaceholder="Find available repositories" countText={`${filteredRepositories.length} matches`} />}
                pagination={<Pagination currentPageIndex={currentPage} pagesCount={pagesCount} onChange={({ detail }) => setPage(detail.currentPageIndex)} ariaLabels={{ nextPageLabel: "Next page", previousPageLabel: "Previous page", pageLabel: (pageNumber) => `Page ${pageNumber} of all pages` }} />}
                header={<Header variant="h2" counter={`(${filteredRepositories.length})`} description={repositoriesLocked ? "Repository selection is controlled by GITHUB_REPOSITORIES." : `Select repositories to add. ${selectedNames.size} of ${MAX_MANAGED_REPOSITORIES} management slots are in use.`}>Available GitHub repositories</Header>}
                columnDefinitions={[
                  { id: "repository", header: "Repository", cell: (repository) => <SpaceBetween size="xxs"><Box variant="strong">{repository.name}</Box><Box color="text-body-secondary">{repository.owner}</Box></SpaceBetween> },
                  { id: "visibility", header: "Visibility", cell: (repository) => <Badge color="grey">{repository.private ? "private" : "public"}</Badge> },
                  { id: "description", header: "Description", cell: (repository) => repository.description ?? <Box color="text-body-secondary">No description</Box> },
                  { id: "updated", header: "Updated", cell: (repository) => repository.updatedAt.slice(0, 10) },
                ]}
                empty={<Box textAlign="center" padding={{ vertical: "xxl" }}><SpaceBetween size="s"><Box variant="strong">No available repositories found</Box><Box color="text-body-secondary">Adjust the filter or remove a repository from the managed list.</Box></SpaceBetween></Box>}
              />
              </SpaceBetween> : null}
            </SpaceBetween>
          ) : (
            <SpaceBetween size="l">
            <Table
              className="selection-table-aligned"
              variant="container"
              stickyHeader
              stripedRows
              trackBy="id"
              selectionType="multi"
              selectedItems={selectedItems}
              onSelectionChange={({ detail }) => updatePageSelection(detail.selectedItems)}
              isItemDisabled={(repository) => repositoriesLocked || (selectedNames.size >= MAX_MANAGED_REPOSITORIES && !selectedNames.has(repository.fullName.toLowerCase()))}
              loading={repositoriesLoading}
              loadingText="Loading available repositories"
              items={items}
              filter={<TextFilter filteringText={filter} onChange={({ detail }) => { setFilter(detail.filteringText); setPage(1); }} filteringPlaceholder="Find GitHub repositories" countText={`${filteredRepositories.length} matches`} />}
              pagination={<Pagination currentPageIndex={currentPage} pagesCount={pagesCount} onChange={({ detail }) => setPage(detail.currentPageIndex)} ariaLabels={{ nextPageLabel: "Next page", previousPageLabel: "Previous page", pageLabel: (pageNumber) => `Page ${pageNumber} of all pages` }} />}
              header={
                <Header
                  variant="h2"
                  counter={selectionCounter}
                  description={repositoriesLocked ? `Step 2 of ${setupStepCount} · GitHub repository selection is controlled by GITHUB_REPOSITORIES.` : `Step 2 of ${setupStepCount} · Choose up to ${MAX_MANAGED_REPOSITORIES} GitHub repositories for pull requests, issues, pipelines, and repository health.`}
                  actions={<SpaceBetween direction="horizontal" size="s">{quickSelect}<Button onClick={() => { setQuickSelectUndo(null); setStep("token"); }}>Back</Button><Button variant="primary" style={setupContinueStyle} loading={!gitlabTokenReady && loading} disabled={repositoriesLoading} onClick={gitlabTokenReady ? () => setStep("gitlab-projects") : save}>{gitlabTokenReady ? "Continue to Gitlab projects" : "Save and continue"}</Button></SpaceBetween>}
                >
                  Choose GitHub repositories
                </Header>
              }
              columnDefinitions={[
                { id: "repository", header: "Repository", cell: (repository) => <SpaceBetween size="xxs"><Box variant="strong">{repository.name}</Box><Box color="text-body-secondary">{repository.owner}</Box></SpaceBetween> },
                { id: "visibility", header: "Visibility", cell: (repository) => <Badge color="grey">{repository.private ? "private" : "public"}</Badge> },
                { id: "description", header: "Description", cell: (repository) => repository.description ?? <Box color="text-body-secondary">No description</Box> },
                { id: "updated", header: "Updated", cell: (repository) => repository.updatedAt.slice(0, 10) },
              ]}
              empty={<Box textAlign="center" padding={{ vertical: "xxl" }}><SpaceBetween size="s"><Box variant="strong">No repositories found</Box><Box color="text-body-secondary">Confirm the token can read at least one repository.</Box></SpaceBetween></Box>}
            />
            </SpaceBetween>
          )}
        </SpaceBetween>
      </main>
      <Modal
        visible={presetManagerVisible}
        onDismiss={() => { if (!presetSaving) { setPresetManagerVisible(false); setPresetEditor(null); } }}
        closeAriaLabel="Close quick select group manager"
        size="large"
        header={presetEditor ? workspacePresets.some((preset) => preset.id === presetEditor.id) ? "Edit quick select group" : "Add quick select group" : "Quick select groups"}
        footer={<Box float="right"><SpaceBetween direction="horizontal" size="xs">{presetEditor ? <><Button disabled={presetSaving} onClick={() => setPresetEditor(null)}>Back</Button><Button variant="primary" style={setupContinueStyle} loading={presetSaving} disabled={!presetEditor.label.trim() || !presetEditor.repositories.length || duplicatePresetName} onClick={savePresetEditor}>Save group</Button></> : <><Button onClick={() => setPresetManagerVisible(false)}>Close</Button><Button variant="primary" style={setupContinueStyle} disabled={workspacePresets.length >= 20 || repositoriesLoading} onClick={() => setPresetEditor({ id: window.crypto.randomUUID(), label: "", repositories: [] })}>Add group</Button></>}</SpaceBetween></Box>}
      >
        {presetEditor ? (
          <SpaceBetween size="l">
            <FormField label="Group name" errorText={duplicatePresetName ? "Choose a unique group name." : undefined} constraintText="Use a concise name that identifies the repository set.">
              <Input value={presetEditor.label} placeholder="Package maintainers" onChange={({ detail }) => setPresetEditor({ ...presetEditor, label: detail.value.slice(0, 60) })} />
            </FormField>
            <FormField label="Repositories" description={`Choose 1–${MAX_MANAGED_REPOSITORIES} repositories to add when this group is selected.`}>
              <Multiselect
                selectedOptions={selectedPresetRepositoryOptions}
                options={presetRepositoryOptions}
                filteringType="auto"
                tokenLimit={5}
                placeholder="Choose repositories"
                onChange={({ detail }) => setPresetEditor({ ...presetEditor, repositories: detail.selectedOptions.flatMap((option) => option.value ? [option.value] : []).slice(0, MAX_MANAGED_REPOSITORIES) })}
              />
            </FormField>
          </SpaceBetween>
        ) : (
          <SpaceBetween size="m">
            <Header variant="h3" counter={`(${workspacePresets.length})`} description="Choose a group from Quick select to add its repositories; choose it again to remove them.">Saved groups</Header>
            {workspacePresets.length ? <div className="quick-select-group-list">{workspacePresets.map((preset) => (
              <div className="quick-select-group-row" key={preset.id}>
                <div className="quick-select-group-copy">
                  <Box variant="strong">{preset.label}</Box>
                  <Box color="text-body-secondary">{preset.repositories.slice(0, 3).join(", ")}{preset.repositories.length > 3 ? ` · +${preset.repositories.length - 3} more` : ""}</Box>
                </div>
                <ButtonDropdown variant="icon" ariaLabel={`Actions for ${preset.label}`} loading={presetSaving} items={[{ id: "edit", text: "Edit" }, { id: "delete", text: "Delete" }]} onItemClick={({ detail }) => { if (detail.id === "edit") setPresetEditor({ ...preset, repositories: [...preset.repositories] }); else void persistWorkspacePresets(workspacePresets.filter((candidate) => candidate.id !== preset.id)); }} />
              </div>
            ))}</div> : <Box textAlign="center" padding={{ vertical: "xl" }}><SpaceBetween size="xs"><Box variant="strong">No quick select groups</Box><Box color="text-body-secondary">Add a group to reuse a repository selection.</Box></SpaceBetween></Box>}
          </SpaceBetween>
        )}
      </Modal>
      <Modal
        visible={rerunSetupConfirmVisible}
        onDismiss={() => setRerunSetupConfirmVisible(false)}
        closeAriaLabel="Close run setup confirmation"
        header="Run setup again and replace repository selection?"
        footer={<Box float="right"><SpaceBetween direction="horizontal" size="xs"><Button onClick={() => setRerunSetupConfirmVisible(false)}>Cancel</Button><Button variant="primary" style={setupContinueStyle} onClick={() => { setRerunSetupConfirmVisible(false); router.push("/setup"); }}>Run setup again</Button></SpaceBetween></Box>}
      >
        Running setup again starts repository selection with no repositories selected. Your saved workspace remains unchanged until you finish and save, but completing setup will replace all currently selected repositories.
      </Modal>
      <Modal
        visible={resetConfirmVisible}
        onDismiss={() => { if (!resetting) setResetConfirmVisible(false); }}
        closeAriaLabel="Close reset confirmation"
        header="Reset UDS Scout setup?"
        footer={<Box float="right"><SpaceBetween direction="horizontal" size="xs"><Button disabled={resetting} onClick={() => setResetConfirmVisible(false)}>Cancel</Button><Button variant="primary" style={setupContinueStyle} loading={resetting} onClick={resetSetup}>Reset setup</Button></SpaceBetween></Box>}
      >
        Saved repository and Gitlab project selections for this GitHub user will be removed. Quick select groups and the Renovate review schedule will be kept. Tokens entered during this app session will also be cleared. Environment tokens are not changed.
      </Modal>
      <Modal
        visible={disconnectTarget !== null}
        onDismiss={() => { if (!disconnecting) { setDisconnectTarget(null); setDisconnectConfirmation(""); } }}
        closeAriaLabel="Close disconnect confirmation"
        header={disconnectTarget === "github" ? "Disconnect GitHub?" : "Disconnect Gitlab?"}
        footer={<Box float="right"><SpaceBetween direction="horizontal" size="xs"><Button disabled={disconnecting} onClick={() => { setDisconnectTarget(null); setDisconnectConfirmation(""); }}>Cancel</Button><Button variant="primary" style={setupContinueStyle} loading={disconnecting} disabled={disconnectTarget === "github" && disconnectConfirmation.trim() !== "disconnect from uds scout"} onClick={disconnectAccount}>{disconnectTarget === "github" ? "Disconnect GitHub" : "Disconnect Gitlab"}</Button></SpaceBetween></Box>}
      >
        {disconnectTarget === "github" ? (
          <SpaceBetween size="m">
            <Box>You will be disconnected from GitHub and redirected back to setup. GitHub is required, so you must reconnect before using Scout. Session-entered connections will be cleared, while saved workspace selections remain on this machine.</Box>
            <FormField label={<>To confirm, enter <Box variant="code" display="inline">disconnect from uds scout</Box>.</>}>
              <Input value={disconnectConfirmation} autoComplete="off" placeholder="disconnect from uds scout" onChange={({ detail }) => setDisconnectConfirmation(detail.value)} />
            </FormField>
          </SpaceBetween>
        ) : "You will be disconnected from Gitlab. Saved Gitlab project selections will be cleared, but your GitHub workspace will remain connected."}
      </Modal>
    </>
  );
}

export function ApplicationGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [status, setStatus] = useState<SetupStatus | null>(() => cachedSetupStatus);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    fetch("/api/setup/status", { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Local setup status could not be loaded.");
        return data as SetupStatus;
      })
      .then((data) => {
        cachedSetupStatus = data;
        setStatus(data);
      })
      .catch((reason) => {
        if (reason.name !== "AbortError") setError(reason.message);
      });
    return () => controller.abort();
  }, [refresh]);

  if (!status && !error) return <SetupLoading />;
  if (error) {
    return <div className="setup-loading"><SpaceBetween size="m"><StatusIndicator type="error">{error}</StatusIndicator><Button onClick={() => setRefresh((value) => value + 1)}>Try again</Button></SpaceBetween></div>;
  }
  if (!status) return null;

  const settingsMode = pathname === "/settings" || pathname.startsWith("/settings/");
  const replayMode = pathname === "/setup";
  const initialSettingsTab = pathname === "/settings/repositories" ? "github" as const : "workspace" as const;
  if (status.configured && !settingsMode && !replayMode) return children;
  return <SetupWizard status={status} settingsMode={settingsMode} initialSettingsTab={initialSettingsTab} replayMode={replayMode} onComplete={setStatus} onReset={() => { setStatus(null); setRefresh((value) => value + 1); }} />;
}
