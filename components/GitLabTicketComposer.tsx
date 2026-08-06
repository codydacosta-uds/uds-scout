"use client";

import Badge from "@cloudscape-design/components/badge";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Container from "@cloudscape-design/components/container";
import ContentLayout from "@cloudscape-design/components/content-layout";
import Flashbar from "@cloudscape-design/components/flashbar";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import Link from "@cloudscape-design/components/link";
import Modal from "@cloudscape-design/components/modal";
import Multiselect from "@cloudscape-design/components/multiselect";
import Select from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Table from "@cloudscape-design/components/table";
import Textarea from "@cloudscape-design/components/textarea";
import { useEffect, useState } from "react";
import { MAX_GITLAB_TICKET_BATCH } from "@/lib/gitlab-ticket-constants";
import type { SetupGitlabProjectCatalog } from "./setup-types";

type TicketDraft = {
  clientId: string;
  title: string;
  description: string;
  labels: string[];
};

type ProjectLabel = { name: string; color: string; description: string | null };

type TicketBatchResult = {
  project?: string;
  created: { clientId: string; id: number; iid: number; title: string; url: string }[];
  failed: { clientId: string; title: string; error: string }[];
  error?: string;
};

const stageStyle = {
  root: {
    background: { default: "#238636", hover: "#2ea043", active: "#1f6f32" },
    borderColor: { default: "#2ea043", hover: "#3fb950", active: "#238636" },
    color: { default: "#ffffff", hover: "#ffffff", active: "#ffffff" },
  },
} as const;

const submitStyle = {
  root: {
    background: { default: "var(--d2d-color-warning)", hover: "var(--d2d-color-warning-hover)", active: "var(--d2d-color-warning-active)" },
    borderColor: { default: "var(--d2d-color-warning)", hover: "var(--d2d-color-warning-hover)", active: "var(--d2d-color-warning-active)" },
    color: { default: "#0b0c0e", hover: "#0b0c0e", active: "#0b0c0e" },
  },
} as const;

function descriptionPreview(description: string) {
  if (!description) return "No description";
  return description.length > 160 ? `${description.slice(0, 157)}…` : description;
}

