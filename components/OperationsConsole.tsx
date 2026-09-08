"use client";

/* eslint-disable react-hooks/set-state-in-effect -- Request state is synchronized with API effects. */

import AppLayout from "@cloudscape-design/components/app-layout";
import Badge from "@cloudscape-design/components/badge";
import Box from "@cloudscape-design/components/box";
import BreadcrumbGroup from "@cloudscape-design/components/breadcrumb-group";
import Button from "@cloudscape-design/components/button";
import Container from "@cloudscape-design/components/container";
import ContentLayout from "@cloudscape-design/components/content-layout";
import Drawer from "@cloudscape-design/components/drawer";
import ExpandableSection from "@cloudscape-design/components/expandable-section";
import Flashbar from "@cloudscape-design/components/flashbar";
import Grid from "@cloudscape-design/components/grid";
import Header from "@cloudscape-design/components/header";
import Icon from "@cloudscape-design/components/icon";
import KeyValuePairs from "@cloudscape-design/components/key-value-pairs";
import Link from "@cloudscape-design/components/link";
import Modal from "@cloudscape-design/components/modal";
import Pagination from "@cloudscape-design/components/pagination";
import Select from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Spinner from "@cloudscape-design/components/spinner";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import Table, { TableProps } from "@cloudscape-design/components/table";
import Tabs from "@cloudscape-design/components/tabs";
import TextFilter from "@cloudscape-design/components/text-filter";
import TopNavigation from "@cloudscape-design/components/top-navigation";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { addReferencesToPersonalWork, EMPTY_PERSONAL_WORK_STATE, isPullInPersonalWork, isReferenceInPersonalWork, personalWorkReferenceForIssue, personalWorkReferenceForWorkflow, personalWorkStorageName, readPersonalWorkState, writePersonalWorkState, type MyWorkIssue, type MyWorkPipeline, type MyWorkPull, type PersonalWorkReference, type PersonalWorkState } from "@/lib/my-work";
import { isSecurityContextRepository, SONIC_REPOSITORY, UDS_SCOUT_REPOSITORY_URL } from "@/lib/repository-constants";
import type { RenovateCapability, RenovateHealth } from "@/lib/renovate-config";
import { ActionSuccessToast, PrimaryActionButton, type ActionConfirmation } from "./action-ui";
import { InfrastructureExplorer } from "./InfrastructureExplorer";
import { OperationsDrawer } from "./OperationsDrawer";
import { OverviewPage } from "./OverviewPage";
import { GlobalSecurityPage, RepositorySecurityPanel } from "./SecurityIntelligence";
import { filterRenovateUpdatesByCheck, isRenovateCheckFilter, PullRequestCheckStatus, renovateCheckFilterOptions, RenovateUpdatesTable, sortRenovateUpdates, type RenovateCheckFilter } from "./RenovateUpdatesTable";
import type { InfrastructureExplorerData, UdsPackage } from "./infrastructure-types";
import type { ConsoleView, DrawerSelection } from "./operations-types";
import type { RepositorySecurity, SecurityWorkspace } from "./security-types";
import { EmptyState, MetricCard, newestPulls, pipelineFailed, pullWorkflowStatus, PullAuthor, PullPeople, relativeTime, repositoryHealth, runStatus, udsCommonStatusAction, UdsCoreVersion } from "./operations-ui";
import type { OrganizationRepository, Overview, PullRequest, Repository, RepositoryCatalog, RepositoryContributorCounts, RepositoryWorkspace } from "./types";

type Props = {
  view: ConsoleView;
  repository?: string;
};

let cachedOverview: Overview | null = null;
let cachedRepositoryCatalog: RepositoryCatalog | null = null;
let cachedRepositoryContributorCounts: RepositoryContributorCounts | null = null;
let cachedInfrastructure: InfrastructureExplorerData | null = null;
let cachedSecurityWorkspace: SecurityWorkspace | null = null;
const cachedWorkspaces = new Map<string, RepositoryWorkspace>();
const OVERVIEW_REQUEST_TIMEOUT_MS = 20_000;
const INITIAL_LOAD_WARNING_KEY = "uds-scout:show-initial-load-warning";
const SIDEBAR_CACHE_KEY = "uds-scout:sidebar";
const OVERVIEW_BROWSER_CACHE_KEY = "uds-scout:overview";
type SidebarRepository = Pick<Repository, "name" | "fullName" | "attention" | "pipeline" | "udsCommon">;
type SidebarSnapshot = { viewer: string; repositories: SidebarRepository[]; renovateCount: number; catalogCount: number; sonicAvailable: boolean };
const EMPTY_SIDEBAR_SNAPSHOT: SidebarSnapshot = { viewer: "", repositories: [], renovateCount: 0, catalogCount: 0, sonicAvailable: false };

function readBrowserOverview(): Overview | null {
  if (typeof window === "undefined") return null;
  try {
    const overview = JSON.parse(window.localStorage.getItem(OVERVIEW_BROWSER_CACHE_KEY) ?? "null") as Overview | null;
    const viewer = JSON.parse(window.localStorage.getItem("uds-scout:viewer") ?? "null") as { login?: string } | null;
    return overview?.viewer?.login && (!viewer?.login || overview.viewer.login === viewer.login) ? overview : null;
  } catch {
    return null;
  }
}

function readSidebarSnapshot(): SidebarSnapshot {
  if (typeof window === "undefined") return EMPTY_SIDEBAR_SNAPSHOT;
  try {
    const snapshot = JSON.parse(window.localStorage.getItem(SIDEBAR_CACHE_KEY) ?? "null") as SidebarSnapshot | null;
    const viewer = JSON.parse(window.localStorage.getItem("uds-scout:viewer") ?? "null") as { login?: string } | null;
    if (!snapshot || !Array.isArray(snapshot.repositories) || (viewer?.login && snapshot.viewer !== viewer.login)) return EMPTY_SIDEBAR_SNAPSHOT;
    return snapshot;
  } catch {
    return EMPTY_SIDEBAR_SNAPSHOT;
  }
}

function sessionPreferenceKey(viewer: string, preference: string) {
  return `uds-scout:${viewer.toLowerCase()}:${preference}`;
}

function useSessionPreference<T>(key: string, fallback: T, validate: (value: unknown) => value is T, preferFallback = false) {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === "undefined" || preferFallback) return fallback;
    try {
      const stored = window.sessionStorage.getItem(key);
      if (stored === null) return fallback;
      const parsed = JSON.parse(stored) as unknown;
      return validate(parsed) ? parsed : fallback;
    } catch {
      return fallback;
    }
  });

  useEffect(() => {
    try {
      window.sessionStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Keep the in-memory preference when session storage is unavailable.
    }
  }, [key, value]);

  return [value, setValue] as const;
}

const isString = (value: unknown): value is string => typeof value === "string";
const isPositiveInteger = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value > 0;

