"use client";

/* eslint-disable react-hooks/set-state-in-effect -- Selection and remote session state are synchronized with server APIs. */

import Badge from "@cloudscape-design/components/badge";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Container from "@cloudscape-design/components/container";
import ContentLayout from "@cloudscape-design/components/content-layout";
import Flashbar from "@cloudscape-design/components/flashbar";
import FormField from "@cloudscape-design/components/form-field";
import Grid from "@cloudscape-design/components/grid";
import Header from "@cloudscape-design/components/header";
import KeyValuePairs from "@cloudscape-design/components/key-value-pairs";
import Modal from "@cloudscape-design/components/modal";
import Pagination from "@cloudscape-design/components/pagination";
import Select from "@cloudscape-design/components/select";
import SegmentedControl from "@cloudscape-design/components/segmented-control";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Spinner from "@cloudscape-design/components/spinner";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import Table from "@cloudscape-design/components/table";
import TextFilter from "@cloudscape-design/components/text-filter";
import { useEffect, useState } from "react";
import type { TestLabActionResult, TestLabBranch, TestLabCatalog, TestLabImageInventory, TestLabPlan, TestLabSession, TestLabWorkflowMode } from "./test-lab-types";
import { ZeusHealthCard } from "./ZeusHealthCard";

const IMAGE_PAGE_SIZE = 10;

type TestLabLaunchRequest = {
  repository: string;
  branch: string;
  workflow: TestLabWorkflowMode;
  confirm: boolean;
  pullRequest: string | null;
};

const EMPTY_SESSION: TestLabSession = {
  state: "idle",
  repository: null,
  branch: null,
  sha: null,
  bundleName: null,
  bundleVersion: null,
  bundleArtifact: null,
  flavor: null,
  workflow: null,
  phase: null,
  startedAt: null,
  updatedAt: null,
  clusterReachable: false,
  context: null,
  stdout: "",
  stderr: "",
  workloads: "",
};

function sessionStatus(session: TestLabSession) {
  if (session.state === "deploying") {
    const phaseLabel = session.phase === "building" ? "Building development package"
      : session.phase === "deploying" ? "Creating and deploying bundle"
        : session.phase === "testing" ? "Running repository tests"
          : session.phase === "building-and-deploying" ? "Building and deploying"
            : "Starting workflow";
    return <StatusIndicator type="in-progress">{phaseLabel}</StatusIndicator>;
  }
  if (session.state === "cleaning") return <StatusIndicator type="in-progress">Removing deployment</StatusIndicator>;
  if (session.state === "deployed") return <StatusIndicator type="success">{session.workflow === "build-deploy-test" ? "Tests passed · Deployed" : "Deployed"}</StatusIndicator>;
  if (session.state === "failed") return <StatusIndicator type="error">Action failed</StatusIndicator>;
  if (session.state === "prepared") return <StatusIndicator type="pending">Workspace prepared</StatusIndicator>;
  if (session.state === "complete") return <StatusIndicator type="success">Cleanup complete</StatusIndicator>;
  return <StatusIndicator type="pending">Ready for a test</StatusIndicator>;
}

function sessionIsActive(state: TestLabSession["state"], bundleArtifact: string | null) {
  return ["prepared", "deploying", "deployed", "cleaning"].includes(state) || (state === "failed" && Boolean(bundleArtifact));
}

function shortSha(sha: string | null) {
  return sha ? sha.slice(0, 8) : "—";
}

function githubPath(value: string) {
  return value.split("/").map(encodeURIComponent).join("/");
}

function githubRepositoryUrl(repository: string) {
  return `https://github.com/${githubPath(repository)}`;
}

function githubBranchUrl(repository: string, branch: string) {
  return `${githubRepositoryUrl(repository)}/tree/${githubPath(branch)}`;
}