export function GitLabTicketComposer() {
  const [drafts, setDrafts] = useState<TicketDraft[]>([]);
  const [projects, setProjects] = useState<SetupGitlabProjectCatalog["projects"]>([]);
  const [targetProject, setTargetProject] = useState<string | null>(null);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [projectLabels, setProjectLabels] = useState<ProjectLabel[]>([]);
  const [selectedLabels, setSelectedLabels] = useState<string[]>([]);
  const [labelsLoading, setLabelsLoading] = useState(false);
  const [labelsError, setLabelsError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<TicketBatchResult | null>(null);
  const normalizedTitle = title.trim();
  const atLimit = drafts.length >= MAX_GITLAB_TICKET_BATCH && !editingId;
  const targetOptions = projects.filter((project) => project.canCreateTickets).map((project) => ({ label: project.fullPath, value: project.fullPath, description: project.ticketValidation }));
  const selectedTargetOption = targetOptions.find((option) => option.value?.toLowerCase() === targetProject?.toLowerCase()) ?? null;
  const selectedTarget = projects.find((project) => project.fullPath.toLowerCase() === targetProject?.toLowerCase()) ?? null;
  const labelOptions = projectLabels.map((label) => ({ label: label.name, value: label.name, description: label.description ?? undefined }));
  const selectedLabelOptions = labelOptions.filter((option) => selectedLabels.some((label) => label.toLowerCase() === option.value?.toLowerCase()));

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    fetch("/api/setup/gitlab/projects?selected=true", { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Gitlab projects could not be loaded.");
        return data as SetupGitlabProjectCatalog;
      })
      .then((data) => {
        if (!active) return;
        const selected = new Set(data.selectedProjects.map((project) => project.toLowerCase()));
        const available = data.projects.filter((project) => selected.has(project.fullPath.toLowerCase()));
        setProjects(available);
        const requestedDefault = data.defaultProject && available.some((project) => project.canCreateTickets && project.fullPath.toLowerCase() === data.defaultProject?.toLowerCase()) ? data.defaultProject : null;
        setTargetProject(requestedDefault);
        setLabelsLoading(Boolean(requestedDefault));
        setProjectsError(null);
      })
      .catch((reason) => {
        if (active && reason.name !== "AbortError") setProjectsError(reason instanceof Error ? reason.message : "Gitlab projects could not be loaded.");
      })
      .finally(() => {
        if (active) setProjectsLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  useEffect(() => {
    if (!targetProject) return;
    const controller = new AbortController();
    let active = true;
    fetch(`/api/gitlab/labels?project=${encodeURIComponent(targetProject)}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Gitlab labels could not be loaded.");
        return data as { labels: ProjectLabel[] };
      })
      .then((data) => {
        if (active) setProjectLabels(data.labels);
      })
      .catch((reason) => {
        if (active && reason.name !== "AbortError") setLabelsError(reason instanceof Error ? reason.message : "Gitlab labels could not be loaded.");
      })
      .finally(() => {
        if (active) setLabelsLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [targetProject]);

  const clearEditor = () => {
    setTitle("");
    setDescription("");
    setSelectedLabels([]);
    setEditingId(null);
  };

  const stageTicket = () => {
    if (!targetProject || !normalizedTitle || normalizedTitle.length > 255 || atLimit) return;
    if (editingId) {
      setDrafts((current) => current.map((draft) => draft.clientId === editingId
        ? { ...draft, title: normalizedTitle, description: description.trim(), labels: selectedLabels }
        : draft));
    } else {
      setDrafts((current) => [...current, {
        clientId: crypto.randomUUID(),
        title: normalizedTitle,
        description: description.trim(),
        labels: selectedLabels,
      }]);
    }
    clearEditor();
    setResult(null);
  };

  const editTicket = (draft: TicketDraft) => {
    setTitle(draft.title);
    setDescription(draft.description);
    setSelectedLabels(draft.labels);
    setEditingId(draft.clientId);
  };

  const removeTicket = (clientId: string) => {
    setDrafts((current) => current.filter((draft) => draft.clientId !== clientId));
    if (editingId === clientId) clearEditor();
  };

  const submitBatch = async () => {
    if (!drafts.length || !targetProject) return;
    setSubmitting(true);
    setResult(null);
    try {
      const response = await fetch("/api/gitlab/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tickets: drafts, project: targetProject }),
      });
      const data = await response.json() as TicketBatchResult;
      if (!response.ok) throw new Error(data.error ?? "Gitlab tickets could not be created.");
      const createdIds = new Set(data.created.map((ticket) => ticket.clientId));
      setDrafts((current) => current.filter((draft) => !createdIds.has(draft.clientId)));
      setResult(data);
      setReviewOpen(false);
    } catch (error) {
      setResult({ created: [], failed: [], error: error instanceof Error ? error.message : "Gitlab tickets could not be created." });
      setReviewOpen(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <ContentLayout
        header={<Header variant="h1" description="Stage one or more issues, review the batch, and create them in Gitlab only after confirmation.">Create Gitlab tickets</Header>}
      >
        <SpaceBetween size="l">
          {projectsError ? <Flashbar items={[{ type: "error", header: "Gitlab projects are unavailable", content: projectsError }]} /> : null}
          {labelsError ? <Flashbar items={[{ type: "error", header: "Gitlab labels are unavailable", content: labelsError }]} /> : null}
          {result ? (
            <Flashbar items={[
              ...(result.created.length ? [{
                type: "success" as const,
                header: `${result.created.length} ${result.created.length === 1 ? "ticket was" : "tickets were"} created`,
                content: <SpaceBetween size="xxs">{result.created.map((ticket) => <Link key={ticket.id} href={ticket.url} external>#{ticket.iid} {ticket.title}</Link>)}</SpaceBetween>,
              }] : []),
              ...(result.failed.length || result.error ? [{
                type: "error" as const,
                header: result.error ?? `${result.failed.length} ${result.failed.length === 1 ? "ticket" : "tickets"} could not be created`,
                content: result.failed.length ? <SpaceBetween size="xxs">{result.failed.map((ticket) => <Box key={ticket.clientId}>{ticket.title}: {ticket.error}</Box>)}</SpaceBetween> : undefined,
              }] : []),
            ]} />
          ) : null}

          <Container
            header={<Header variant="h2" description={selectedTarget ? <>Target project: <Link href={`${selectedTarget.url}/-/work_items`} external>{selectedTarget.fullPath}</Link></> : "Choose one validated project for this batch."}>Draft a ticket</Header>}
          >
            <SpaceBetween size="m">
              <FormField label="Target project" description="A batch can create tickets in one project only. Start a new batch to use another project.">
                <Select
                  selectedOption={selectedTargetOption}
                  options={targetOptions}
                  placeholder="Choose a validated Gitlab project"
                  empty="No selected projects passed ticket validation"
                  statusType={projectsLoading ? "loading" : "finished"}
                  loadingText="Validating Gitlab projects"
                  disabled={Boolean(drafts.length)}
                  onChange={({ detail }) => {
                    const project = detail.selectedOption.value ?? null;
                    setTargetProject(project);
                    setSelectedLabels([]);
                    setProjectLabels([]);
                    setLabelsError(null);
                    setLabelsLoading(Boolean(project));
                  }}
                />
              </FormField>
              <FormField label="Labels" description="Optional. Choose up to 20 labels available in the target project.">
                <Multiselect
                  selectedOptions={selectedLabelOptions}
                  options={labelOptions}
                  filteringType="auto"
                  tokenLimit={5}
                  placeholder={targetProject ? "Choose Gitlab labels" : "Choose a target project first"}
                  empty="No labels are available in this project"
                  statusType={labelsLoading ? "loading" : "finished"}
                  loadingText="Loading Gitlab labels"
                  disabled={!targetProject || labelsLoading}
                  onChange={({ detail }) => setSelectedLabels(detail.selectedOptions.flatMap((option) => option.value ? [option.value] : []).slice(0, 20))}
                />
              </FormField>
              <FormField label="Title" constraintText={`${title.length}/255 characters`} errorText={title.length > 255 ? "Title cannot exceed 255 characters." : undefined}>
                <Input value={title} onChange={({ detail }) => setTitle(detail.value)} placeholder="Describe the work to be done" />
              </FormField>
              <FormField label="Description" description="Optional Markdown description." constraintText={`${description.length}/50,000 characters`} errorText={description.length > 50_000 ? "Description cannot exceed 50,000 characters." : undefined}>
                <Textarea value={description} onChange={({ detail }) => setDescription(detail.value)} rows={8} placeholder="Add context, acceptance criteria, or implementation notes" />
              </FormField>
              <SpaceBetween direction="horizontal" size="s">
                <Button
                  variant="primary"
                  style={stageStyle}
                  onClick={stageTicket}
                  disabled={!targetProject || !normalizedTitle || title.length > 255 || description.length > 50_000 || atLimit}
                >
                  {editingId ? "Update staged ticket" : "Stage ticket"}
                </Button>
                {editingId ? <Button onClick={clearEditor}>Cancel edit</Button> : null}
              </SpaceBetween>
              {atLimit ? <Box color="text-status-warning">The batch limit is {MAX_GITLAB_TICKET_BATCH} tickets.</Box> : null}
            </SpaceBetween>
          </Container>

          <Table
            variant="container"
            trackBy="clientId"
            items={drafts}
            header={
              <Header
                variant="h2"
                counter={`(${drafts.length}/${MAX_GITLAB_TICKET_BATCH})`}
                description="No Gitlab write occurs until the reviewed batch is confirmed."
                actions={<Button style={submitStyle} disabled={!drafts.length || Boolean(editingId)} onClick={() => setReviewOpen(true)}>Review batch</Button>}
              >
                Staged tickets
              </Header>
            }
            columnDefinitions={[
              { id: "title", header: "Title", cell: (draft) => draft.title },
              { id: "description", header: "Description", cell: (draft) => <Box color={draft.description ? undefined : "text-body-secondary"}>{descriptionPreview(draft.description)}</Box> },
              { id: "labels", header: "Labels", cell: (draft) => draft.labels.length ? <SpaceBetween direction="horizontal" size="xxs">{draft.labels.map((label) => <Badge color="grey" key={label}>{label}</Badge>)}</SpaceBetween> : <Box color="text-body-secondary">None</Box> },
              { id: "actions", header: "Actions", cell: (draft) => <SpaceBetween direction="horizontal" size="xs"><Button variant="inline-link" onClick={() => editTicket(draft)}>Edit</Button><Button variant="inline-link" onClick={() => removeTicket(draft.clientId)}>Remove</Button></SpaceBetween> },
            ]}
            empty={<Box textAlign="center" color="text-body-secondary" padding={{ vertical: "xxl" }}>Stage a ticket to begin a batch.</Box>}
          />
        </SpaceBetween>
      </ContentLayout>

      <Modal
        visible={reviewOpen}
        onDismiss={() => { if (!submitting) setReviewOpen(false); }}
        header={`Review ${drafts.length} ${drafts.length === 1 ? "ticket" : "tickets"}`}
        size="large"
        footer={<Box float="right"><SpaceBetween direction="horizontal" size="s"><Button disabled={submitting} onClick={() => setReviewOpen(false)}>Continue editing</Button><Button style={submitStyle} loading={submitting} onClick={submitBatch}>Create {drafts.length} {drafts.length === 1 ? "ticket" : "tickets"}</Button></SpaceBetween></Box>}
      >
        <SpaceBetween size="m">
          <Box color="text-body-secondary">This creates issues immediately in <Box variant="strong" display="inline">{targetProject ?? "the selected project"}</Box>. Gitlab processes each ticket separately, so a batch can partially succeed.</Box>
          <Table
            variant="embedded"
            trackBy="clientId"
            items={drafts}
            columnDefinitions={[
              { id: "title", header: "Title", cell: (draft) => draft.title },
              { id: "description", header: "Description", cell: (draft) => <Box color={draft.description ? undefined : "text-body-secondary"}>{descriptionPreview(draft.description)}</Box> },
              { id: "labels", header: "Labels", cell: (draft) => draft.labels.length ? draft.labels.join(", ") : <Box color="text-body-secondary">None</Box> },
            ]}
          />
        </SpaceBetween>
      </Modal>
    </>
  );
}