export default function OperationsConsole({ view, repository: repositoryName }: Props) {
  const router = useRouter();
  const [sidebarSnapshot, setSidebarSnapshot] = useState<SidebarSnapshot>(EMPTY_SIDEBAR_SNAPSHOT);
  const [overview, setOverview] = useState<Overview | null>(() => cachedOverview);
  const [repositoryCatalog, setRepositoryCatalog] = useState<RepositoryCatalog | null>(() => cachedRepositoryCatalog);
  const [repositoryContributorCounts, setRepositoryContributorCounts] = useState<RepositoryContributorCounts | null>(() => cachedRepositoryContributorCounts);
  const [workspace, setWorkspace] = useState<RepositoryWorkspace | null>(() => repositoryName ? cachedWorkspaces.get(repositoryName) ?? null : null);
  const [infrastructure, setInfrastructure] = useState<InfrastructureExplorerData | null>(() => cachedInfrastructure);
  const [securityWorkspace, setSecurityWorkspace] = useState<SecurityWorkspace | null>(() => cachedSecurityWorkspace);
  const [securityLoading, setSecurityLoading] = useState(!cachedSecurityWorkspace);
  const [securityError, setSecurityError] = useState<string | null>(null);
  const [securityPollKey, setSecurityPollKey] = useState(0);
  const [securityRefreshRequest, setSecurityRefreshRequest] = useState(0);
  const [loading, setLoading] = useState(!cachedOverview);
  const [repositoryCatalogLoading, setRepositoryCatalogLoading] = useState(view === "uds-packages" && !cachedRepositoryCatalog);
  const [repositoryContributorsLoading, setRepositoryContributorsLoading] = useState(view === "uds-packages" && !cachedRepositoryContributorCounts);
  const [workspaceLoading, setWorkspaceLoading] = useState(view === "repository" && !repositoryName ? true : view === "repository" && !cachedWorkspaces.has(repositoryName ?? ""));
  const [workspaceError, setWorkspaceError] = useState<{ repository: string; message: string } | null>(null);
  const [infrastructureLoading, setInfrastructureLoading] = useState(view === "infrastructure" && !cachedInfrastructure);
  const [error, setError] = useState<string | null>(null);
  const [errorDismissed, setErrorDismissed] = useState(false);
  const [initialLoadWarningVisible, setInitialLoadWarningVisible] = useState(false);
  const [repositoryCatalogError, setRepositoryCatalogError] = useState<string | null>(null);
  const [repositoryContributorsError, setRepositoryContributorsError] = useState<string | null>(null);
  const [lightMode, setLightMode] = useState(() => typeof window !== "undefined" && window.localStorage.getItem("uds-scout:theme") === "light");

  useLayoutEffect(() => {
    // Hydrate non-secret snapshots before the first browser paint, then refresh in the background.
    setSidebarSnapshot(readSidebarSnapshot());
    if (!cachedOverview) {
      const browserOverview = readBrowserOverview();
      if (browserOverview) {
        cachedOverview = browserOverview;
        setOverview(browserOverview);
      }
    }
  }, []);

  useEffect(() => {
    const saved = window.localStorage.getItem("uds-scout:theme");
    const enabled = saved === "light";
    setLightMode(enabled);
    document.body.classList.toggle("awsui-dark-mode", !enabled);
  }, []);

  const toggleTheme = () => {
    const enabled = !lightMode;
    setLightMode(enabled);
    document.body.classList.toggle("awsui-dark-mode", !enabled);
    window.localStorage.setItem("uds-scout:theme", enabled ? "light" : "dark");
  };
  const [refreshKey, setRefreshKey] = useState(0);
  useEffect(() => {
    const refreshAfterWorkflow = () => setRefreshKey((value) => value + 1);
    window.addEventListener("uds-scout:refresh", refreshAfterWorkflow);
    return () => window.removeEventListener("uds-scout:refresh", refreshAfterWorkflow);
  }, []);
  const [navigationOpen, setNavigationOpen] = useState(true);
  const [helpOpen, setHelpOpen] = useState(false);
  const [drawer, setDrawer] = useState<DrawerSelection | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [personalWorkState, setPersonalWorkState] = useState<PersonalWorkState>(EMPTY_PERSONAL_WORK_STATE);
  const [personalWorkUndo, setPersonalWorkUndo] = useState<PersonalWorkState | null>(null);
  const [personalWorkConfirmation, setPersonalWorkConfirmation] = useState<ActionConfirmation | null>(null);
  const sonicAvailable = overview?.capabilities.sonic;
  const viewerLogin = overview?.viewer.login ?? null;
  const openDrawer = (selection: DrawerSelection) => {
    setDrawer(selection);
    setDetailsOpen(true);
    setHelpOpen(false);
  };

  useEffect(() => {
    try {
      setInitialLoadWarningVisible(window.sessionStorage.getItem(INITIAL_LOAD_WARNING_KEY) === "true");
    } catch {
      setInitialLoadWarningVisible(false);
    }
  }, []);

  useEffect(() => {
    if (!viewerLogin) return;
    setPersonalWorkState(readPersonalWorkState(viewerLogin));
    const synchronizePersonalWork = (event: StorageEvent) => {
      if (event.key === personalWorkStorageName(viewerLogin)) setPersonalWorkState(readPersonalWorkState(viewerLogin));
    };
    window.addEventListener("storage", synchronizePersonalWork);
    return () => window.removeEventListener("storage", synchronizePersonalWork);
  }, [viewerLogin]);

  const persistPersonalWorkState = useCallback((next: PersonalWorkState, confirmation?: string) => {
    if (!viewerLogin) return;
    if (confirmation) setPersonalWorkUndo(personalWorkState);
    setPersonalWorkState(next);
    try {
      writePersonalWorkState(viewerLogin, next);
    } catch {
      // Keep the personal queue available for this view when browser storage is unavailable.
    }
    if (confirmation) setPersonalWorkConfirmation({ header: confirmation });
  }, [personalWorkState, viewerLogin]);

  const addReferencesToMyWork = useCallback((references: PersonalWorkReference[]) => {
    if (!references.length) return;
    const next = addReferencesToPersonalWork(personalWorkState, references);
    persistPersonalWorkState(next, `${references.length} ${references.length === 1 ? "item was" : "items were"} added to My work today.`);
  }, [persistPersonalWorkState, personalWorkState]);

  const addPullsToMyWork = useCallback((pulls: MyWorkPull[]) => {
    const now = new Date().toISOString();
    addReferencesToMyWork(pulls.map((pull) => ({ version: 1, source: "github", kind: "pull-request", repository: pull.repository, id: String(pull.id), addedAt: now })));
  }, [addReferencesToMyWork]);

  const undoPersonalWorkChange = () => {
    if (!viewerLogin || !personalWorkUndo) return;
    setPersonalWorkState(personalWorkUndo);
    try {
      writePersonalWorkState(viewerLogin, personalWorkUndo);
    } catch {
      // Keep the restored queue for this view when browser storage is unavailable.
    }
    setPersonalWorkUndo(null);
    setPersonalWorkConfirmation({ header: "My work today was restored." });
  };

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, OVERVIEW_REQUEST_TIMEOUT_MS);
    setLoading(true);
    setError(null);
    fetch(`/api/github/overview?refresh=${refreshKey}`, { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "GitHub data could not be loaded.");
        return data as Overview;
      })
      .then((data) => {
        if (!active) return;
        cachedOverview = data;
        try { window.localStorage.setItem(OVERVIEW_BROWSER_CACHE_KEY, JSON.stringify(data)); } catch { /* Continue with the in-memory cache when browser storage is unavailable. */ }
        setOverview(data);
      })
      .catch((reason) => {
        if (!active) return;
        if (reason.name !== "AbortError") setError(reason.message);
        else if (timedOut) setError("GitHub operational data did not respond within 20 seconds.");
      })
      .finally(() => {
        window.clearTimeout(timeout);
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [refreshKey]);

  useEffect(() => {
    if (!overview) return;
    const snapshot: SidebarSnapshot = {
      viewer: overview.viewer.login,
      repositories: overview.repositories.map(({ name, fullName, attention, pipeline, udsCommon }) => ({ name, fullName, attention, pipeline, udsCommon })),
      renovateCount: overview.renovate.total,
      catalogCount: repositoryCatalog?.metrics.total ?? sidebarSnapshot.catalogCount,
      sonicAvailable: overview.capabilities.sonic,
    };
    try { window.localStorage.setItem(SIDEBAR_CACHE_KEY, JSON.stringify(snapshot)); } catch { /* Keep the in-memory overview when browser storage is unavailable. */ }
  }, [overview, repositoryCatalog, sidebarSnapshot.catalogCount]);

  useEffect(() => {
    if (view !== "uds-packages") return;
    const controller = new AbortController();
    setRepositoryCatalogLoading(true);
    setRepositoryCatalogError(null);
    fetch(`/api/github/uds-packages?refresh=${refreshKey}`, { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "The UDS Packages repository catalog could not be loaded.");
        return data as RepositoryCatalog;
      })
      .then((data) => {
        cachedRepositoryCatalog = data;
        setRepositoryCatalog(data);
      })
      .catch((reason) => {
        if (reason.name !== "AbortError") setRepositoryCatalogError(reason.message);
      })
      .finally(() => setRepositoryCatalogLoading(false));
    return () => controller.abort();
  }, [view, refreshKey]);

  useEffect(() => {
    if (view !== "uds-packages") return;
    const controller = new AbortController();
    setRepositoryContributorsLoading(true);
    setRepositoryContributorsError(null);
    fetch(`/api/github/uds-packages/contributors?refresh=${refreshKey}`, { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Repository contributor counts could not be loaded.");
        return data as RepositoryContributorCounts;
      })
      .then((data) => {
        cachedRepositoryContributorCounts = data;
        setRepositoryContributorCounts(data);
      })
      .catch((reason) => {
        if (reason.name !== "AbortError") setRepositoryContributorsError(reason.message);
      })
      .finally(() => setRepositoryContributorsLoading(false));
    return () => controller.abort();
  }, [view, refreshKey]);

  useEffect(() => {
    if (view !== "repository" || !repositoryName) return;
    const controller = new AbortController();
    let active = true;
    setWorkspaceError(null);
    const cachedWorkspace = cachedWorkspaces.get(repositoryName);
    if (cachedWorkspace) {
      setWorkspace(cachedWorkspace);
      setWorkspaceLoading(false);
    } else {
      setWorkspace(null);
      setWorkspaceLoading(true);
    }
    fetch(`/api/github/repository?repo=${encodeURIComponent(repositoryName)}`, { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Repository data could not be loaded.");
        return data as RepositoryWorkspace;
      })
      .then((data) => {
        cachedWorkspaces.set(repositoryName, data);
        if (active) setWorkspace(data);
      })
      .catch((reason) => {
        if (active && reason.name !== "AbortError") setWorkspaceError({ repository: repositoryName, message: reason.message });
      })
      .finally(() => { if (active) setWorkspaceLoading(false); });
    return () => {
      active = false;
      controller.abort();
    };
  }, [view, repositoryName, refreshKey]);

  useEffect(() => {
    const shouldLoadInfrastructure = sonicAvailable !== undefined && sonicAvailable && (view === "infrastructure" || repositoryName === SONIC_REPOSITORY);
    if (!shouldLoadInfrastructure) {
      // Keep the last successful snapshot in state so route changes never replace it with a loading screen.
      setInfrastructureLoading(false);
      return;
    }
    const controller = new AbortController();
    setInfrastructureLoading(true);
    fetch(`/api/github/infrastructure?refresh=${refreshKey}`, { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Terraform infrastructure could not be analyzed.");
        return data as InfrastructureExplorerData;
      })
      .then((data) => {
        cachedInfrastructure = data;
        setInfrastructure(data);
      })
      .catch((reason) => {
        if (reason.name !== "AbortError") setError(reason.message);
      })
      .finally(() => setInfrastructureLoading(false));
    return () => controller.abort();
  }, [view, repositoryName, refreshKey, sonicAvailable]);

  useEffect(() => {
    if (!overview?.viewer.login) return;
    const controller = new AbortController();
    setSecurityLoading(true);
    setSecurityError(null);
    fetch(`/api/security${securityRefreshRequest ? "?refresh=true" : ""}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Repository security context could not be loaded.");
        return data as SecurityWorkspace;
      })
      .then((data) => {
        cachedSecurityWorkspace = data;
        setSecurityWorkspace(data);
      })
      .catch((reason) => {
        if (reason.name !== "AbortError") setSecurityError(reason.message);
      })
      .finally(() => {
        setSecurityLoading(false);
        if (securityRefreshRequest) setSecurityRefreshRequest(0);
      });
    return () => controller.abort();
  }, [overview?.viewer.login, securityPollKey, securityRefreshRequest]);

  useEffect(() => {
    if (!securityWorkspace?.refreshing) return;
    const timer = window.setTimeout(() => setSecurityPollKey((value) => value + 1), 2_500);
    return () => window.clearTimeout(timer);
  }, [securityWorkspace?.generatedAt, securityWorkspace?.refreshing]);

  useEffect(() => {
    if (!overview?.viewer.login) return;
    const timer = window.setInterval(() => setSecurityPollKey((value) => value + 1), 60_000);
    return () => window.clearInterval(timer);
  }, [overview?.viewer.login]);

  useEffect(() => {
    if (!error) setErrorDismissed(false);
  }, [error]);

  useEffect(() => {
    let lastAutomaticRefresh = Date.now();
    const refreshIfDue = () => {
      if (Date.now() - lastAutomaticRefresh < 60_000) return;
      lastAutomaticRefresh = Date.now();
      setRefreshKey((value) => value + 1);
    };
    const timer = window.setInterval(refreshIfDue, 60_000);
    document.addEventListener("visibilitychange", refreshIfDue);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshIfDue);
    };
  }, []);

  const activeHref = view === "overview" ? "/" : view === "pull-requests" ? "/pull-requests" : view === "renovate" ? "/renovate" : view === "security" ? "/security" : view === "uds-packages" ? "/uds-packages" : view === "infrastructure" ? "/infrastructure" : `/repositories/${repositoryName ?? ""}`;
  const sidebarRepositories = overview?.repositories ?? sidebarSnapshot.repositories;
  const sidebarRenovateCount = overview?.renovate.total ?? sidebarSnapshot.renovateCount;
  const sidebarCatalogCount = repositoryCatalog?.metrics.total ?? sidebarSnapshot.catalogCount;
  const sidebarSonicAvailable = overview?.capabilities.sonic ?? sidebarSnapshot.sonicAvailable;
  const navigation = <ConsoleNavigation activeHref={activeHref} repositories={sidebarRepositories} renovateCount={sidebarRenovateCount} catalogCount={sidebarCatalogCount} sonicAvailable={sidebarSonicAvailable} navigate={(href) => router.push(href)} />;

  const dismissInitialLoadWarning = () => {
    setInitialLoadWarningVisible(false);
    try {
      window.sessionStorage.removeItem(INITIAL_LOAD_WARNING_KEY);
    } catch {
      // Keep the update acknowledgement dismissed in memory when browser storage is unavailable.
    }
  };

  const notifications = error && !errorDismissed || securityError ? (
    <div className="compact-app-notifications"><Flashbar items={[
      ...(error && !errorDismissed ? [{
        type: overview ? "warning" as const : "error" as const,
        header: overview ? "Operational data could not be refreshed" : "Unable to load operational data",
        content: overview ? `Showing data from the last successful refresh. ${error}` : error,
        action: <Button onClick={() => { setErrorDismissed(false); setRefreshKey((value) => value + 1); }}>Try again</Button>,
        dismissible: true,
        onDismiss: () => setErrorDismissed(true),
      }] : []),
      ...(securityError ? [{
        type: securityWorkspace ? "warning" as const : "error" as const,
        header: "Repository security context could not be refreshed",
        content: securityWorkspace ? "Showing the last security state loaded by Scout." : securityError,
      }] : []),
    ]} /></div>
  ) : undefined;

  let content: React.ReactNode;
  if (loading && !overview) {
    content = <div className="operations-loading"><Spinner /><Box color="text-body-secondary">Loading Scout operations</Box></div>;
  } else if (!overview) {
    content = <EmptyState title="Operational data is unavailable" detail="Confirm the GitHub token is available and try again." />;
  } else if (view === "overview") {
    content = <OverviewPage overview={overview} securityWorkspace={securityWorkspace} personalWorkState={personalWorkState} onPersonalWorkStateChange={persistPersonalWorkState} refreshing={loading} refreshError={error} repositoryCatalog={repositoryCatalog} repositoryCatalogLoading={repositoryCatalogLoading} repositoryCatalogError={repositoryCatalogError} refresh={() => setRefreshKey((value) => value + 1)} openDrawer={openDrawer} navigate={(href) => router.push(href)} />;
  } else if (view === "pull-requests") {
    content = <PullRequestsPage overview={overview} personalWorkState={personalWorkState} onAddToMyWork={addPullsToMyWork} openDrawer={openDrawer} />;
  } else if (view === "renovate") {
    content = <RenovatePage overview={overview} openDrawer={openDrawer} />;
  } else if (view === "security") {
    content = <GlobalSecurityPage workspace={securityWorkspace} overview={overview} loading={securityLoading} refresh={() => setSecurityRefreshRequest(1)} navigate={(href) => router.push(href)} />;
  } else if (view === "uds-packages") {
    content = <UdsPackagesCatalogPage overview={overview} catalog={repositoryCatalog} contributorCounts={repositoryContributorCounts} loading={repositoryCatalogLoading} contributorsLoading={repositoryContributorsLoading} error={repositoryCatalogError} contributorsError={repositoryContributorsError} />;
  } else if (view === "infrastructure") {
    content = !overview.capabilities.sonic
      ? <Container><EmptyState title="Infrastructure Explorer is unavailable" detail="Select a repository with infrastructure capabilities in Workspace settings to access infrastructure knowledge." /><Box textAlign="center"><PrimaryActionButton onClick={() => router.push("/settings/repositories")}>Manage GitHub repositories</PrimaryActionButton></Box></Container>
      : infrastructureLoading && !infrastructure
        ? <Box textAlign="center" padding={{ vertical: "xxxl" }}><SpaceBetween size="m"><Spinner size="large" /><Box color="text-body-secondary">Analyzing Terraform configuration and relationships…</Box></SpaceBetween></Box>
        : infrastructure
          ? <InfrastructureExplorer data={infrastructure} onSelect={(node) => openDrawer({ type: "infrastructure-node", node })} />
          : <EmptyState title="Infrastructure analysis is unavailable" detail="Confirm the selected infrastructure source is available and try again." />;
  } else {
    const repositoryOverview = overview.repositories.find((item) => item.fullName === repositoryName);
    const workspaceMatchesRepository = Boolean(workspace && workspace.repository.fullName.toLowerCase() === repositoryName?.toLowerCase());
    const matchingWorkspaceError = workspaceError && workspaceError.repository.toLowerCase() === repositoryName?.toLowerCase() ? workspaceError.message : null;
    const repositorySecurity = securityWorkspace?.repositories.find((item) => item.repositoryId.toLowerCase() === repositoryName?.toLowerCase()) ?? null;
    content = <RepositoryPage overview={overview} securityWorkspace={securityWorkspace} infrastructure={infrastructure} personalWorkState={personalWorkState} onAddPullsToMyWork={addPullsToMyWork} onAddReferencesToMyWork={addReferencesToMyWork} repositoryName={repositoryName} repository={repositoryOverview} workspace={workspaceMatchesRepository ? workspace : null} security={repositorySecurity} loading={workspaceLoading || (!workspaceMatchesRepository && !matchingWorkspaceError)} error={matchingWorkspaceError} openDrawer={openDrawer} navigate={(href) => router.push(href)} />;
  }

  return (
    <>
      <div id="top-navigation">
        <ConsoleTopNavigation
          viewer={overview?.viewer}
          onHome={() => router.push("/")}
          onHelp={() => { setDetailsOpen(false); setHelpOpen(true); }}
          lightMode={lightMode}
          onToggleTheme={toggleTheme}
        />
      </div>
      <AppLayout
        headerSelector="#top-navigation"
        contentType={view === "overview" || view === "infrastructure" || view === "security" ? "dashboard" : "table"}
        navigation={navigation}
        navigationOpen={navigationOpen}
        onNavigationChange={({ detail }) => setNavigationOpen(detail.open)}
        navigationWidth={252}
        toolsHide
        drawers={[
          {
            id: "help",
            content: <OperatorHelp view={view} sonicAvailable={Boolean(overview?.capabilities.sonic)} />,
            trigger: { iconName: "status-info" },
            ariaLabels: { drawerName: "Operator help", closeButton: "Close operator help", triggerButton: "Open operator help" },
            resizable: true,
            defaultSize: 480,
          },
          {
            id: "details",
            content: drawer && overview
              ? <OperationsDrawer selection={drawer} overview={overview} infrastructure={infrastructure} onSelect={openDrawer} isPullInMyWork={(pull, repository) => isPullInPersonalWork({ ...pull, repository }, personalWorkState)} onAddPullToMyWork={(pull, repository) => addPullsToMyWork([{ ...pull, repository }])} isReferenceInMyWork={(reference) => isReferenceInPersonalWork(reference, personalWorkState)} onAddReferenceToMyWork={(reference) => addReferencesToMyWork([reference])} navigate={(href) => { setDetailsOpen(false); router.push(href); }} />
              : <Drawer header="Details"><Box color="text-body-secondary">Choose an item to inspect.</Box></Drawer>,
            trigger: { iconName: "view-vertical" },
            ariaLabels: { drawerName: "Details", closeButton: "Close details", triggerButton: "Open details" },
            resizable: true,
            defaultSize: 520,
          },
        ]}
        activeDrawerId={detailsOpen && drawer ? "details" : helpOpen ? "help" : null}
        onDrawerChange={({ detail }) => {
          if (detail.activeDrawerId === "help") {
            setDetailsOpen(false);
            setHelpOpen(true);
          } else if (detail.activeDrawerId === "details" && drawer) {
            setDetailsOpen(true);
            setHelpOpen(false);
          } else {
            setDetailsOpen(false);
            setHelpOpen(false);
          }
        }}
        notifications={notifications}
        stickyNotifications
        maxContentWidth={1440}
        ariaLabels={{
          navigation: "Primary navigation",
          navigationClose: "Close navigation",
          navigationToggle: "Open navigation",
          notifications: "Notifications",
          drawers: "Details and help panels",
        }}
        content={content}
      />
      {initialLoadWarningVisible ? <ActionSuccessToast
        confirmation={{
          header: loading ? "Dashboard update in progress" : "Dashboard updated",
          content: loading
            ? "Scout is refreshing the homepage with your repository changes. Pull requests, pipelines, releases, and package health may take a few moments to update."
            : "The homepage now reflects your saved repository selection.",
        }}
        onDismiss={dismissInitialLoadWarning}
        duration={loading ? 60_000 : 5_000}
      /> : null}
      {personalWorkConfirmation ? <ActionSuccessToast confirmation={{ ...personalWorkConfirmation, content: personalWorkUndo ? <Button variant="inline-link" onClick={undoPersonalWorkChange}>Undo</Button> : personalWorkConfirmation.content }} onDismiss={() => { setPersonalWorkConfirmation(null); setPersonalWorkUndo(null); }} /> : null}
    </>
  );
}

const helpForView: Record<ConsoleView, { title: string; summary: string; actions: string[] }> = {
  overview: {
    title: "Operational overview",
    summary: "A personalized workflow view across only the repositories selected for the connected GitHub user.",
    actions: ["Start with My work today for Scout recommendations and pull requests you added for personal follow-up.", "Use Since yesterday for a grouped briefing rather than an activity feed.", "Open drawers to verify approvals, required checks, mergeability, and workflow failure context.", "Use Customize cards to change the overview order for this GitHub user in this browser."],
  },
  "pull-requests": {
    title: "Open pull requests",
    summary: "A selected-repository workflow queue showing authors, ownership, approvals, checks, blockers, and who each pull request is waiting on.",
    actions: ["Filter the queue by title, repository, author, or assignee.", "Select one or more pull requests to add them to My work today.", "Open a pull request drawer before continuing to GitHub."],
  },
  security: {
    title: "Repository security context",
    summary: "Security findings and evidence coverage for this selected repository.",
    actions: ["Start with Critical and High upstream application CVEs.", "Use container evidence when Scout correlates it with an image update pull request.", "Review visibility before interpreting an empty result as clear."],
  },
  renovate: {
    title: "Renovate updates",
    summary: "Dependency pull requests authored by Renovate from renovate/* branches, newest first.",
    actions: ["Filter by repository or update text.", "Review assignment and requested-review state before opening GitHub."],
  },
  "uds-packages": {
    title: "UDS Packages catalog",
    summary: "A searchable directory of uds-packages repositories.",
    actions: ["Filter by repository name, description, language, visibility, branch, or contributor count.", "Select any column header to sort the full repository catalog.", "Use operational status to distinguish fully tracked repositories from catalog-only entries.", "Open GitHub for repository-native investigation."],
  },
  infrastructure: {
    title: "Infrastructure Explorer",
    summary: "A comprehension-first inventory of supported infrastructure resources and parsed dependencies.",
    actions: ["Select a resource to inspect purpose, ownership, relationships, and implementation details.", "Treat dependency links as parsed references, not file-proximity assumptions."],
  },
  repository: {
    title: "Repository workspace",
    summary: "Operational details for one tracked repository, including pull requests, issues, pipelines, and version alignment.",
    actions: ["Use summary cards to open focused drawers.", "Use tabs for longer repository-specific queues."],
  },
};

function OperatorHelp({ view, sonicAvailable }: { view: ConsoleView; sonicAvailable: boolean }) {
  const page = helpForView[view];
  return (
    <Drawer header="Operator help">
      <SpaceBetween size="l">
        <div className="operator-help-intro">
          <h3>{page.title}</h3>
          <p>{page.summary}</p>
          <ul>{page.actions.map((action) => <li key={action}>{action}</li>)}</ul>
        </div>

        <ExpandableSection headerText="Feature guide">
        <h4>Work queues</h4>
        <p>Pull request, Renovate, issue, pipeline, and repository security views prioritize work that can lead to an engineering action. Drawers provide context, while GitHub remains the destination for native review and investigation.</p>
        <h4>Repository health and versions</h4>
        <p>Repository pages combine current work with pull requests, pipeline health, dependency updates, repository security context, and version alignment. UDS Core is compared semantically with the latest upstream release. UDS Common versions are read from each root <code>tasks.yaml</code>.</p>
        <h4>Repository-specific capabilities</h4>
        <p>{sonicAvailable ? "The selected SONIC repository exposes an Infrastructure Explorer that translates Terraform into an inventory and dependency view. This capability does not affect other repositories." : "Some recognized repositories can expose additional infrastructure context. It appears only when the selected repository supports it."}</p>
      </ExpandableSection>

      <ExpandableSection headerText="Connections and data flow">
        <ol>
          <li>The browser renders the console and calls local Next.js API routes.</li>
          <li>Server routes call the GitHub REST API for the configured operational repositories and the explicitly requested uds-packages organization catalog. The GitHub token never enters browser data.</li>
          <li>Repository-specific analysis retrieves only the selected source through the server and parses supported resources and references locally.</li>
        </ol>
      </ExpandableSection>

      <ExpandableSection headerText="Refresh and status behavior">
        <ul>
          <li>GitHub operational data refreshes every 60 seconds and on page reload. Current content stays visible while fresh data loads in the background. Repository contributor totals use a longer server cache to avoid repeatedly scanning the full organization. The refresh icon requests an immediate update.</li>
          <li>In-memory and browser caching keep route transitions stable and avoid unnecessary requests.</li>
          <li>Red indicates an actual failure or unavailable dependency. Yellow indicates attention; blue indicates information or navigation.</li>
        </ul>
      </ExpandableSection>

        <ExpandableSection headerText="Safety and operator responsibilities">
          <ul>
            <li>Full operational monitoring remains limited to the tracked repository configuration. The UDS Packages catalog is read-only metadata; catalog-only repositories are not treated as managed.</li>
            <li>GitHub remains read-only except for explicitly confirmed workflow reruns and SONIC package update pull requests; credentials are never exposed.</li>
            <li>A successful or partially deployed test bundle must be removed with <strong>Remove deployment</strong>. Cleanup uses the exact artifact created by that session.</li>
            <li>If the cluster or GitHub is unavailable, the affected action is blocked rather than silently using stale assumptions.</li>
          </ul>
        </ExpandableSection>

        <Box color="text-body-secondary">UDS Scout is local-first. GitHub access is read-only except for explicitly confirmed workflow reruns and SONIC package update pull requests.</Box>
      </SpaceBetween>
    </Drawer>
  );
}

function ConsoleNavigation({ activeHref, repositories, renovateCount, catalogCount, sonicAvailable, navigate }: {
  activeHref: string;
  repositories: SidebarRepository[];
  renovateCount: number;
  catalogCount: number;
  sonicAvailable: boolean;
  navigate: (href: string) => void;
}) {
  const [filter, setFilter] = useState("");
  const normalizedFilter = filter.trim().toLowerCase();
  const visibleRepositories = repositories.filter((repository) => repository.name.toLowerCase().includes(normalizedFilter) || repository.fullName.toLowerCase().includes(normalizedFilter));
  const follows = (href: string) => (event: React.MouseEvent<HTMLAnchorElement>) => { event.preventDefault(); navigate(href); };
  const navLink = (href: string, label: string, icon: React.ReactNode, info?: React.ReactNode) => (
    <a key={href} href={href} className={`mui-nav-link${activeHref === href ? " mui-nav-link-active" : ""}`} onClick={follows(href)} aria-current={activeHref === href ? "page" : undefined}>
      <span className="mui-nav-link-icon">{icon}</span><span className="mui-nav-link-label">{label}</span>{info ? <span className="mui-nav-link-info">{info}</span> : null}
    </a>
  );
  return (
    <nav className="mui-navigation" aria-label="Primary navigation">
      <div className="mui-nav-panel">
        <div className="mui-nav-brand">Repository operations</div>
        <label className="mui-nav-search"><Icon name="search" /><input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Search" aria-label="Search navigation" /></label>
        <div className="mui-nav-group">
          <div className="mui-nav-group-label"><span>Workspace</span><span>−</span></div>
          {navLink("/", "My work today", <Icon name="status-info" />)}
        </div>
        <div className="mui-nav-group">
          <div className="mui-nav-group-label"><span>Work queues</span><span>−</span></div>
          {navLink("/pull-requests", "Open pull requests", <Icon name="file" />)}
          {navLink("/renovate", "Renovate updates", <Icon name="status-warning" />, renovateCount ? <span className="mui-nav-count">{renovateCount}</span> : null)}
        </div>
        {sonicAvailable ? <div className="mui-nav-group"><div className="mui-nav-group-label"><span>Infrastructure</span><span>−</span></div>{navLink("/infrastructure", "Infrastructure Explorer", <Icon name="share" />)}</div> : null}
        <div className="mui-nav-group mui-nav-repositories">
          <div className="mui-nav-group-label"><span>Tracked repositories</span><span>−</span></div>
          {visibleRepositories.map((repository) => navLink(`/repositories/${repository.fullName}`, repository.name, <Icon name="folder" />, repository.attention.level === "action-required" ? <span className={`repository-nav-action ${pipelineFailed(repository.pipeline?.conclusion) ? "repository-nav-action-error" : ""}`}>Action</span> : repository.udsCommon?.status === "outdated" ? <span className="repository-common-update-indicator" title="UDS Common update available" aria-label="UDS Common update available" /> : null))}
          {!visibleRepositories.length ? <div className="mui-nav-empty">No repositories match</div> : null}
        </div>
        <div className="mui-nav-panel-spacer" />
        <div className="mui-nav-footer">
          {navLink("/uds-packages", "UDS Packages catalog", <Icon name="folder" />, catalogCount ? <span className="mui-nav-catalog-count">{catalogCount}</span> : null)}
          {navLink("/settings", "Workspace settings", <Icon name="settings" />)}
        </div>
      </div>
    </nav>
  );
}

const US_TIME_ZONES = [
  { id: "eastern", label: "Eastern Time", timeZone: "America/New_York", color: "#3b82b6" },
  { id: "central", label: "Central Time", timeZone: "America/Chicago", color: "#2f7f8f" },
  { id: "mountain", label: "Mountain Time", timeZone: "America/Denver", color: "#7655a8" },
  { id: "pacific", label: "Pacific Time", timeZone: "America/Los_Angeles", color: "#b04f86" },
] as const;

function usTime(now: Date | null, timeZone: string) {
  if (!now) return "Calculating…";
  return new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(now);
}

export function cachedBrowserViewer(): Overview["viewer"] | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const value = JSON.parse(window.localStorage.getItem("uds-scout:viewer") ?? "null") as Overview["viewer"] | null;
    return value?.login ? value : undefined;
  } catch {
    return undefined;
  }
}

export function ConsoleTopNavigation({ viewer, onHome, onHelp, lightMode, onToggleTheme }: {
  viewer?: Overview["viewer"];
  onHome: () => void;
  onHelp: () => void;
  lightMode: boolean;
  onToggleTheme: () => void;
}) {
  const [now, setNow] = useState<Date | null>(null);
  const displayViewer = viewer ?? cachedBrowserViewer();

  useEffect(() => {
    if (viewer?.login) window.localStorage.setItem("uds-scout:viewer", JSON.stringify(viewer));
  }, [viewer]);
  useEffect(() => {
    let timer: number | null = null;
    const update = () => setNow(new Date());
    const syncTimer = () => {
      if (timer !== null) {
        window.clearInterval(timer);
        timer = null;
      }
      update();
      if (document.visibilityState === "visible") timer = window.setInterval(update, 30_000);
    };
    syncTimer();
    document.addEventListener("visibilitychange", syncTimer);
    return () => {
      if (timer !== null) window.clearInterval(timer);
      document.removeEventListener("visibilitychange", syncTimer);
    };
  }, []);

  return (
    <TopNavigation
      identity={{ href: "/", title: "UDS Scout", logo: { src: "/doug-lg.svg", alt: "Doug" }, onFollow: (event) => { event.preventDefault(); onHome(); } }}
      utilities={[
        { type: "menu-dropdown", text: "US time", title: "US time zones", description: "Current local time with daylight saving adjustments.", iconSvg: <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none" stroke="#3b82b6" strokeWidth="1.7" /><path d="M8 4.5v3.8l2.6 1.5" fill="none" stroke="#3b82b6" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>, ariaLabel: "View United States time zones", items: US_TIME_ZONES.map((zone) => ({ id: zone.id, text: zone.label, secondaryText: usTime(now, zone.timeZone), iconSvg: <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5" fill={zone.color} /></svg> })) },
        { type: "button", iconUrl: "/github-mark.svg", iconAlt: "GitHub", ariaLabel: "Open UDS Scout repository on GitHub", href: UDS_SCOUT_REPOSITORY_URL, target: "_blank", rel: "noopener noreferrer", disableUtilityCollapse: true },
        { type: "button", iconSvg: <svg viewBox="0 0 24 24" aria-hidden="true"><path d={lightMode ? "M12 4V2m0 20v-2m8-8h2M2 12h2m13.66-5.66 1.42-1.42M4.92 19.08l1.42-1.42m0-11.32L4.92 4.92m14.16 14.16-1.42-1.42M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z" : "M20.14 14.14A8 8 0 0 1 9.86 3.86 8 8 0 1 0 20.14 14.14Z"} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>, ariaLabel: lightMode ? "Switch to dark mode" : "Switch to light mode", onClick: onToggleTheme, disableUtilityCollapse: true },
        { type: "button", text: "Help", iconName: "status-info", ariaLabel: "Open operator help", onClick: onHelp },
        { type: "menu-dropdown", text: displayViewer?.login ?? "Loading GitHub user…", iconUrl: displayViewer?.avatar, items: displayViewer ? [{ id: "profile", text: "Open GitHub profile", href: displayViewer.url, external: true }] : [] },
      ]}
      i18nStrings={{ overflowMenuTriggerText: "More", overflowMenuTitleText: "All", overflowMenuDismissIconAriaLabel: "Close menu" }}
    />
  );
}

function catalogRepositoryStatus(item: OrganizationRepository, tracked: Repository | undefined) {
  if (item.archived) return <StatusIndicator type="stopped">Archived</StatusIndicator>;
  if (tracked) return repositoryHealth(tracked);
  return <StatusIndicator type="pending">Not monitored</StatusIndicator>;
}

type CatalogSortKey = "name" | "status" | "openItems" | "visibility" | "defaultBranch" | "language" | "contributors" | "pushedAt";
type CatalogSort = { key: CatalogSortKey; descending: boolean };
const CATALOG_SORT_KEYS: CatalogSortKey[] = ["name", "status", "openItems", "visibility", "defaultBranch", "language", "contributors", "pushedAt"];

function isCatalogSort(value: unknown): value is CatalogSort {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<CatalogSort>;
  return typeof candidate.key === "string" && CATALOG_SORT_KEYS.includes(candidate.key as CatalogSortKey) && typeof candidate.descending === "boolean";
}

function UdsPackagesCatalogPage({ overview, catalog, contributorCounts, loading, contributorsLoading, error, contributorsError }: {
  overview: Overview;
  catalog: RepositoryCatalog | null;
  contributorCounts: RepositoryContributorCounts | null;
  loading: boolean;
  contributorsLoading: boolean;
  error: string | null;
  contributorsError: string | null;
}) {
  const preferencePrefix = sessionPreferenceKey(overview.viewer.login, "uds-packages");
  const [filter, setFilter] = useSessionPreference(`${preferencePrefix}:filter`, "", isString);
  const [currentPage, setCurrentPage] = useSessionPreference(`${preferencePrefix}:page`, 1, isPositiveInteger);
  const [sort, setSort] = useSessionPreference<CatalogSort>(`${preferencePrefix}:sort`, { key: "name", descending: false }, isCatalogSort);
  const trackedByName = new Map(overview.repositories.map((repository) => [repository.fullName.toLowerCase(), repository]));
  const contributorsByRepository = new Map(
    (contributorCounts?.contributors ?? []).map((item) => [item.repository.toLowerCase(), item.count]),
  );
  const query = filter.trim().toLowerCase();
  const filteredItems = (catalog?.repositories ?? []).filter((repository) => {
    const contributorCount = contributorsByRepository.get(repository.fullName.toLowerCase());
    return !query || [
      repository.name,
      repository.fullName,
      repository.description ?? "",
      repository.language ?? "",
      repository.visibility,
      repository.defaultBranch,
      repository.archived ? "archived" : "active",
      repository.fork ? "fork" : "source",
      contributorCount === null || contributorCount === undefined ? "" : String(contributorCount),
    ].some((value) => value.toLowerCase().includes(query));
  });
  const sortValue = (repository: OrganizationRepository): string | number => {
    if (sort.key === "name") return repository.name.toLowerCase();
    if (sort.key === "status") {
      const tracked = trackedByName.get(repository.fullName.toLowerCase());
      return repository.archived ? "archived" : tracked ? tracked.health : "not monitored";
    }
    if (sort.key === "contributors") return contributorsByRepository.get(repository.fullName.toLowerCase()) ?? -1;
    if (sort.key === "pushedAt") return repository.pushedAt ? new Date(repository.pushedAt).getTime() : 0;
    const value = repository[sort.key];
    return typeof value === "string" ? value.toLowerCase() : value ?? "";
  };
  const sortedItems = [...filteredItems].sort((left, right) => {
    const leftValue = sortValue(left);
    const rightValue = sortValue(right);
    const comparison = typeof leftValue === "number" && typeof rightValue === "number"
      ? leftValue - rightValue
      : String(leftValue).localeCompare(String(rightValue));
    return sort.descending ? -comparison : comparison;
  });
  const pageSize = 20;
  const pagesCount = Math.max(1, Math.ceil(sortedItems.length / pageSize));
  const page = Math.min(currentPage, pagesCount);
  const items = sortedItems.slice((page - 1) * pageSize, page * pageSize);
  const referenceTime = catalog?.generatedAt ?? overview.generatedAt;
  const columnDefinitions: TableProps.ColumnDefinition<OrganizationRepository>[] = [
    {
      id: "repository",
      header: "Repository",
      cell: (item) => <SpaceBetween size="xxs"><Link href={item.url} external fontSize="body-m">{item.name}</Link><Box color="text-body-secondary">{item.fullName.split("/")[0]}</Box></SpaceBetween>,
      sortingField: "name",
    },
    { id: "status", header: "Operational status", cell: (item) => catalogRepositoryStatus(item, trackedByName.get(item.fullName.toLowerCase())), sortingField: "status" },
    { id: "items", header: "Open items", cell: (item) => item.openItems || <Box color="text-body-secondary">None</Box>, sortingField: "openItems" },
    { id: "visibility", header: "Visibility", cell: (item) => <SpaceBetween size="xxs"><Badge color="grey">{item.visibility}</Badge><Box color="text-body-secondary">{item.fork ? "Fork" : "Source"}</Box></SpaceBetween>, sortingField: "visibility" },
    { id: "branch", header: "Default branch", cell: (item) => <Box variant="code">{item.defaultBranch}</Box>, sortingField: "defaultBranch" },
    { id: "language", header: "Language", cell: (item) => item.language ?? <Box color="text-body-secondary">Not detected</Box>, sortingField: "language" },
    {
      id: "contributors",
      header: "Contributors",
      cell: (item) => {
        const count = contributorsByRepository.get(item.fullName.toLowerCase());
        if (typeof count === "number") return count;
        if (contributorsLoading && !contributorCounts) return <Spinner />;
        return <Box color="text-body-secondary">Unavailable</Box>;
      },
      sortingField: "contributors",
    },
    { id: "activity", header: "Last push", cell: (item) => relativeTime(item.pushedAt, referenceTime), sortingField: "pushedAt" },
  ];
  const sortingColumn = columnDefinitions.find((column) => column.sortingField === sort.key);

  return (
    <ContentLayout
      header={<Header variant="h1" counter={catalog ? `(${catalog.metrics.total})` : undefined} description="Repositories in the uds-packages organization." actions={catalog ? <Button href={catalog.url} external>Open GitHub organization</Button> : undefined}>UDS Packages catalog</Header>}
    >
      <SpaceBetween size="l">
        {error && catalog ? <Flashbar items={[{ type: "warning", header: "The repository catalog could not be refreshed", content: "Showing the last successfully loaded repository list." }]} /> : null}
        {contributorsError && contributorCounts ? <Flashbar items={[{ type: "warning", header: "Contributor counts could not be refreshed", content: "Showing the last successfully loaded contributor counts." }]} /> : null}
        <Table
          variant="container"
          stickyHeader
          stripedRows
          trackBy="id"
          loading={loading && !catalog}
          loadingText="Loading UDS Packages repositories"
          items={items}
          sortingColumn={sortingColumn}
          sortingDescending={sort.descending}
          onSortingChange={({ detail }) => {
            const key = detail.sortingColumn.sortingField as CatalogSortKey | undefined;
            if (key) {
              setSort({ key, descending: detail.isDescending ?? false });
              setCurrentPage(1);
            }
          }}
          filter={<TextFilter filteringText={filter} onChange={({ detail }) => { setFilter(detail.filteringText); setCurrentPage(1); }} filteringPlaceholder="Find repositories" countText={`${filteredItems.length} matches`} />}
          pagination={<Pagination currentPageIndex={page} pagesCount={pagesCount} onChange={({ detail }) => setCurrentPage(detail.currentPageIndex)} ariaLabels={{ nextPageLabel: "Next page", previousPageLabel: "Previous page", pageLabel: (pageNumber) => `Page ${pageNumber} of all pages` }} />}
          header={<Header variant="h2" counter={catalog ? `(${filteredItems.length})` : undefined} description="Current repository metadata and operational coverage. Select a column header to sort.">Repository status</Header>}
          columnDefinitions={columnDefinitions}
          empty={error && !catalog
            ? <EmptyState title="The UDS Packages catalog is unavailable" detail={error} />
            : <EmptyState title="No repositories found" detail={query ? "Adjust the repository filter." : "No repositories were returned."} />}
        />
      </SpaceBetween>
    </ContentLayout>
  );
}

function PullRequestsPage({ overview, personalWorkState, onAddToMyWork, openDrawer }: {
  overview: Overview;
  personalWorkState: PersonalWorkState;
  onAddToMyWork: (pulls: MyWorkPull[]) => void;
  openDrawer: (selection: DrawerSelection) => void;
}) {
  const preferencePrefix = sessionPreferenceKey(overview.viewer.login, "pull-requests");
  const [selectedPulls, setSelectedPulls] = useState<MyWorkPull[]>([]);
  const [filter, setFilter] = useSessionPreference(`${preferencePrefix}:filter`, "", isString);
  const [repositoryFilter, setRepositoryFilter] = useSessionPreference(`${preferencePrefix}:repository`, "all", isString);
  const [authorFilter, setAuthorFilter] = useSessionPreference(`${preferencePrefix}:author`, "all", isString);
  const repositoryOptions = [
    { label: `All repositories (${overview.pullRequests.length})`, value: "all" },
    ...Array.from(new Set(overview.pullRequests.map((pull) => pull.repository))).sort().map((repository) => ({ label: `${repository} (${overview.pullRequests.filter((pull) => pull.repository === repository).length})`, value: repository })),
  ];
  const authorOptions = [
    { label: `All authors (${overview.pullRequests.length})`, value: "all" },
    ...Array.from(new Set(overview.pullRequests.map((pull) => pull.author))).sort((first, second) => first.localeCompare(second)).map((author) => ({ label: `${author} (${overview.pullRequests.filter((pull) => pull.author === author).length})`, value: author })),
  ];
  const selectedRepository = repositoryOptions.find((option) => option.value === repositoryFilter) ?? repositoryOptions[0];
  const selectedAuthor = authorOptions.find((option) => option.value === authorFilter) ?? authorOptions[0];
  const activeRepository = selectedRepository.value;
  const activeAuthor = selectedAuthor.value;
  const items = overview.pullRequests.filter((pull) => {
    const query = filter.toLowerCase();
    return (activeRepository === "all" || pull.repository === activeRepository)
      && (activeAuthor === "all" || pull.author === activeAuthor)
      && (!query || pull.title.toLowerCase().includes(query) || pull.repository.toLowerCase().includes(query) || pull.author.toLowerCase().includes(query) || pull.assignees.some((assignee) => assignee.login.toLowerCase().includes(query)));
  });
  const selectedKeys = new Set(selectedPulls.map((pull) => `${pull.repository.toLowerCase()}:${pull.id}`));
  const selectedCurrentPulls = items.filter((pull) => selectedKeys.has(`${pull.repository.toLowerCase()}:${pull.id}`) && !isPullInPersonalWork(pull, personalWorkState));
  const addSelectedPulls = () => {
    onAddToMyWork(selectedCurrentPulls);
    setSelectedPulls([]);
  };
  return (
    <ContentLayout header={<Header variant="h1" description="Open changes awaiting review across tracked repositories." counter={`(${overview.pullRequests.length})`}>Open pull requests</Header>}>
      <Table
        variant="container"
        stickyHeader
        stripedRows
        trackBy={(pull) => `${pull.repository.toLowerCase()}:${pull.id}`}
        selectionType="multi"
        selectedItems={selectedCurrentPulls}
        onSelectionChange={({ detail }) => setSelectedPulls([...detail.selectedItems])}
        isItemDisabled={(pull) => isPullInPersonalWork(pull, personalWorkState)}
        ariaLabels={{ selectionGroupLabel: "Select pull requests to add to My work today", itemSelectionLabel: ({ selectedItems }, pull) => isPullInPersonalWork(pull, personalWorkState) ? `${pull.title} is already in My work today` : `${selectedItems.includes(pull) ? "Deselect" : "Select"} ${pull.title}` }}
        items={items}
        filter={<div className="table-filters pull-request-table-filters"><TextFilter filteringText={filter} onChange={({ detail }) => setFilter(detail.filteringText)} filteringPlaceholder="Find pull requests" countText={`${items.length} matches`} /><Select selectedOption={selectedRepository} onChange={({ detail }) => setRepositoryFilter(detail.selectedOption.value ?? "all")} options={repositoryOptions} /><Select selectedOption={selectedAuthor} onChange={({ detail }) => setAuthorFilter(detail.selectedOption.value ?? "all")} options={authorOptions} /></div>}
        header={<Header variant="h2" counter={`(${items.length})`} description="Review ownership, pipeline health, status, and recent activity." actions={selectedCurrentPulls.length ? <PrimaryActionButton onClick={addSelectedPulls}>{`Add to My work (${selectedCurrentPulls.length})`}</PrimaryActionButton> : undefined}>Pull requests</Header>}
        columnDefinitions={[
          { id: "title", header: "Pull request", cell: (item) => <SpaceBetween size="xxs"><Link href={item.url} onFollow={(event) => { event.preventDefault(); openDrawer({ type: "pull-request", pull: item, repository: item.repository }); }}>{item.title}</Link><Box color="text-body-secondary">#{item.number}{isPullInPersonalWork(item, personalWorkState) ? " · in My work" : ""}</Box></SpaceBetween> },
          { id: "repository", header: "Repository", cell: (item) => <Link href={`/repositories/${item.repository}`} onFollow={(event) => { const repository = overview.repositories.find((candidate) => candidate.fullName === item.repository); if (repository) { event.preventDefault(); openDrawer({ type: "repository", repository }); } }}>{item.repository}</Link> },
          { id: "author", header: "Author", cell: (item) => <PullAuthor pull={item} /> },
          { id: "assignment", header: "Assignment / review", cell: (item) => <SpaceBetween size="xxs"><PullPeople people={item.assignees} />{item.requestedReviewers.some((reviewer) => reviewer.login.toLowerCase() === overview.viewer.login.toLowerCase()) ? <StatusIndicator type="info">Your review requested</StatusIndicator> : null}</SpaceBetween> },
          { id: "pipeline", header: "Pipeline / checks", cell: (item) => <PullRequestCheckStatus pull={item} onOpen={() => openDrawer({ type: "pull-request", pull: item, repository: item.repository, focus: "failed-checks" })} /> },
          { id: "status", header: "PR status", cell: pullWorkflowStatus },
          { id: "updated", header: "Updated", cell: (item) => relativeTime(item.updatedAt, overview.generatedAt) },
        ]}
        empty={<EmptyState title="No matching pull requests" detail="Adjust the search, repository, or author filters." />}
      />
    </ContentLayout>
  );
}

function RenovatePage({ overview, openDrawer }: { overview: Overview; openDrawer: (selection: DrawerSelection) => void }) {
  const queryParameters = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
  const queryRepository = queryParameters?.get("repository") ?? "all";
  const requestedView = queryParameters?.get("view");
  const requestedCheckFilter: RenovateCheckFilter = requestedView === "all" ? "all" : requestedView === "major" ? "major" : "priority";
  const useRequestedView = requestedView === "all" || requestedView === "major";
  const [repository, setRepository] = useSessionPreference(sessionPreferenceKey(overview.viewer.login, "renovate:repository"), queryRepository, isString, useRequestedView || queryRepository !== "all");
  const [filter, setFilter] = useSessionPreference(sessionPreferenceKey(overview.viewer.login, "renovate:filter"), "", isString, useRequestedView);
  const [checkFilter, setCheckFilter] = useSessionPreference<RenovateCheckFilter>(sessionPreferenceKey(overview.viewer.login, "renovate:pipeline:v2"), requestedCheckFilter, isRenovateCheckFilter, useRequestedView);
  const repositoryOptions = [{ label: `All repositories (${overview.renovate.total})`, value: "all" }, ...overview.repositories.map((item) => ({ label: `${item.fullName} (${item.renovatePulls})`, value: item.fullName }))];
  const selectedRepository = repositoryOptions.find((option) => option.value === repository) ?? repositoryOptions[0];
  const activeRepository = selectedRepository.value;
  const matchingUpdates = sortRenovateUpdates(overview.renovate.pulls.filter((pull) => {
    const query = filter.toLowerCase();
    return (activeRepository === "all" || pull.repository === activeRepository) && (!query || pull.title.toLowerCase().includes(query) || pull.head.toLowerCase().includes(query) || pull.author.toLowerCase().includes(query) || pull.assignees.some((assignee) => assignee.login.toLowerCase().includes(query)));
  }));
  const pipelineOptions = renovateCheckFilterOptions(matchingUpdates);
  const selectedPipeline = pipelineOptions.find((option) => option.value === checkFilter) ?? pipelineOptions[0];
  const items = filterRenovateUpdatesByCheck(matchingUpdates, checkFilter);
  return (
    <ContentLayout
      header={<Header variant="h1" description="Open dependency updates created by Renovate. Major version updates appear first, followed by pipeline state and age." counter={`(${overview.renovate.total})`}>Renovate updates</Header>}
    >
      <SpaceBetween size="l">
        {overview.renovate.unassignedTotal ? <Flashbar items={[{
          type: "warning",
          header: `${overview.renovate.unassignedTotal} automated ${overview.renovate.unassignedTotal === 1 ? "update requires" : "updates require"} manual attention`,
          content: `${overview.renovate.total} open ${overview.renovate.total === 1 ? "update is" : "updates are"} shown below. Only observable blockers, direct assignment or review requests, and configured priority labels elevate an update on the overview.`,
        }]} /> : null}
        <RenovateUpdatesTable
          referenceTime={overview.generatedAt}
          openDrawer={openDrawer}
          items={items}
          filter={<div className="table-filters renovate-table-filters"><TextFilter filteringText={filter} onChange={({ detail }) => setFilter(detail.filteringText)} filteringPlaceholder="Find dependency updates" countText={`${items.length} matches`} /><Select selectedOption={selectedRepository} onChange={({ detail }) => setRepository(detail.selectedOption.value ?? "all")} options={repositoryOptions} /><Select selectedOption={selectedPipeline} onChange={({ detail }) => setCheckFilter(detail.selectedOption.value as RenovateCheckFilter)} options={pipelineOptions} /></div>}
          emptyDetail={checkFilter === "priority" ? "No failed or major-version updates match the current repository and search filters." : checkFilter === "major" ? "No major version updates match the current repository and search filters." : checkFilter !== "all" ? "No updates match this pipeline state." : activeRepository === "all" ? "Tracked dependencies are current. Nothing needs review." : "This repository has no open Renovate pull requests."}
        />
      </SpaceBetween>
    </ContentLayout>
  );
}

function RepositoryPullRequestTable({ items, title, repository, referenceTime, personalWorkState, onAddToMyWork, openDrawer }: {
  items: PullRequest[];
  title: string;
  repository: string;
  referenceTime: string;
  personalWorkState: PersonalWorkState;
  onAddToMyWork: (pulls: MyWorkPull[]) => void;
  openDrawer: (selection: DrawerSelection) => void;
}) {
  const [selectedPulls, setSelectedPulls] = useState<PullRequest[]>([]);
  const availablePulls = items.map((pull) => ({ ...pull, repository }));
  const selectedKeys = new Set(selectedPulls.map((pull) => pull.id));
  const selectedCurrentPulls = availablePulls.filter((pull) => selectedKeys.has(pull.id) && !isPullInPersonalWork(pull, personalWorkState));
  return (
    <Table
      variant="container"
      trackBy="id"
      selectionType="multi"
      selectedItems={selectedCurrentPulls}
      onSelectionChange={({ detail }) => setSelectedPulls([...detail.selectedItems])}
      isItemDisabled={(pull) => isPullInPersonalWork({ ...pull, repository }, personalWorkState)}
      ariaLabels={{ selectionGroupLabel: `Select ${title.toLowerCase()} to add to My work today`, itemSelectionLabel: ({ selectedItems }, pull) => isPullInPersonalWork({ ...pull, repository }, personalWorkState) ? `${pull.title} is already in My work today` : `${selectedItems.includes(pull) ? "Deselect" : "Select"} ${pull.title}` }}
      items={availablePulls}
      header={<Header variant="h2" counter={`(${items.length})`} description="Open a pull request title for workflow details." actions={selectedCurrentPulls.length ? <PrimaryActionButton onClick={() => { onAddToMyWork(selectedCurrentPulls); setSelectedPulls([]); }}>{`Add to My work (${selectedCurrentPulls.length})`}</PrimaryActionButton> : undefined}>{title}</Header>}
      columnDefinitions={[
        { id: "title", header: "Pull request", cell: (item) => <SpaceBetween size="xxs"><Link href={item.url} onFollow={(event) => { event.preventDefault(); openDrawer({ type: "pull-request", pull: item, repository }); }}>{item.title}</Link><Box color="text-body-secondary">#{item.number}</Box></SpaceBetween> },
        { id: "author", header: "Author", cell: (item) => <PullAuthor pull={item} /> },
        { id: "assignee", header: "Assigned to", cell: (item) => <PullPeople people={item.assignees} /> },
        { id: "branch", header: "Source branch", cell: (item) => <Box variant="code">{item.head}</Box> },
        { id: "target", header: "Target branch", cell: (item) => <Box variant="code">{item.base}</Box> },
        { id: "workflow", header: "Workflow state", cell: pullWorkflowStatus },
        { id: "why", header: "Why it is shown", cell: (item) => item.workflow.reason },
        { id: "updated", header: "Updated", cell: (item) => relativeTime(item.updatedAt, referenceTime) },
      ]}
      empty={<EmptyState title={`No ${title.toLowerCase()}`} detail="No items require review." />}
    />
  );
}

function packageSourceRepository(packageName: string) {
  if (packageName === "core") return "defenseunicorns/uds-core";
  if (packageName === "uds-ui") return "defenseunicorns/uds-ui";
  return `uds-packages/${packageName}`;
}

type SonicSecurityStatus = "critical" | "high" | "covered" | "incomplete" | "not-evaluated";

function sonicPackageSecurityStatus(item: UdsPackage, security: RepositorySecurity | null, securityWorkspace: SecurityWorkspace | null, independentSecurity: Record<string, { status: SonicSecurityStatus; vulnerabilities: string[] }>): SonicSecurityStatus {
  if (independentSecurity[item.name]) return independentSecurity[item.name].status;
  const sources: RepositorySecurity[] = [];
  for (const candidate of [security, ...(securityWorkspace?.repositories ?? [])]) {
    if (candidate && !sources.some((entry) => entry.repositoryId === candidate.repositoryId)) sources.push(candidate);
  }
  const packageName = item.name.toLowerCase();
  const packageSecurity = sources.filter((candidate) => candidate.repositoryId.toLowerCase().endsWith(`/${packageName}`) || candidate.applications.some((application) => application.packageName.toLowerCase() === packageName));
  if (!packageSecurity.length) return "not-evaluated";
  const versionParts = (value: string | null) => { const match = value?.match(/(\d+)\.(\d+)\.(\d+)/); return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null; };
  const compare = (left: number[], right: number[]) => left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
  const findings = packageSecurity.flatMap((candidate) => candidate.findings.map((finding) => ({ finding, vulnerability: candidate.vulnerabilities[finding.vulnerabilityId] }))).filter(({ finding, vulnerability }) => {
    if (finding.status !== "open") return false;
    const flavorMatches = !finding.flavor || !item.flavor || finding.flavor.toLowerCase() === item.flavor.toLowerCase();
    const genericNvdAdvisory = vulnerability?.providers.includes("NVD") ?? false;
    if (!flavorMatches && !genericNvdAdvisory) return false;
    if (finding.installedVersion === item.version) return true;
    const deployed = versionParts(item.version);
    if (!deployed) return false;
    return (vulnerability?.affectedRanges ?? []).some((range) => {
      const start = versionParts(range.start);
      const end = versionParts(range.end);
      return (!start || compare(deployed, start) >= 0) && (!end || compare(deployed, end) < 0);
    });
  });
  if (findings.some(({ finding }) => finding.severity === "critical")) return "critical";
  if (findings.some(({ finding }) => finding.severity === "high")) return "high";
  const applications = packageSecurity.flatMap((candidate) => candidate.applications.filter((application) => application.packageName.toLowerCase() === packageName || application.name.toLowerCase() === packageName));
  return applications.length && applications.every((application) => application.coverage === "full") ? "covered" : "incomplete";
}

function renovateCapabilityType(capability: RenovateCapability): "success" | "warning" | "info" | "pending" | "error" {
  if (capability.status === "enabled") return "success";
  if (capability.status === "disabled") return "warning";
  if (capability.status === "unknown") return "error";
  return "pending";
}

function renovateCapabilityLabel(capability: RenovateCapability) {
  if (capability.status === "enabled") return "Enabled";
  if (capability.status === "disabled") return "Disabled";
  if (capability.status === "unknown") return "Unable to verify";
  return "Not configured";
}

function RenovateHealthPanel({ health, openUpdates, mergedUpdates }: { health: RenovateHealth; openUpdates: number; mergedUpdates: number }) {
  const recommendations: string[] = [];
  if (health.automerge.status === "disabled" && openUpdates > 0) recommendations.push(`${openUpdates} updates are waiting for manual merges. Consider automerging safe updates after required checks pass.`);
  if (health.grouping.status === "not-configured" && openUpdates > 2) recommendations.push("Multiple updates are open without grouping. Grouping compatible updates could reduce PR noise.");
  if (health.dependencyDashboard.status === "not-configured" && openUpdates > 0) recommendations.push("No Dependency Dashboard is configured. It can centralize blocked and pending updates without more PRs.");
  const capabilityItems = [
    ["Automerge", health.automerge], ["Dependency Dashboard", health.dependencyDashboard], ["Grouping", health.grouping], ["Schedule", health.schedule], ["Release age", health.releaseAge], ["Digest pinning", health.digestPinning],
  ] as const;
  const sources = [health.configSource ? <Link key="local" href={health.configSource} external>Repository config</Link> : null, health.sharedPreset?.source ? <Link key="shared" href={health.sharedPreset.source} external>Shared preset</Link> : null].filter(Boolean);
  return <Container id="renovate-health" header={<Header variant="h2" description="Configuration, inheritance, and opportunities to reduce manual work.">Renovate health</Header>}>
    <SpaceBetween size="m">
      <SpaceBetween direction="horizontal" size="l"><StatusIndicator type={recommendations.length ? "warning" : "success"}>{recommendations.length ? `${recommendations.length} efficiency opportun${recommendations.length === 1 ? "y" : "ies"}` : "No immediate efficiency concerns"}</StatusIndicator><Box color="text-body-secondary">{openUpdates} open update{openUpdates === 1 ? "" : "s"} · {mergedUpdates} merged update{mergedUpdates === 1 ? "" : "s"} in this repository view</Box></SpaceBetween>
      <Grid gridDefinition={capabilityItems.map(() => ({ colspan: { default: 12, xs: 6, l: 4 } }))}>{capabilityItems.map(([label, capability]) => <Box key={label} className="renovate-health-capability"><Box variant="awsui-key-label">{label}</Box><StatusIndicator type={renovateCapabilityType(capability)}>{renovateCapabilityLabel(capability)}</StatusIndicator><Box color="text-body-secondary">{capability.origin === "shared" ? "Inherited from shared preset" : capability.origin === "repository" ? "Set in this repository" : capability.detail}</Box></Box>)}</Grid>
      {recommendations.length ? <ExpandableSection headerText="Opportunities to reduce manual work"><SpaceBetween size="s">{recommendations.map((recommendation) => <Box key={recommendation}>{recommendation}</Box>)}</SpaceBetween></ExpandableSection> : null}
      <Box color="text-body-secondary">Configuration: {sources.length ? <SpaceBetween direction="horizontal" size="xs">{sources}</SpaceBetween> : "No Renovate configuration source found."}{health.sharedPreset ? <Box>Shared preset: <Box variant="code" display="inline">{health.sharedPreset.repository}/{health.sharedPreset.path}</Box>{health.localOverrides.length ? ` · ${health.localOverrides.length} local override${health.localOverrides.length === 1 ? "" : "s"}` : ""}</Box> : null}</Box>
    </SpaceBetween>
  </Container>;
}

function RepositoryPage({ overview, securityWorkspace, infrastructure, personalWorkState, onAddPullsToMyWork, onAddReferencesToMyWork, repositoryName, repository, workspace, security, loading, error, openDrawer, navigate }: {
  overview: Overview;
  securityWorkspace: SecurityWorkspace | null;
  infrastructure: InfrastructureExplorerData | null;
  personalWorkState: PersonalWorkState;
  onAddPullsToMyWork: (pulls: MyWorkPull[]) => void;
  onAddReferencesToMyWork: (references: PersonalWorkReference[]) => void;
  repositoryName?: string;
  repository?: Repository;
  workspace: RepositoryWorkspace | null;
  security: RepositorySecurity | null;
  loading: boolean;
  error: string | null;
  openDrawer: (selection: DrawerSelection) => void;
  navigate: (href: string) => void;
}) {
  const securityEligible = isSecurityContextRepository(repositoryName ?? "");
  const requestedTab = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("tab") : null;
  const [activeTab, setActiveTab] = useState(requestedTab === "security" && securityEligible ? "security" : "overview");
  const [sonicPackageFilter, setSonicPackageFilter] = useState("");
  const [sonicPackageStatusFilter, setSonicPackageStatusFilter] = useState("all");
  const [sonicPackageSortKey, setSonicPackageSortKey] = useState<"status" | "name">("status");
  const [sonicPackageSortDescending, setSonicPackageSortDescending] = useState(false);
  const [sonicIndependentSecurity, setSonicIndependentSecurity] = useState<Record<string, { status: SonicSecurityStatus; vulnerabilities: string[] }>>({});
  const [sonicIndependentSecurityLoaded, setSonicIndependentSecurityLoaded] = useState(false);
  const [selectedIssues, setSelectedIssues] = useState<MyWorkIssue[]>([]);
  const [selectedRuns, setSelectedRuns] = useState<MyWorkPipeline[]>([]);
  const [sonicUpdateOptions, setSonicUpdateOptions] = useState<UdsPackage[]>([]);
  const [sonicUpdateSelection, setSonicUpdateSelection] = useState<UdsPackage[]>([]);
  const [sonicUpdateSubmitting, setSonicUpdateSubmitting] = useState(false);
  const [sonicUpdateError, setSonicUpdateError] = useState<string | null>(null);
  const [sonicUpdateResult, setSonicUpdateResult] = useState<{ url: string; title: string } | null>(null);
  const createSonicUpdate = async () => {
    const selectedUpdates = sonicUpdateSelection;
    if (!selectedUpdates.length) return;
    setSonicUpdateSubmitting(true);
    setSonicUpdateError(null);
    try {
      const response = await fetch("/api/github/sonic-update", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ repository: SONIC_REPOSITORY, updates: selectedUpdates.map((item) => ({ packageName: item.name, packageRepository: item.repository, sourceFile: item.source.file, sourceLine: item.source.line, currentVersion: item.version, nextVersion: item.latestVersion, flavor: item.flavor, architecture: item.architecture ?? "amd64" })) }) });
      const result = await response.json() as { error?: string; pullRequest?: { url: string; title: string } };
      if (!response.ok || !result.pullRequest) throw new Error(result.error ?? "The update pull request could not be created.");
      setSonicUpdateResult(result.pullRequest);
    } catch (error) {
      setSonicUpdateError(error instanceof Error ? error.message : "The update pull request could not be created.");
    } finally {
      setSonicUpdateSubmitting(false);
    }
  };
  useEffect(() => {
    if (repositoryName !== SONIC_REPOSITORY || !infrastructure?.deployment.packages.length) return;
    setSonicIndependentSecurityLoaded(false);
    const controller = new AbortController();
    fetch("/api/github/sonic-security", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ repository: SONIC_REPOSITORY, packages: infrastructure.deployment.packages.map((item) => ({ name: item.name, version: item.version })) }), signal: controller.signal }).then((response) => response.ok ? response.json() as Promise<{ results?: Record<string, { status: SonicSecurityStatus; vulnerabilities: string[] }> }> : Promise.reject(new Error("Security coverage unavailable"))).then((result) => { setSonicIndependentSecurity(result.results ?? {}); setSonicIndependentSecurityLoaded(true); }).catch((reason) => { if (reason.name !== "AbortError") { setSonicIndependentSecurity({}); setSonicIndependentSecurityLoaded(true); } });
    return () => controller.abort();
  }, [repositoryName, infrastructure]);

  useEffect(() => {
    const tab = new URLSearchParams(window.location.search).get("tab");
    setActiveTab(tab === "security" && securityEligible ? "security" : "overview");
  }, [repositoryName, securityEligible]);

  if (loading) {
    const loadingRepositoryName = repository?.name ?? repositoryName?.split("/").at(-1) ?? "Repository";
    return <ContentLayout header={<Header variant="h1">{loadingRepositoryName}</Header>}><Box textAlign="center" padding={{ vertical: "xxxl" }}><SpaceBetween size="m"><Spinner size="large" /><Box color="text-body-secondary">Loading repository operations…</Box></SpaceBetween></Box></ContentLayout>;
  }
  if (!repository) {
    return <ContentLayout header={<Header variant="h1">Repository not found</Header>}><EmptyState title="Repository is not tracked" detail="Choose a repository from the navigation panel." /></ContentLayout>;
  }
  if (!workspace) {
    return <ContentLayout header={<Header variant="h1">{repository.name}</Header>}><EmptyState title="Repository details are unavailable" detail={error ?? "GitHub did not return repository details. Try refreshing this page."} /></ContentLayout>;
  }

  const renovatePulls = newestPulls(workspace.pulls.open.filter((pull) => pull.workflow.renovate));
  const latestRelease = workspace.releases.filter((release) => !release.prerelease).sort((left, right) => new Date(right.publishedAt ?? 0).getTime() - new Date(left.publishedAt ?? 0).getTime())[0] ?? null;
  const isPackageRepository = repository.fullName.toLowerCase().startsWith("uds-packages/");
  const issues = workspace.issues ?? [];
  const runs = workspace.actions?.runs ?? [];
  const referenceTime = workspace.generatedAt;
  const failedPipelineUrl = pipelineFailed(repository.pipeline?.conclusion) ? repository.pipeline?.url : undefined;
  const issueReferences = new Map(personalWorkState.references.filter((reference) => reference.kind === "issue").map((reference) => [`${reference.repository.toLowerCase()}:${reference.id}`, reference]));
  const runReferences = new Map(personalWorkState.references.filter((reference) => reference.kind === "workflow").map((reference) => [`${reference.repository.toLowerCase()}:${reference.id}`, reference]));
  const selectedCurrentIssues = selectedIssues.filter((issue) => !issueReferences.has(`${issue.repository.toLowerCase()}:${issue.id}`));
  const selectedCurrentRuns = selectedRuns.filter((run) => !runReferences.has(`${run.repository.toLowerCase()}:${run.id}`));
  const isSonicRepository = repository.fullName === SONIC_REPOSITORY;
  const securityHasCoverage = Boolean(security && (security.applications.some((application) => application.coverage !== "unknown") || security.artifacts.some((artifact) => artifact.securityCoverage.container !== "unavailable")));
  const securityCoverageIncomplete = Boolean(security && (!security.applications.every((application) => application.coverage === "full") || !security.artifacts.every((artifact) => artifact.securityCoverage.container === "full")));
  const directApplicationFindings = security?.findings.filter((finding) => finding.category === "application") ?? [];
  const directApplicationCves = new Set(directApplicationFindings.map((finding) => finding.vulnerabilityId));
  const highImpactApplicationFindings = directApplicationFindings.filter((finding) => finding.severity === "critical" || finding.severity === "high");
  const highImpactApplicationCves = new Set(highImpactApplicationFindings.map((finding) => finding.vulnerabilityId));
  const directApplicationCritical = new Set(highImpactApplicationFindings.filter((finding) => finding.severity === "critical").map((finding) => finding.vulnerabilityId)).size;
  const directApplicationHigh = new Set(highImpactApplicationFindings.filter((finding) => finding.severity === "high").map((finding) => finding.vulnerabilityId)).size;
  const affectedApplicationVersions = new Set(highImpactApplicationFindings.map((finding) => finding.applicationId).filter(Boolean)).size;
  const renovateAutomergeEnabled = workspace.renovateHealth.automerge.status === "enabled";
  const renovateAutomergeLabel = renovateAutomergeEnabled ? "Enabled" : workspace.renovateHealth.automerge.status === "disabled" ? "Disabled" : workspace.renovateHealth.automerge.status === "unknown" ? "Unable to verify" : "Not configured";
  const renovateAutomergeType: "success" | "warning" | "error" | "pending" = renovateAutomergeEnabled ? "success" : workspace.renovateHealth.automerge.status === "disabled" ? "warning" : workspace.renovateHealth.automerge.status === "unknown" ? "error" : "pending";
  const severeContainerCves = new Set(security?.findings.filter((finding) => finding.category !== "application" && (finding.severity === "critical" || finding.severity === "high")).map((finding) => finding.vulnerabilityId) ?? []);
  const sonicIndependentCritical = new Set(Object.values(sonicIndependentSecurity).filter((item) => item.status === "critical").flatMap((item) => item.vulnerabilities));
  const sonicIndependentHigh = new Set(Object.values(sonicIndependentSecurity).filter((item) => item.status === "high").flatMap((item) => item.vulnerabilities));
  const sonicIndependentUnknown = Object.values(sonicIndependentSecurity).filter((item) => item.status === "not-evaluated" || item.status === "incomplete").length;
  const allSonicAvailablePackages = infrastructure?.deployment.packages.filter((item) => item.registryUrl && item.updateStatus === "update-available") ?? [];
  const sonicBundlePackages = [...(infrastructure?.deployment.packages.filter((item) => item.registryUrl && item.name.toLowerCase().includes(sonicPackageFilter.trim().toLowerCase()) && (sonicPackageStatusFilter === "all" || item.updateStatus === sonicPackageStatusFilter)) ?? [])].sort((left, right) => {
    if (sonicPackageSortKey === "status") {
      const rank = (status: typeof left.updateStatus) => status === "update-available" ? 0 : status === "unknown" ? 1 : 2;
      const statusOrder = rank(left.updateStatus) - rank(right.updateStatus);
      if (statusOrder) return sonicPackageSortDescending ? -statusOrder : statusOrder;
    }
    const nameOrder = left.name.localeCompare(right.name);
    return sonicPackageSortDescending ? -nameOrder : nameOrder;
  });
  const modalUpdates = sonicUpdateOptions;
  const relatedResources = (
    <Container header={<Header variant="h2">Related resources</Header>}>
      <SpaceBetween direction="horizontal" size="xs">
        <Button href={repository.url} external>Repository</Button>
        <Button href={`${repository.url}/pulls`} external>Pull requests</Button>
        <Button href={`${repository.url}/issues`} external>Issues</Button>
        <Button href={`${repository.url}/actions`} external>Pipelines</Button>
      </SpaceBetween>
    </Container>
  );

  return (
    <>
    <ContentLayout
      header={
        <SpaceBetween size="m">
          <BreadcrumbGroup items={[{ text: "Repositories", href: "/" }, { text: repository.fullName, href: `/repositories/${repository.fullName}` }]} onFollow={(event) => { event.preventDefault(); navigate(event.detail.href); }} />
          <Header variant="h1" description={repository.description ?? "Managed repository"} actions={<Button href={repository.url} external>Open in GitHub</Button>}>{repository.name}</Header>
        </SpaceBetween>
      }
    >
      <SpaceBetween size="l">
        {pipelineFailed(repository.pipeline?.conclusion) ? <Flashbar items={[{ type: "error", header: "The latest pipeline failed", content: "Review the failed run before merging or releasing additional changes.", action: failedPipelineUrl ? <Button href={failedPipelineUrl} external>View pipeline</Button> : undefined }]} /> : null}


        <Grid gridDefinition={[
          { colspan: { default: 12, xs: 6, l: 3 } },
          { colspan: { default: 12, xs: 6, l: 3 } },
          { colspan: { default: 12, xs: 6, l: 3 } },
          { colspan: { default: 12, xs: 6, l: 3 } },
          { colspan: { default: 12, xs: 6, l: 3 } },
          { colspan: { default: 12, xs: 6, l: 3 } },
          { colspan: { default: 12, xs: 6, l: 3 } },
        ]}>
          <MetricCard title="Open pull requests" value={workspace.pullStats.open} description={`${repository.workflowCounts.waitingOnMe} waiting on you · ${repository.workflowCounts.blocked} blocked · ${repository.workflowCounts.readyToMerge} ready to merge`} onDetails={() => openDrawer({ type: "open-pulls", repository: repository.fullName })} />
          <MetricCard title="Renovate updates" value={renovatePulls.length} description={repository.unassignedRenovatePulls ? `${repository.unassignedRenovatePulls} need manual attention` : "Routine automated updates"} onDetails={() => openDrawer({ type: "renovate", repository: repository.fullName })} indicator={repository.unassignedRenovatePulls ? { type: "warning", label: "Manual action required" } : undefined} />
          <MetricCard title="Open issues" value={issues.length} description={`${overview.myWork.assignedIssues.filter((issue) => issue.repository === repository.fullName).length} assigned to you`} onDetails={() => openDrawer({ type: "issues", repository: repository.fullName })} />
          <MetricCard title="Default branch workflow" value={repository.pipeline?.conclusion === "success" ? "Passing" : pipelineFailed(repository.pipeline?.conclusion) ? "Failed" : "Unavailable"} description={pipelineFailed(repository.pipeline?.conclusion) ? "Latest run failed" : repository.workflowCounts.blocked ? `${repository.workflowCounts.blocked} blocked` : "No blockers"} onDetails={() => openDrawer({ type: "pipelines", repository: repository.fullName })} attention={pipelineFailed(repository.pipeline?.conclusion)} indicator={pipelineFailed(repository.pipeline?.conclusion) ? { type: "error", label: "Workflow failed" } : repository.pipeline?.conclusion === "success" ? { type: "success", label: "Workflow passing" } : { type: "pending", label: "Workflow status unavailable" }} valueTone={repository.pipeline?.conclusion === "success" ? "success" : pipelineFailed(repository.pipeline?.conclusion) ? "error" : undefined} />
          {isPackageRepository ? <MetricCard title="Renovate automerge" value={renovateAutomergeLabel} description={renovateAutomergeEnabled ? "Safe updates merge after checks" : workspace.renovateHealth.automerge.status === "disabled" ? "Manual merge required" : "No rule configured"} onDetails={() => { setActiveTab("overview"); window.setTimeout(() => document.getElementById("renovate-health")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0); }} indicator={{ type: renovateAutomergeType, label: `Renovate automerge ${renovateAutomergeLabel.toLowerCase()}` }} valueTone={renovateAutomergeEnabled ? "success" : workspace.renovateHealth.automerge.status === "disabled" ? "warning" : workspace.renovateHealth.automerge.status === "unknown" ? "error" : undefined} /> : null}
          {isPackageRepository ? <MetricCard title="Latest release" value={latestRelease ? <span className="latest-release-version"><Link href={latestRelease.url} external fontSize="inherit">{latestRelease.tag}</Link></span> : "Unavailable"} description={latestRelease?.publishedAt ? `Published ${latestRelease.publishedAt.slice(0, 10)}.` : "No stable GitHub release found."} /> : null}
          {securityEligible ? <MetricCard title="Security context" value={!security || security.state === "queued" || security.state === "refreshing" || security.state === "pending" || (isSonicRepository && !sonicIndependentSecurityLoaded) ? "Analyzing" : security.applicable === false ? "Not applicable" : isSonicRepository && sonicIndependentCritical.size ? `${sonicIndependentCritical.size} critical bundle CVE${sonicIndependentCritical.size === 1 ? "" : "s"}` : isSonicRepository && sonicIndependentHigh.size ? `${sonicIndependentHigh.size} high-impact bundle CVE${sonicIndependentHigh.size === 1 ? "" : "s"}` : directApplicationCritical ? `${directApplicationCritical} critical app CVE${directApplicationCritical === 1 ? "" : "s"}` : highImpactApplicationCves.size ? `${highImpactApplicationCves.size} high-impact app CVE${highImpactApplicationCves.size === 1 ? "" : "s"}` : directApplicationCves.size ? `${directApplicationCves.size} other app ${directApplicationCves.size === 1 ? "advisory" : "advisories"}` : severeContainerCves.size ? `${severeContainerCves.size} high-impact dependency CVE${severeContainerCves.size === 1 ? "" : "s"}` : !securityHasCoverage ? "Visibility unavailable" : securityCoverageIncomplete ? "Visibility limited" : "No immediate action"} valueClassName="metric-card-value-compact" description={isSonicRepository && sonicIndependentCritical.size ? "Review affected SONIC bundle packages" : isSonicRepository && sonicIndependentHigh.size ? "Review affected SONIC bundle packages" : isSonicRepository && sonicIndependentUnknown ? `${sonicIndependentUnknown} bundle package${sonicIndependentUnknown === 1 ? " has" : "s have"} limited coverage` : highImpactApplicationCves.size ? `${affectedApplicationVersions} app version${affectedApplicationVersions === 1 ? "" : "s"} affected` : directApplicationCves.size ? "Review upstream advisories" : severeContainerCves.size ? "Dependency CVEs detected" : !securityHasCoverage && security?.applicable ? "Visibility unavailable" : securityCoverageIncomplete ? "Visibility is incomplete" : security?.applicable ? "No high-impact CVEs known" : "No package evidence"} onDetails={() => setActiveTab("security")} attention={Boolean(directApplicationCritical || (isSonicRepository && sonicIndependentCritical.size))} warningHighlight={Boolean((!directApplicationCritical && directApplicationHigh) || (isSonicRepository && !sonicIndependentCritical.size && sonicIndependentHigh.size))} indicator={isSonicRepository && sonicIndependentCritical.size ? { type: "error", label: "Critical SONIC bundle CVE" } : isSonicRepository && sonicIndependentHigh.size ? { type: "warning", label: "High SONIC bundle CVE" } : directApplicationCritical ? { type: "error", label: "Critical upstream application CVE" } : directApplicationHigh ? { type: "warning", label: "High upstream application CVE" } : securityCoverageIncomplete ? { type: "pending", label: securityHasCoverage ? "Security visibility is incomplete" : "Security visibility is unavailable" } : undefined} /> : null}
        </Grid>

        <Tabs
          activeTabId={activeTab}
          onChange={({ detail }) => setActiveTab(detail.activeTabId)}
          tabs={[
            {
              label: "Overview",
              id: "overview",
              content: <SpaceBetween size="l"><Container header={<Header variant="h2">Repository status</Header>}><KeyValuePairs columns={3} items={[{ label: "Operational status", value: repositoryHealth(repository) }, { label: "Default branch", value: repository.defaultBranch }, { label: "Visibility", value: repository.visibility }, { label: "Primary language", value: repository.language ?? "Not detected" }, { label: "Last repository update", value: relativeTime(repository.updatedAt, overview.generatedAt) }, { label: "UDS Common", value: udsCommonStatusAction(repository.udsCommon, () => openDrawer({ type: "uds-common", repository: repository.fullName })) }, { label: "UDS Core version", value: repository.fullName === overview.udsCore.repository ? <UdsCoreVersion udsCore={overview.udsCore} /> : "Managed outside this repository" }]} /></Container>{isPackageRepository ? <RenovateHealthPanel health={workspace.renovateHealth} openUpdates={renovatePulls.length} mergedUpdates={workspace.pulls.closed.filter((pull) => pull.workflow.renovate && Boolean(pull.mergedAt)).length} /> : null}{repository.fullName === SONIC_REPOSITORY ? infrastructure ? <Container header={<Header variant="h2" description="Pinned versions, available updates, and explicit security coverage." actions={allSonicAvailablePackages.length > 1 ? <Button onClick={() => { setSonicUpdateOptions(allSonicAvailablePackages); setSonicUpdateSelection(allSonicAvailablePackages); setSonicUpdateError(null); setSonicUpdateResult(null); }}>Open PR for {allSonicAvailablePackages.length} updates</Button> : undefined}>SONIC bundle versions</Header>}><Table variant="embedded" trackBy="name" items={sonicBundlePackages} sortingColumn={{ sortingField: sonicPackageSortKey }} sortingDescending={sonicPackageSortDescending} onSortingChange={({ detail }) => { setSonicPackageSortKey(detail.sortingColumn.sortingField === "name" ? "name" : "status"); setSonicPackageSortDescending(detail.isDescending ?? false); }} filter={<SpaceBetween direction="horizontal" size="xs"><TextFilter filteringText={sonicPackageFilter} onChange={({ detail }) => setSonicPackageFilter(detail.filteringText)} filteringPlaceholder="Filter by package name" countText={`${sonicBundlePackages.length} packages`} /><Select selectedOption={{ label: sonicPackageStatusFilter === "all" ? "All statuses" : sonicPackageStatusFilter === "update-available" ? "Updates available" : sonicPackageStatusFilter === "unknown" ? "Unknown" : "Current", value: sonicPackageStatusFilter }} onChange={({ detail }) => setSonicPackageStatusFilter(detail.selectedOption.value ?? "all")} options={[{ label: "All statuses", value: "all" }, { label: "Updates available", value: "update-available" }, { label: "Unknown", value: "unknown" }, { label: "Current", value: "current" }]} /></SpaceBetween>} columnDefinitions={[{ id: "package", header: "Package", sortingField: "name", cell: (item) => <Link href={`https://github.com/${packageSourceRepository(item.name)}`} external>{item.name}</Link> }, { id: "deployed", header: "Deployed", cell: (item) => { const securityStatus = sonicPackageSecurityStatus(item, security, securityWorkspace, sonicIndependentSecurity); const severity = securityStatus === "critical" || securityStatus === "high" ? securityStatus : null; return item.version ? <Link href={`https://github.com/${packageSourceRepository(item.name)}/releases/tag/${encodeURIComponent(item.version)}`} external><span className={severity === "critical" ? "sonic-deployed-version sonic-deployed-version-critical" : severity === "high" ? "sonic-deployed-version sonic-deployed-version-high" : undefined} title={severity === "critical" ? "Critical vulnerability affects this deployed version" : severity === "high" ? "High vulnerability affects this deployed version" : undefined}>{item.version}</span></Link> : "Not pinned"; } }, { id: "latest", header: "Latest available", cell: (item) => item.latestReleaseUrl && item.latestVersion ? <Link href={item.latestReleaseUrl} external>{item.latestVersion}</Link> : item.latestVersion ?? "Unable to check" }, { id: "status", header: "Status", sortingField: "status", cell: (item) => item.updateStatus === "update-available" ? <StatusIndicator type="warning">Update available</StatusIndicator> : item.updateStatus === "current" ? <StatusIndicator type="success">Current</StatusIndicator> : <StatusIndicator type="info">Unknown</StatusIndicator> }, { id: "security", header: "Security", cell: (item) => { const status = sonicPackageSecurityStatus(item, security, securityWorkspace, sonicIndependentSecurity); const label = status === "critical" ? "Critical" : status === "high" ? "High" : status === "covered" ? "Checked" : status === "incomplete" ? "Coverage incomplete" : "Not evaluated"; const type = status === "critical" ? "error" : status === "high" ? "warning" : status === "covered" ? "success" : status === "incomplete" ? "pending" : "info"; return <StatusIndicator type={type}>{label}</StatusIndicator>; } }, { id: "registry", header: "Registry", cell: (item) => { const registryHref = item.updateStatus === "update-available" && item.latestRegistryUrl ? item.latestRegistryUrl : item.registryUrl; return registryHref ? <Link href={registryHref} external>{item.updateStatus === "update-available" ? "Open update" : "Open registry"}</Link> : "—"; } }]} empty={<EmptyState title="No registry packages found" detail="The current SONIC bundle does not expose pinned registry package references." />} /></Container> : <Container header={<Header variant="h2">SONIC bundle versions</Header>}><StatusIndicator type="in-progress">Loading bundle package versions…</StatusIndicator></Container> : null}{relatedResources}</SpaceBetween>,
            },
            { label: "Pull requests", id: "pull-requests", content: <RepositoryPullRequestTable items={workspace.pulls.open} title="Open pull requests" repository={repository.fullName} referenceTime={referenceTime} personalWorkState={personalWorkState} onAddToMyWork={onAddPullsToMyWork} openDrawer={openDrawer} /> },
            { label: "Renovate updates", id: "renovate", content: <RepositoryPullRequestTable items={renovatePulls} title="Renovate updates" repository={repository.fullName} referenceTime={referenceTime} personalWorkState={personalWorkState} onAddToMyWork={onAddPullsToMyWork} openDrawer={openDrawer} /> },
            {
              label: "Issues",
              id: "issues",
              content: <Table variant="container" trackBy="id" selectionType="multi" selectedItems={selectedCurrentIssues} onSelectionChange={({ detail }) => setSelectedIssues(detail.selectedItems.map((issue) => ({ ...issue, repository: repository.fullName })))} isItemDisabled={(issue) => issueReferences.has(`${repository.fullName.toLowerCase()}:${issue.id}`)} ariaLabels={{ selectionGroupLabel: "Select issues to add to My work today", itemSelectionLabel: ({ selectedItems }, issue) => issueReferences.has(`${repository.fullName.toLowerCase()}:${issue.id}`) ? `${issue.title} is already in My work today` : `${selectedItems.includes(issue) ? "Deselect" : "Select"} ${issue.title}` }} items={issues.map((issue) => ({ ...issue, repository: repository.fullName }))} header={<Header variant="h2" counter={`(${issues.length})`} actions={selectedCurrentIssues.length ? <PrimaryActionButton onClick={() => { const now = new Date().toISOString(); onAddReferencesToMyWork(selectedCurrentIssues.map((issue) => personalWorkReferenceForIssue(issue, now))); setSelectedIssues([]); }}>{`Add to My work (${selectedCurrentIssues.length})`}</PrimaryActionButton> : undefined}>Open issues</Header>} columnDefinitions={[{ id: "title", header: "Issue", cell: (item) => <SpaceBetween size="xxs"><Link href={item.url} onFollow={(event) => { event.preventDefault(); openDrawer({ type: "issue", issue: item, repository: repository.fullName }); }}>{item.title}</Link><Box color="text-body-secondary">#{item.number} by {item.author}{issueReferences.has(`${repository.fullName.toLowerCase()}:${item.id}`) ? " · in My work" : ""}</Box></SpaceBetween> }, { id: "updated", header: "Updated", cell: (item) => relativeTime(item.updatedAt, referenceTime) }]} empty={<EmptyState title="No open issues" detail="This repository has no issues requiring triage." />} />,
            },
            {
              label: "Pipelines",
              id: "pipelines",
              content: <Table variant="container" trackBy="id" selectionType="multi" selectedItems={selectedCurrentRuns} onSelectionChange={({ detail }) => setSelectedRuns(detail.selectedItems.map((run) => ({ ...run, repository: repository.fullName })))} isItemDisabled={(run) => runReferences.has(`${repository.fullName.toLowerCase()}:${run.id}`)} ariaLabels={{ selectionGroupLabel: "Select workflows to add to My work today", itemSelectionLabel: ({ selectedItems }, run) => runReferences.has(`${repository.fullName.toLowerCase()}:${run.id}`) ? `${run.title} is already in My work today` : `${selectedItems.includes(run) ? "Deselect" : "Select"} ${run.title}` }} items={runs.map((run) => ({ ...run, repository: repository.fullName }))} header={<Header variant="h2" counter={`(${runs.length})`} actions={selectedCurrentRuns.length ? <PrimaryActionButton onClick={() => { const now = new Date().toISOString(); onAddReferencesToMyWork(selectedCurrentRuns.map((run) => personalWorkReferenceForWorkflow(run, now))); setSelectedRuns([]); }}>{`Add to My work (${selectedCurrentRuns.length})`}</PrimaryActionButton> : undefined}>Recent pipelines</Header>} columnDefinitions={[{ id: "run", header: "Pipeline", cell: (item) => <SpaceBetween size="xxs"><Link href={item.url} onFollow={(event) => { event.preventDefault(); const failure = overview.workflowFailures.find((candidate) => candidate.id === item.id); openDrawer(failure ? { type: "workflow-failure", failure } : { type: "pipeline-run", run: item, repository: repository.fullName }); }}>{item.title}</Link><Box color="text-body-secondary">{item.name} #{item.number}{runReferences.has(`${repository.fullName.toLowerCase()}:${item.id}`) ? " · in My work" : ""}</Box></SpaceBetween> }, { id: "branch", header: "Branch", cell: (item) => item.branch ?? "Unknown" }, { id: "status", header: "Result", cell: runStatus }, { id: "started", header: "Started", cell: (item) => relativeTime(item.createdAt, referenceTime) }]} empty={<EmptyState title="No pipeline results" detail="GitHub Actions returned no recent runs for this repository." />} />,
            },
            ...(securityEligible ? [{ label: "Security", id: "security", content: <RepositorySecurityPanel key="security" security={security} repository={repository} overview={overview} personalWorkState={personalWorkState} onAddToMyWork={onAddReferencesToMyWork} openDrawer={openDrawer} /> }] : []),
            {
              label: "Infrastructure",
              id: "infrastructure",
              content: <SpaceBetween size="l"><Container header={<Header variant="h2" description="Repository configuration relevant to operations.">Infrastructure</Header>}><KeyValuePairs columns={3} items={[{ label: "Default branch", value: repository.defaultBranch }, { label: "Repository type", value: repository.fork ? "Fork" : "Source repository" }, { label: "Archived", value: repository.archived ? "Yes" : "No" }, { label: "Primary language", value: repository.language ?? "Not detected" }, { label: "Open work items", value: repository.openItems }, { label: "GitHub repository", value: <Link href={repository.url} external>{repository.fullName}</Link> }]} /></Container>{repository.fullName === SONIC_REPOSITORY ? <Container header={<Header variant="h2">Terraform knowledge base</Header>}><SpaceBetween size="m"><Box color="text-body-secondary">Explore the SWF infrastructure inventory, architecture, dependencies, reusable patterns, environments, and configuration inputs.</Box><PrimaryActionButton onClick={() => navigate("/infrastructure")}>Open Infrastructure Explorer</PrimaryActionButton></SpaceBetween></Container> : <Container><Box color="text-body-secondary">No Terraform root has been configured for analysis in this repository.</Box></Container>}</SpaceBetween>,
            },
          ]}
        />
      </SpaceBetween>
    </ContentLayout>
    <Modal size="large" visible={Boolean(modalUpdates.length)} onDismiss={() => { if (!sonicUpdateSubmitting) { setSonicUpdateOptions([]); setSonicUpdateSelection([]); } }} header={sonicUpdateResult ? "Update pull request opened" : modalUpdates.length > 1 ? "Open SONIC update pull request" : "Open SONIC update pull request"} footer={<SpaceBetween direction="horizontal" size="xs"><Button onClick={() => { setSonicUpdateOptions([]); setSonicUpdateSelection([]); }} disabled={sonicUpdateSubmitting}>{sonicUpdateResult ? "Close" : "Cancel"}</Button>{!sonicUpdateResult ? <PrimaryActionButton onClick={createSonicUpdate} loading={sonicUpdateSubmitting} disabled={!sonicUpdateSelection.length}>Create pull request</PrimaryActionButton> : null}</SpaceBetween>}>
      {sonicUpdateResult ? <SpaceBetween size="s"><Box>The pull request was created with the <Box variant="code" display="inline">scout</Box> label.</Box><Link href={sonicUpdateResult.url} external>{sonicUpdateResult.title}</Link></SpaceBetween> : modalUpdates.length ? <SpaceBetween size="s">{sonicUpdateError ? <Flashbar items={[{ type: "error", header: "The pull request was not created", content: sonicUpdateError }]} /> : null}<Box>Select the packages to include in one pull request. {sonicUpdateSelection.length} of {modalUpdates.length} selected.</Box><Table variant="embedded" selectionType="multi" trackBy="name" items={modalUpdates} selectedItems={sonicUpdateSelection} onSelectionChange={({ detail }) => setSonicUpdateSelection(detail.selectedItems)} columnDefinitions={[{ id: "package", header: "Package", cell: (item) => item.name }, { id: "change", header: "Change", cell: (item) => <Box variant="code">{item.version} → {item.latestVersion}</Box> }]} /><Box color="text-body-secondary">This creates one branch, exact bundle-file changes, and a pull request. Nothing is changed until you confirm.</Box></SpaceBetween> : null}
    </Modal>
    </>
  );
}