export function TestLab() {
  const [catalog, setCatalog] = useState<TestLabCatalog | null>(null);
  const [repository, setRepository] = useState("");
  const [branches, setBranches] = useState<TestLabBranch[]>([]);
  const [branch, setBranch] = useState("");
  const [plan, setPlan] = useState<TestLabPlan | null>(null);
  const [flavor, setFlavor] = useState("");
  const [workflow, setWorkflow] = useState<TestLabWorkflowMode>("build-deploy-test");
  const [launchRequest, setLaunchRequest] = useState<TestLabLaunchRequest | null>(null);
  const [launchHandled, setLaunchHandled] = useState(false);
  const [session, setSession] = useState<TestLabSession>(EMPTY_SESSION);
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [loadingPlan, setLoadingPlan] = useState(false);
  const [runningAction, setRunningAction] = useState<"run-test" | "cleanup" | "reset" | null>(null);
  const [startOpen, setStartOpen] = useState(false);
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const [imagesOpen, setImagesOpen] = useState(false);
  const [imageInventory, setImageInventory] = useState<TestLabImageInventory | null>(null);
  const [imageLoading, setImageLoading] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [imageFilter, setImageFilter] = useState("");
  const [imagePage, setImagePage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [launchWarning, setLaunchWarning] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [healthRefreshKey, setHealthRefreshKey] = useState(0);

  async function refreshSession() {
    const response = await fetch("/api/test-lab?status=true", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "The Test Lab session could not be loaded.");
    setSession(data as TestLabSession);
  }

  useEffect(() => {
    const controller = new AbortController();
    const parameters = new URLSearchParams(window.location.search);
    const requestedRepository = parameters.get("repository");
    const requestedBranch = parameters.get("branch");
    const requestedWorkflow = parameters.get("workflow");
    const requestedLaunch: TestLabLaunchRequest | null = requestedRepository && requestedBranch && (requestedWorkflow === "deploy-only" || requestedWorkflow === "build-deploy-test") ? {
      repository: requestedRepository,
      branch: requestedBranch,
      workflow: requestedWorkflow,
      confirm: parameters.get("confirm") === "true",
      pullRequest: parameters.get("pullRequest"),
    } : null;
    if (requestedLaunch) window.history.replaceState(window.history.state, "", window.location.pathname);
    Promise.all([
      fetch("/api/test-lab", { signal: controller.signal, cache: "no-store" }).then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Test Lab configuration could not be loaded.");
        return data as TestLabCatalog;
      }),
      fetch("/api/test-lab?status=true", { signal: controller.signal, cache: "no-store" }).then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Test Lab status could not be loaded.");
        return data as TestLabSession;
      }),
    ])
      .then(([nextCatalog, nextSession]) => {
        setCatalog(nextCatalog);
        setSession(nextSession);
        const sessionRepository = nextSession.repository && nextCatalog.repositories.some((item) => item.fullName === nextSession.repository) ? nextSession.repository : null;
        const remoteSessionActive = sessionIsActive(nextSession.state, nextSession.bundleArtifact);
        const launchRepositoryAvailable = Boolean(requestedLaunch && nextCatalog.repositories.some((item) => item.fullName.toLowerCase() === requestedLaunch.repository.toLowerCase()));
        const launchMatchesActiveSession = Boolean(requestedLaunch && remoteSessionActive && nextSession.repository?.toLowerCase() === requestedLaunch.repository.toLowerCase() && nextSession.branch === requestedLaunch.branch);
        if (requestedLaunch && !launchRepositoryAvailable) {
          setLaunchWarning(`${requestedLaunch.repository} is not configured for Test Lab.`);
        }
        if (requestedLaunch && launchRepositoryAvailable && remoteSessionActive && !launchMatchesActiveSession) {
          setLaunchWarning(`Remove the active ${nextSession.repository ?? "Test Lab"} deployment before preparing pull request #${requestedLaunch.pullRequest ?? ""}.`);
        }
        if (requestedLaunch && launchRepositoryAvailable && !remoteSessionActive) {
          setLaunchRequest(requestedLaunch);
          setRepository(requestedLaunch.repository);
          setWorkflow(requestedLaunch.workflow);
          setMessage(`Pull request #${requestedLaunch.pullRequest ?? ""} is ready for Test Lab validation.`);
        } else {
          setRepository(sessionRepository ?? nextCatalog.repositories[0]?.fullName ?? "");
          if (nextSession.workflow === "deploy-only" || nextSession.workflow === "build-deploy-test") setWorkflow(nextSession.workflow);
        }
      })
      .catch((reason) => {
        if (reason.name !== "AbortError") setError(reason.message);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const interval = sessionIsActive(session.state, session.bundleArtifact) ? 4_000 : 30_000;
    let timer: number | null = null;
    let requestInFlight = false;
    const poll = async () => {
      if (requestInFlight || document.visibilityState !== "visible") return;
      requestInFlight = true;
      try {
        await refreshSession();
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Test Lab status could not be refreshed.");
      } finally {
        requestInFlight = false;
      }
    };
    const startTimer = () => {
      if (timer !== null) window.clearInterval(timer);
      timer = document.visibilityState === "visible" ? window.setInterval(poll, interval) : null;
    };
    const handleVisibilityChange = () => {
      startTimer();
      if (document.visibilityState === "visible") void poll();
    };
    startTimer();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      if (timer !== null) window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [session.bundleArtifact, session.state]);

  useEffect(() => {
    const remoteSessionActive = sessionIsActive(session.state, session.bundleArtifact);
    if (!remoteSessionActive || !session.repository || !catalog?.repositories.some((item) => item.fullName === session.repository)) return;
    if (repository !== session.repository) setRepository(session.repository);
    if (session.flavor && flavor !== session.flavor) setFlavor(session.flavor);
    if (session.workflow === "deploy-only" || session.workflow === "build-deploy-test") setWorkflow(session.workflow);
  }, [catalog, flavor, repository, session.bundleArtifact, session.flavor, session.repository, session.state, session.workflow]);

  useEffect(() => {
    if (!repository) return;
    const controller = new AbortController();
    setLoadingBranches(true);
    setBranches([]);
    setBranch("");
    setFlavor("");
    setPlan(null);
    fetch(`/api/test-lab?repository=${encodeURIComponent(repository)}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Branches could not be loaded.");
        return data as { branches: TestLabBranch[] };
      })
      .then((data) => {
        setBranches(data.branches);
        const launchTargetsRepository = launchRequest?.repository.toLowerCase() === repository.toLowerCase();
        const requestedBranch = launchTargetsRepository ? data.branches.find((candidate) => candidate.name === launchRequest?.branch)?.name ?? null : null;
        if (launchTargetsRepository && !requestedBranch) {
          setBranch("");
          setLaunchWarning(`The pull request source branch ${launchRequest?.branch} is not available in ${repository}.`);
          return;
        }
        const sessionBranch = session.repository === repository && session.branch && data.branches.some((candidate) => candidate.name === session.branch) ? session.branch : null;
        setBranch(requestedBranch ?? sessionBranch ?? data.branches.find((candidate) => candidate.name === "main")?.name ?? data.branches[0]?.name ?? "");
      })
      .catch((reason) => {
        if (reason.name !== "AbortError") setError(reason.message);
      })
      .finally(() => setLoadingBranches(false));
    return () => controller.abort();
  }, [launchRequest, repository, session.branch, session.repository]);

  useEffect(() => {
    if (!imagesOpen) return;
    let active = true;
    let requestInFlight = false;
    let timer: number | null = null;
    const loadImages = async (showLoading: boolean) => {
      if (requestInFlight || document.visibilityState !== "visible") return;
      requestInFlight = true;
      if (showLoading) setImageLoading(true);
      try {
        const response = await fetch("/api/test-lab?images=true", { cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Container images could not be loaded.");
        if (active) {
          setImageInventory(data as TestLabImageInventory);
          setImageError(null);
        }
      } catch (reason) {
        if (active) setImageError(reason instanceof Error ? reason.message : "Container images could not be loaded.");
      } finally {
        requestInFlight = false;
        if (active && showLoading) setImageLoading(false);
      }
    };
    const startTimer = () => {
      if (timer !== null) window.clearInterval(timer);
      timer = document.visibilityState === "visible" ? window.setInterval(() => void loadImages(false), 4_000) : null;
    };
    const handleVisibilityChange = () => {
      startTimer();
      if (document.visibilityState === "visible") void loadImages(false);
    };
    void loadImages(true);
    startTimer();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      active = false;
      if (timer !== null) window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [imagesOpen]);

  useEffect(() => {
    if (!repository || !branch) return;
    const controller = new AbortController();
    setLoadingPlan(true);
    setPlan(null);
    setFlavor("");
    fetch(`/api/test-lab?repository=${encodeURIComponent(repository)}&branch=${encodeURIComponent(branch)}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "The deployment plan could not be loaded.");
        return data as TestLabPlan;
      })
      .then((nextPlan) => {
        setPlan(nextPlan);
        const sessionFlavor = session.repository === repository && session.branch === branch && session.flavor && nextPlan.flavors.includes(session.flavor) ? session.flavor : "";
        setFlavor(sessionFlavor);
      })
      .catch((reason) => {
        if (reason.name !== "AbortError") setError(reason.message);
      })
      .finally(() => setLoadingPlan(false));
    return () => controller.abort();
  }, [repository, branch, session.branch, session.flavor, session.repository]);

  useEffect(() => {
    if (!launchRequest?.confirm || launchHandled || !plan || plan.repository.toLowerCase() !== launchRequest.repository.toLowerCase() || plan.branch !== launchRequest.branch) return;
    const remoteSessionActive = sessionIsActive(session.state, session.bundleArtifact);
    if (plan.flavors.length && !plan.flavors.includes(flavor)) return;
    if (remoteSessionActive) {
      setLaunchWarning(`Remove the active ${session.repository ?? "Test Lab"} deployment before starting this pull request test.`);
    } else if (!session.clusterReachable) {
      setLaunchWarning("The existing cluster is unavailable, so this pull request cannot be prepared for testing.");
    } else if (!plan.workflow.safe) {
      setLaunchWarning(plan.workflow.blockers.join(" "));
    } else {
      setWorkflow("build-deploy-test");
      setStartOpen(true);
    }
    setLaunchHandled(true);
  }, [flavor, launchHandled, launchRequest, plan, session.bundleArtifact, session.clusterReachable, session.repository, session.state]);

  async function runAction(action: "run-test" | "cleanup" | "reset") {
    setRunningAction(action);
    setError(null);
    setLaunchWarning(null);
    setMessage(null);
    try {
      const response = await fetch("/api/test-lab", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, repository, branch, flavor: flavor || null, workflow }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "The Test Lab action failed.");
      const result = data as TestLabActionResult;
      setSession(result.session);
      setMessage(result.message);
      setStartOpen(false);
      setCleanupOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The Test Lab action failed.");
      await refreshSession().catch(() => undefined);
    } finally {
      setRunningAction(null);
    }
  }

  if (!catalog) {
    return <ContentLayout header={<Header variant="h1">Test Lab</Header>}><Box textAlign="center" padding={{ vertical: "xxxl" }}><Spinner size="large" /></Box></ContentLayout>;
  }

  const repositoryOptions = catalog.repositories.map((item) => ({ label: item.fullName, value: item.fullName }));
  const branchOptions = branches.map((item) => ({ label: item.name, value: item.name, description: item.sha.slice(0, 8) }));
  const repositoryOption = repositoryOptions.find((option) => option.value === repository) ?? null;
  const branchOption = branchOptions.find((option) => option.value === branch) ?? null;
  const flavorOptions = (plan?.flavors ?? []).map((item) => ({ label: item, value: item }));
  const flavorOption = flavorOptions.find((option) => option.value === flavor) ?? null;
  const sessionActive = sessionIsActive(session.state, session.bundleArtifact);
  const selectedWorkflow = plan ? (workflow === "deploy-only" ? plan.deployOnly : plan.workflow) : null;
  const launchMatchesSelection = Boolean(launchRequest && launchRequest.repository.toLowerCase() === repository.toLowerCase() && launchRequest.branch === branch);
  const flavorReady = Boolean(plan && (!plan.flavors.length || plan.flavors.includes(flavor)));
  const canRun = Boolean(selectedWorkflow?.safe && flavorReady && session.clusterReachable && !sessionActive && !runningAction);
  const canCleanup = Boolean((session.state === "deployed" || session.state === "failed") && session.bundleArtifact && !runningAction);
  const canReset = Boolean((session.state === "complete" || session.state === "prepared" || (session.state === "failed" && !session.bundleArtifact)) && !runningAction);
  const canViewImages = Boolean(session.repository && ["deploying", "deployed", "failed", "cleaning"].includes(session.state));
  const imageQuery = imageFilter.trim().toLowerCase();
  const filteredImages = (imageInventory?.items ?? []).filter((item) => !imageQuery || [item.package, item.namespace, item.pod, item.container, item.image, item.digest ?? ""].some((value) => value.toLowerCase().includes(imageQuery)));
  const imagePageCount = Math.max(1, Math.ceil(filteredImages.length / IMAGE_PAGE_SIZE));
  const currentImagePage = Math.min(imagePage, imagePageCount);
  const imageRows = filteredImages.slice((currentImagePage - 1) * IMAGE_PAGE_SIZE, currentImagePage * IMAGE_PAGE_SIZE).map((item) => ({ ...item, id: `${item.namespace}/${item.pod}/${item.containerType}/${item.container}` }));
  const commandOutput = [session.stdout, session.state === "failed" ? "" : session.stderr].filter(Boolean).join("\n");

  return (
    <ContentLayout
      header={<div className="test-lab-page-header"><Header variant="h1" description="Deploy a selected repository branch to the existing cluster on zeus, optionally run its tests, and remove it when finished.">Test Lab</Header><Button iconName="refresh" variant="icon" ariaLabel="Refresh Test Lab status" onClick={() => { setHealthRefreshKey((value) => value + 1); refreshSession().catch((reason) => setError(reason.message)); }} /></div>}
    >
      <SpaceBetween size="l">
        {error ? <Flashbar items={[{ type: "error", header: "Test Lab action failed", content: error, dismissible: true, onDismiss: () => setError(null) }]} /> : null}
        {launchWarning ? <Flashbar items={[{ type: "warning", header: "Pull request test is not ready", content: launchWarning, dismissible: true, onDismiss: () => setLaunchWarning(null) }]} /> : null}
        {message ? <Flashbar items={[{ type: "success", content: message, dismissible: true, onDismiss: () => setMessage(null) }]} /> : null}

        <Grid gridDefinition={[
          { colspan: { default: 12, xs: 6, l: 4 } },
          { colspan: { default: 12, xs: 6, l: 4 } },
          { colspan: { default: 12, xs: 6, l: 4 } },
        ]}>
          <Container className="metric-card"><SpaceBetween size="s"><Box variant="awsui-key-label">Remote host</Box><Box variant="awsui-value-large">{catalog.target.hostname}</Box><StatusIndicator type="success">SSH connected</StatusIndicator><Box color="text-body-secondary">{catalog.target.address}</Box></SpaceBetween></Container>
          <Container className="metric-card"><SpaceBetween size="s"><Box variant="awsui-key-label">Existing cluster</Box><Box variant="awsui-value-large">{session.context ?? "No context"}</Box>{session.clusterReachable ? <StatusIndicator type="success">API reachable</StatusIndicator> : <StatusIndicator type="error">API unavailable</StatusIndicator>}<Box color="text-body-secondary">Test Lab cannot create or replace a cluster.</Box></SpaceBetween></Container>
          <Container className="metric-card"><SpaceBetween size="s"><Box variant="awsui-key-label">Deployment session</Box><Box variant="awsui-value-large">{session.bundleName ?? "No active test"}</Box>{sessionStatus(session)}<Box color="text-body-secondary">{session.repository ? `${session.repository}@${session.branch}${session.flavor ? ` · ${session.flavor}` : ""}` : "Select a repository and branch below."}</Box></SpaceBetween></Container>
        </Grid>

        <ZeusHealthCard refreshKey={healthRefreshKey} />

        {!session.clusterReachable ? <Flashbar items={[{ type: "error", header: "The existing cluster is unavailable", content: `The ${session.context ?? "configured"} context on zeus is not reachable. Deploy is blocked; Test Lab will never create a K3d cluster.` }]} /> : null}

        <Container header={<Header variant="h2" description={sessionActive ? "The repository, branch, flavor, and workflow are locked to the active session until its deployment is removed." : "The workflow is fixed and validated from the selected branch; no command or task name can be entered."} actions={repository ? <SpaceBetween direction="horizontal" size="xs"><Button href={githubRepositoryUrl(repository)} external>Open repository</Button>{branch ? <Button href={githubBranchUrl(repository, branch)} external>Open branch</Button> : null}</SpaceBetween> : undefined}>{sessionActive ? "Active test" : "Configure test"}</Header>}>
          <SpaceBetween size="l">
            <SpaceBetween size="xs">
              <Box variant="awsui-key-label">Workflow</Box>
              <SegmentedControl
                selectedId={workflow}
                onChange={({ detail }) => setWorkflow(detail.selectedId as TestLabWorkflowMode)}
                options={[
                  { id: "deploy-only", text: "Deploy only" },
                  { id: "build-deploy-test", text: "Deploy and test" },
                ]}
                label="Test Lab workflow"
              />
              <Box color="text-body-secondary">{workflow === "deploy-only" ? "Build and deploy the branch for manual inspection. Repository tests will not run." : "Build and deploy the branch, then run its repository-defined health and UI tests."}</Box>
            </SpaceBetween>
            <div className="test-lab-selectors">
              <FormField label="Repository">
                <Select selectedOption={repositoryOption} onChange={({ detail }) => setRepository(detail.selectedOption.value ?? "")} options={repositoryOptions} placeholder="Choose a repository" disabled={sessionActive} />
              </FormField>
              <FormField label="Branch">
                <Select selectedOption={branchOption} onChange={({ detail }) => setBranch(detail.selectedOption.value ?? "")} options={branchOptions} placeholder="Choose a branch" loadingText="Loading branches" statusType={loadingBranches ? "loading" : "finished"} disabled={sessionActive || loadingBranches} filteringType="auto" />
              </FormField>
              {plan?.flavors.length ? (
                <FormField label="Package flavor">
                  <Select selectedOption={flavorOption} onChange={({ detail }) => setFlavor(detail.selectedOption.value ?? "")} options={flavorOptions} placeholder="Choose a flavor" disabled={sessionActive} />
                </FormField>
              ) : null}
            </div>

            {loadingPlan ? <Box textAlign="center" padding="l"><Spinner /></Box> : plan ? (
              <Grid gridDefinition={[{ colspan: { default: 12, m: 7 } }, { colspan: { default: 12, m: 5 } }]}>
                <Container header={<Header variant="h3">Selected workflow</Header>}>
                  <SpaceBetween size="m">
                    {!selectedWorkflow?.safe
                      ? <StatusIndicator type="error">Workflow blocked</StatusIndicator>
                      : flavorReady
                        ? <StatusIndicator type="success">Validated for the existing cluster</StatusIndicator>
                        : <StatusIndicator type="pending">Choose a package flavor</StatusIndicator>}
                    {selectedWorkflow?.steps.map((step, index) => (
                      <div className="test-lab-workflow-step" key={step.task}>
                        <SpaceBetween size="xs">
                          <Box variant="h4">{index + 1}. {step.title}</Box>
                          <Box variant="code">uds run {step.task}{plan.flavors.length ? ` --set flavor=${flavor || "<choose a flavor>"}` : ""}</Box>
                          <Box color="text-body-secondary">{step.description}</Box>
                          <SpaceBetween direction="horizontal" size="xs">{step.actions.map((action) => <Badge key={action}>{action}</Badge>)}</SpaceBetween>
                        </SpaceBetween>
                      </div>
                    ))}
                    {selectedWorkflow?.tests.length ? <Box><Box variant="strong">Repository tests: </Box>{selectedWorkflow.tests.join(", ")}</Box> : <Box color="text-body-secondary">Repository tests will not run in deploy-only mode.</Box>}
                    <StatusIndicator type="info">After the workflow completes, the selected flavor remains deployed for inspection until you remove it.</StatusIndicator>
                    {selectedWorkflow?.blockers.map((blocker) => <StatusIndicator key={blocker} type="error">{blocker}</StatusIndicator>)}
                  </SpaceBetween>
                </Container>
                <Container header={<Header variant="h3">Bundle</Header>}>
                  <KeyValuePairs items={[
                    { label: "Name", value: plan.bundle.name },
                    { label: "Version", value: plan.bundle.version },
                    { label: "Definition", value: <Box variant="code">{plan.bundle.path}</Box> },
                    { label: "Package flavor", value: plan.flavors.length ? flavor || "Choose a flavor" : "Not flavored" },
                    { label: "Branch snapshot", value: shortSha(plan.sha) },
                  ]} />
                </Container>
              </Grid>
            ) : <Box color="text-body-secondary">Choose a repository and branch to validate its build, deployment, and test workflow.</Box>}

            <SpaceBetween direction="horizontal" size="xs">
              <span className="test-lab-primary-action"><Button variant="primary" onClick={() => setStartOpen(true)} loading={runningAction === "run-test"} disabled={!canRun}>{workflow === "deploy-only" ? "Deploy branch" : "Build, deploy, and test"}</Button></span>
              {canViewImages ? <Button onClick={() => { setImagePage(1); setImagesOpen(true); }}>Container images</Button> : null}
              {canCleanup ? <Button onClick={() => setCleanupOpen(true)}>Remove deployment</Button> : null}
              {canReset ? <Button onClick={() => runAction("reset")} loading={runningAction === "reset"}>Clear session</Button> : null}
            </SpaceBetween>
          </SpaceBetween>
        </Container>

        <Grid gridDefinition={[{ colspan: { default: 12, l: 7 } }, { colspan: { default: 12, l: 5 } }]}>
          <Container header={<Header variant="h2" description="Updated every four seconds while this page is open.">UDS command output</Header>}>
            <SpaceBetween size="m">
              <KeyValuePairs columns={3} items={[
                { label: "State", value: sessionStatus(session) },
                { label: "Repository", value: session.repository ?? "—" },
                { label: "Branch", value: session.branch ?? "—" },
                { label: "Flavor", value: session.flavor ?? "Not flavored" },
                { label: "Commit", value: shortSha(session.sha) },
                { label: "Bundle artifact", value: session.bundleArtifact ? session.bundleArtifact.split("/").at(-1) : "Not generated" },
                { label: "Updated", value: session.updatedAt ? new Date(session.updatedAt).toLocaleString() : "—" },
              ]} />
              <pre className="terraform-source test-lab-output test-lab-live-output">{commandOutput || "No deployment output yet."}</pre>
              {session.state === "failed" && session.stderr ? <><Box variant="h3">Error output</Box><pre className="terraform-source test-lab-output test-lab-error-output">{session.stderr}</pre></> : null}
            </SpaceBetween>
          </Container>
          <Container header={<Header variant="h2" description="Deployments, stateful sets, and pods visible through the active context.">Cluster workload monitor</Header>}>
            <pre className="terraform-source test-lab-output test-lab-workload-output">{session.workloads || "No cluster workload data returned."}</pre>
          </Container>
        </Grid>
      </SpaceBetween>

      <Modal visible={startOpen} onDismiss={() => setStartOpen(false)} header={launchMatchesSelection && launchRequest?.pullRequest ? `Test pull request #${launchRequest.pullRequest}` : workflow === "deploy-only" ? "Deploy branch" : "Start build, deployment, and tests"} footer={<Box float="right"><SpaceBetween direction="horizontal" size="xs"><Button onClick={() => setStartOpen(false)}>Cancel</Button><span className="test-lab-primary-action"><Button variant="primary" onClick={() => runAction("run-test")} loading={runningAction === "run-test"}>{launchMatchesSelection ? "Start PR test" : "Start workflow"}</Button></span></SpaceBetween></Box>}>
        <SpaceBetween size="m">
          {launchMatchesSelection && launchRequest?.pullRequest ? <StatusIndicator type="info">Prepared from pull request #{launchRequest.pullRequest}</StatusIndicator> : null}
          <Box>This checks out <Box variant="strong" display="inline">{repository}@{branch}</Box> at the validated branch snapshot and runs {workflow === "deploy-only" ? "this fixed task:" : "these fixed tasks in order:"}</Box>
          {flavor ? <StatusIndicator type="info">Only the <Box variant="strong" display="inline">{flavor}</Box> flavor will run in this session.</StatusIndicator> : null}
          <ol className="test-lab-confirm-steps">
            {workflow === "deploy-only" ? <li><Box variant="code">uds run dev{flavor ? ` --set flavor=${flavor}` : ""}</Box> builds and deploys the selected flavor without running repository tests.</li> : <><li><Box variant="code">uds run create-dev-package{flavor ? ` --set flavor=${flavor}` : ""}</Box> builds the selected flavor.</li><li><Box variant="code">uds run create-deploy-test-bundle{flavor ? ` --set flavor=${flavor}` : ""}</Box> creates and deploys the selected flavor&apos;s bundle, prepares the test user, and runs the repository-defined tests.</li></>}
          </ol>
          {workflow === "build-deploy-test" ? <Box><Box variant="strong">Tests: </Box>{plan?.workflow.tests.join(", ") || "Repository health checks"}</Box> : <StatusIndicator type="info">Repository tests will not run. The deployed workloads remain available for manual inspection.</StatusIndicator>}
          <StatusIndicator type="info">The workflow uses the existing {session.context} cluster. It will not create or replace a cluster.</StatusIndicator>
          <StatusIndicator type="warning">A successful bundle remains deployed for inspection. Use Remove deployment when testing is complete.</StatusIndicator>
        </SpaceBetween>
      </Modal>

      <Modal
        visible={imagesOpen}
        onDismiss={() => setImagesOpen(false)}
        header="Session container images"
        size="max"
        footer={<Box float="right"><Button onClick={() => setImagesOpen(false)}>Close</Button></Box>}
      >
        <SpaceBetween size="m">
          <Box color="text-body-secondary">Images are limited to pods labeled for packages declared by the selected branch&apos;s bundle. This inventory refreshes every four seconds while open.</Box>
          {imageError ? <Flashbar items={[{ type: "error", content: imageError }]} /> : null}
          {imageInventory ? <KeyValuePairs columns={4} items={[
            { label: "Repository", value: session.repository ?? "—" },
            { label: "Branch", value: session.branch ?? "—" },
            { label: "Flavor", value: session.flavor ?? "Not flavored" },
            { label: "Bundle packages", value: imageInventory.packages.length },
            { label: "Matched pods", value: imageInventory.podCount },
          ]} /> : null}
          {imageInventory && !imageInventory.baselineAvailable ? <StatusIndicator type="info">A pre-deployment baseline is unavailable for this session. Images are still scoped to its bundle packages, but existing and replaced pods cannot be distinguished.</StatusIndicator> : null}
          <Table
            variant="embedded"
            stickyHeader
            stripedRows
            trackBy="id"
            loading={imageLoading}
            loadingText="Reading session container images"
            items={imageRows}
            header={<Header variant="h3" counter={`(${filteredImages.length})`}>Containers</Header>}
            filter={<TextFilter filteringText={imageFilter} onChange={({ detail }) => { setImageFilter(detail.filteringText); setImagePage(1); }} filteringPlaceholder="Find package, pod, container, image, or digest" countText={`${filteredImages.length} matches`} />}
            pagination={<Pagination currentPageIndex={currentImagePage} pagesCount={imagePageCount} onChange={({ detail }) => setImagePage(detail.currentPageIndex)} />}
            columnDefinitions={[
              { id: "package", header: "Package", cell: (item) => <Box variant="strong">{item.package}</Box> },
              { id: "pod", header: "Pod", cell: (item) => <SpaceBetween size="xxs"><Box>{item.namespace}/{item.pod}</Box><Box color="text-body-secondary">{item.ownerKind && item.ownerName ? `${item.ownerKind} ${item.ownerName}` : item.podPhase}</Box></SpaceBetween> },
              { id: "container", header: "Container", cell: (item) => <SpaceBetween size="xxs"><Box>{item.container}</Box>{item.containerType === "init" ? <Badge>Init</Badge> : null}</SpaceBetween> },
              { id: "image", header: "Declared image", cell: (item) => <SpaceBetween size="xxs"><Box variant="code">{item.image}</Box>{item.digest ? <Box color="text-body-secondary"><span title={item.digest}>{item.digest.slice(0, 20)}…</span></Box> : <Box color="text-body-secondary">Digest pending</Box>}</SpaceBetween> },
              { id: "session", header: "Session", cell: (item) => item.sessionChange === "session" ? <StatusIndicator type="info">Created or replaced</StatusIndicator> : item.sessionChange === "existing" ? <StatusIndicator type="pending">Present before run</StatusIndicator> : <StatusIndicator type="stopped">Baseline unavailable</StatusIndicator> },
              { id: "ready", header: "Status", cell: (item) => item.ready ? <StatusIndicator type="success">{item.containerType === "init" ? "Completed" : "Ready"}</StatusIndicator> : <StatusIndicator type="pending">{item.podPhase}</StatusIndicator> },
            ]}
            empty={<Box textAlign="center" color="text-body-secondary" padding="l">No matching container images are currently running for this bundle.</Box>}
          />
        </SpaceBetween>
      </Modal>

      <Modal visible={cleanupOpen} onDismiss={() => setCleanupOpen(false)} header="Remove test deployment" footer={<Box float="right"><SpaceBetween direction="horizontal" size="xs"><Button onClick={() => setCleanupOpen(false)}>Cancel</Button><Button variant="primary" onClick={() => runAction("cleanup")} loading={runningAction === "cleanup"}>Remove bundle</Button></SpaceBetween></Box>}>
        <SpaceBetween size="m">
          <Box>This runs UDS removal against the exact generated bundle artifact for <Box variant="strong" display="inline">{session.bundleName}</Box>{session.flavor ? <> using the <Box variant="strong" display="inline">{session.flavor}</Box> flavor</> : null}.</Box>
          <Box variant="code">uds remove {session.bundleArtifact?.split("/").at(-1)} --confirm --no-progress</Box>
          <StatusIndicator type="warning">This removes the test bundle from the existing cluster. It does not remove or recreate the cluster.</StatusIndicator>
        </SpaceBetween>
      </Modal>
    </ContentLayout>
  );
}
