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
import Pagination from "@cloudscape-design/components/pagination";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Spinner from "@cloudscape-design/components/spinner";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import Table from "@cloudscape-design/components/table";
import TextFilter from "@cloudscape-design/components/text-filter";
import TopNavigation from "@cloudscape-design/components/top-navigation";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { WORKSPACE_PRESETS } from "@/lib/repository-constants";
import type { SetupRepository, SetupRepositoryCatalog, SetupStatus, SetupViewer } from "./setup-types";

let cachedSetupStatus: SetupStatus | null = null;
const MAX_MANAGED_REPOSITORIES = 25;

const setupContinueStyle = {
  root: {
    background: { default: "var(--d2d-color-warning)", hover: "var(--d2d-color-warning-hover)", active: "var(--d2d-color-warning-active)" },
    borderColor: { default: "var(--d2d-color-warning)", hover: "var(--d2d-color-warning-hover)", active: "var(--d2d-color-warning-active)" },
    color: { default: "#0b0c0e", hover: "#0b0c0e", active: "#0b0c0e" },
  },
} as const;

function SetupLoading() {
  return <div className="setup-loading"><Spinner size="large" /></div>;
}

function SetupWizard({ status, settingsMode, replayMode = false, onComplete }: {
  status: SetupStatus;
  settingsMode: boolean;
  replayMode?: boolean;
  onComplete: (status: SetupStatus) => void;
}) {
  const router = useRouter();
  const startsAtRepositories = settingsMode && status.hasToken;
  const [step, setStep] = useState<"token" | "repositories">(startsAtRepositories ? "repositories" : "token");
  const [tokenReady, setTokenReady] = useState(status.hasToken);
  const [connectedViewer, setConnectedViewer] = useState<SetupViewer | null>(status.viewer);
  const [token, setToken] = useState("");
  const [repositories, setRepositories] = useState<SetupRepository[]>([]);
  const [selectedNames, setSelectedNames] = useState<Set<string>>(() => new Set((replayMode && status.repositorySource !== "environment" ? [] : status.repositories).map((repository) => repository.toLowerCase())));
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [repositoriesLoading, setRepositoriesLoading] = useState(startsAtRepositories);
  const [repositoriesLoaded, setRepositoriesLoaded] = useState(false);
  const [quickSelectUndo, setQuickSelectUndo] = useState<{ label: string; added: number; selection: Set<string> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const repositoriesLocked = status.repositorySource === "environment";

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
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "GitHub could not be connected.");
    } finally {
      setLoading(false);
    }
  };

  const save = async () => {
    if (!selectedNames.size) return;
    setLoading(true);
    setError(null);
    try {
      const selected = repositories
        .filter((repository) => selectedNames.has(repository.fullName.toLowerCase()))
        .map((repository) => repository.fullName);
      const response = await fetch("/api/setup/repositories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repositories: selected }),
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
      };
      cachedSetupStatus = nextStatus;
      onComplete(nextStatus);
      router.replace("/");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Managed repositories could not be saved.");
    } finally {
      setLoading(false);
    }
  };

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
    const preset = WORKSPACE_PRESETS.find((candidate) => candidate.id === presetId);
    if (!preset) return;
    const availableNames = new Set(repositories.map((repository) => repository.fullName.toLowerCase()));
    const next = new Set(selectedNames);
    preset.repositories.forEach((repository) => {
      if (next.size < MAX_MANAGED_REPOSITORIES && availableNames.has(repository.toLowerCase())) {
        next.add(repository.toLowerCase());
      }
    });
    const added = next.size - selectedNames.size;
    if (!added) return;
    setQuickSelectUndo({ label: preset.label, added, selection: new Set(selectedNames) });
    setSelectedNames(next);
  };

  const quickSelect = (
    <ButtonDropdown
      items={WORKSPACE_PRESETS.map((preset) => ({
        id: preset.id,
        text: preset.label,
        secondaryText: `Add ${preset.repositories.length} repositories`,
        disabled: preset.repositories.every((repository) => selectedNames.has(repository.toLowerCase())),
      }))}
      disabled={repositoriesLoading || repositoriesLocked}
      onItemClick={({ detail }) => applyWorkspacePreset(detail.id)}
    >
      Quick select
    </ButtonDropdown>
  );

  return (
    <>
      <div id="setup-top-navigation">
        <TopNavigation
          identity={{ href: "/", title: "D2D Operations", logo: { src: "/doug-lg.svg", alt: "Doug" }, onFollow: (event) => { event.preventDefault(); router.push("/"); } }}
          utilities={settingsMode || replayMode ? [{ type: "button", text: "Back to operations", iconName: "arrow-left", onClick: () => router.push("/") }] : []}
          i18nStrings={{ overflowMenuTriggerText: "More", overflowMenuTitleText: "All", overflowMenuDismissIconAriaLabel: "Close menu" }}
        />
      </div>
      <main className="setup-shell">
        <SpaceBetween size="l">
          <SpaceBetween size="xs">
            <Box variant="awsui-key-label">{settingsMode ? "WORKSPACE CONFIGURATION" : "INITIAL SETUP"}</Box>
            <Header variant="h1" description={settingsMode ? "Update repositories managed in this workspace." : "Connect GitHub and choose repositories to manage."} actions={settingsMode ? <Button onClick={() => router.push("/setup")}>Run setup again</Button> : undefined}>
              {settingsMode ? "Workspace settings" : "Set up your workspace"}
            </Header>
          </SpaceBetween>

          {error ? <Flashbar items={[{ type: "error", header: "Setup could not continue", content: error, dismissible: true, onDismiss: () => setError(null) }]} /> : null}
          {repositoriesLoading ? <div className="setup-repository-loading-banner"><Flashbar items={[{ type: "info", header: "Fetching repository data", content: "Please wait while we load repositories available to your GitHub account." }]} /></div> : null}
          {quickSelectUndo ? <Flashbar items={[{ type: "success", header: `${quickSelectUndo.label} quick select applied`, content: `${quickSelectUndo.added} ${quickSelectUndo.added === 1 ? "repository was" : "repositories were"} added. Existing selections were kept.`, action: <div className="flashbar-centered-action"><Button onClick={() => { setSelectedNames(new Set(quickSelectUndo.selection)); setQuickSelectUndo(null); }}>Undo</Button></div>, dismissible: true, onDismiss: () => setQuickSelectUndo(null) }]} /> : null}

          {step === "token" ? (
            <Container header={<Header variant="h2" description="Step 1 of 2">Connect GitHub</Header>}>
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
                  ) : (
                    <StatusIndicator type="success">GitHub token found</StatusIndicator>
                  )}
                  {!connectedViewer ? <Box color="text-body-secondary">{status.tokenSource === "environment" ? <><Box variant="code" display="inline">GITHUB_TOKEN</Box> was found in the server environment. The token remains server-only.</> : "A GitHub token is available for this session."}</Box> : null}
                  <Button variant="primary" style={setupContinueStyle} onClick={continueToRepositories}>Choose repositories</Button>
                </SpaceBetween>
              ) : (
                <SpaceBetween size="l">
                  <Box color="text-body-secondary">Enter a GitHub personal access token with read access. The token remains in server memory for this session.</Box>
                  <FormField label="GitHub token" description={<>You can also set <Box variant="code" display="inline">GITHUB_TOKEN</Box> before starting the app.</>}>
                    <Input value={token} type="password" autoComplete="off" placeholder="github_pat_…" onChange={({ detail }) => setToken(detail.value)} onKeyDown={({ detail }) => { if (detail.key === "Enter") void connect(); }} />
                  </FormField>
                  <SpaceBetween direction="horizontal" size="s">
                    <Button variant="primary" style={setupContinueStyle} loading={loading} disabled={!token.trim()} onClick={connect}>Connect GitHub</Button>
                    <Button href="https://github.com/settings/personal-access-tokens" external>Open GitHub token settings</Button>
                  </SpaceBetween>
                </SpaceBetween>
              )}
            </Container>
          ) : settingsMode ? (
            <SpaceBetween size="l">
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
                    description="Repositories currently included in operational monitoring."
                    actions={<SpaceBetween direction="horizontal" size="s">{quickSelect}<Button onClick={() => router.push("/")}>Cancel</Button><Button variant="primary" style={setupContinueStyle} loading={loading} disabled={!selectedNames.size || repositoriesLoading} onClick={save}>Save changes</Button></SpaceBetween>}
                  >
                    Managed repositories
                  </Header>
                }
                columnDefinitions={[
                  { id: "repository", header: "Repository", cell: (repository) => <SpaceBetween size="xxs"><Box variant="strong">{repository.name}</Box><Box color="text-body-secondary">{repository.owner}</Box></SpaceBetween> },
                  { id: "visibility", header: "Visibility", cell: (repository) => <Badge color="grey">{repository.private ? "private" : "public"}</Badge> },
                  { id: "description", header: "Description", cell: (repository) => repository.description ?? <Box color="text-body-secondary">No description</Box> },
                  { id: "remove", header: "", cell: (repository) => <Button variant="inline-link" disabled={repositoriesLocked} onClick={() => removeSelectedRepository(repository)}>Remove</Button> },
                ]}
                empty={<Box textAlign="center" padding={{ vertical: "xxl" }}><SpaceBetween size="s"><Box variant="strong">No managed repositories</Box><Box color="text-body-secondary">Add at least one repository from the available list.</Box></SpaceBetween></Box>}
              />

              <Table
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
                header={<Header variant="h2" counter={`(${filteredRepositories.length})`} description={repositoriesLocked ? "Repository selection is controlled by GITHUB_REPOSITORIES." : `Select repositories to add. ${selectedNames.size} of ${MAX_MANAGED_REPOSITORIES} management slots are in use.`}>Available repositories</Header>}
                columnDefinitions={[
                  { id: "repository", header: "Repository", cell: (repository) => <SpaceBetween size="xxs"><Box variant="strong">{repository.name}</Box><Box color="text-body-secondary">{repository.owner}</Box></SpaceBetween> },
                  { id: "visibility", header: "Visibility", cell: (repository) => <Badge color="grey">{repository.private ? "private" : "public"}</Badge> },
                  { id: "description", header: "Description", cell: (repository) => repository.description ?? <Box color="text-body-secondary">No description</Box> },
                  { id: "updated", header: "Updated", cell: (repository) => repository.updatedAt.slice(0, 10) },
                ]}
                empty={<Box textAlign="center" padding={{ vertical: "xxl" }}><SpaceBetween size="s"><Box variant="strong">No available repositories found</Box><Box color="text-body-secondary">Adjust the filter or remove a repository from the managed list.</Box></SpaceBetween></Box>}
              />
            </SpaceBetween>
          ) : (
            <Table
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
              filter={<TextFilter filteringText={filter} onChange={({ detail }) => { setFilter(detail.filteringText); setPage(1); }} filteringPlaceholder="Find repositories" countText={`${filteredRepositories.length} matches`} />}
              pagination={<Pagination currentPageIndex={currentPage} pagesCount={pagesCount} onChange={({ detail }) => setPage(detail.currentPageIndex)} ariaLabels={{ nextPageLabel: "Next page", previousPageLabel: "Previous page", pageLabel: (pageNumber) => `Page ${pageNumber} of all pages` }} />}
              header={
                <Header
                  variant="h2"
                  counter={selectionCounter}
                  description={repositoriesLocked ? "Step 2 of 2 · Managed repositories are controlled by GITHUB_REPOSITORIES." : `Step 2 of 2 · Choose up to ${MAX_MANAGED_REPOSITORIES} repositories for pull requests, issues, pipelines, and repository health.`}
                  actions={<SpaceBetween direction="horizontal" size="s">{quickSelect}{settingsMode ? <Button onClick={() => router.push("/")}>Cancel</Button> : <Button onClick={() => { setQuickSelectUndo(null); setStep("token"); }}>Back</Button>}<Button variant="primary" style={setupContinueStyle} loading={loading} disabled={!selectedNames.size || repositoriesLoading} onClick={save}>Save and continue</Button></SpaceBetween>}
                >
                  Choose managed repositories
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
          )}

          <Container>
            <SpaceBetween direction="horizontal" size="s">
              <StatusIndicator type="success">Local workspace</StatusIndicator>
              <Box color="text-body-secondary">Repository selections stay on this machine. GitHub access remains read-only.</Box>
              <Link href="https://docs.github.com/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens" external>Token guidance</Link>
            </SpaceBetween>
          </Container>
        </SpaceBetween>
      </main>
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

  const settingsMode = pathname === "/settings";
  const replayMode = pathname === "/setup";
  if (status.configured && !settingsMode && !replayMode) return children;
  return <SetupWizard status={status} settingsMode={settingsMode} replayMode={replayMode} onComplete={setStatus} />;
}
