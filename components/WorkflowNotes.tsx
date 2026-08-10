"use client";

import Button from "@cloudscape-design/components/button";
import Checkbox from "@cloudscape-design/components/checkbox";
import Flashbar from "@cloudscape-design/components/flashbar";
import FormField from "@cloudscape-design/components/form-field";
import Link from "@cloudscape-design/components/link";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Textarea from "@cloudscape-design/components/textarea";
import { useState } from "react";
import { SaveButton } from "./action-ui";

const MAX_TASK_LENGTH = 500;
const MAX_TASKS = 100;

type WorkflowTask = {
  id: string;
  text: string;
  completed: boolean;
  createdAt: string;
};

type SavedWorkflowNotes = {
  tasks: WorkflowTask[];
  updatedAt: string;
};

function storageKey(viewer: string, noteKey: string) {
  return `uds-scout:${viewer.toLowerCase()}:workflow-note:${encodeURIComponent(noteKey)}`;
}

function noticeStorageKey(viewer: string) {
  return `uds-scout:${viewer.toLowerCase()}:workflow-notes-notice:v1`;
}

function shouldShowNotice(viewer: string) {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(noticeStorageKey(viewer)) !== "acknowledged";
  } catch {
    return true;
  }
}

function validTask(value: unknown): value is WorkflowTask {
  if (!value || typeof value !== "object") return false;
  const task = value as Partial<WorkflowTask>;
  return typeof task.id === "string" && typeof task.text === "string" && typeof task.completed === "boolean" && typeof task.createdAt === "string";
}

function legacyTasks(text: string, updatedAt: string) {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, MAX_TASKS).map((line, index) => ({
    id: `legacy-${index}-${line.slice(0, 32)}`,
    text: line.slice(0, MAX_TASK_LENGTH),
    completed: false,
    createdAt: updatedAt || new Date().toISOString(),
  }));
}

function readNotes(viewer: string, noteKey: string): SavedWorkflowNotes {
  if (typeof window === "undefined") return { tasks: [], updatedAt: "" };
  try {
    const stored = JSON.parse(window.localStorage.getItem(storageKey(viewer, noteKey)) ?? "null") as { tasks?: unknown; text?: unknown; updatedAt?: unknown } | null;
    const updatedAt = typeof stored?.updatedAt === "string" ? stored.updatedAt : "";
    if (Array.isArray(stored?.tasks)) return { tasks: stored.tasks.filter(validTask).slice(0, MAX_TASKS), updatedAt };
    if (typeof stored?.text === "string") return { tasks: legacyTasks(stored.text, updatedAt), updatedAt };
  } catch {
    // Start with an empty queue when saved browser data is unavailable or invalid.
  }
  return { tasks: [], updatedAt: "" };
}

export function WorkflowNotes({ viewer, noteKey, durableHref }: {
  viewer: string;
  noteKey: string;
  durableHref: string;
}) {
  const [savedNotes, setSavedNotes] = useState<SavedWorkflowNotes>(() => readNotes(viewer, noteKey));
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [noticeVisible, setNoticeVisible] = useState(() => shouldShowNotice(viewer));
  const completedTasks = savedNotes.tasks.filter((task) => task.completed).length;

  const persist = (tasks: WorkflowTask[]) => {
    const next = { tasks, updatedAt: new Date().toISOString() };
    if (tasks.length) window.localStorage.setItem(storageKey(viewer, noteKey), JSON.stringify(next));
    else window.localStorage.removeItem(storageKey(viewer, noteKey));
    setSavedNotes(next);
  };

  const addTasks = () => {
    setError(null);
    const available = MAX_TASKS - savedNotes.tasks.length;
    const entries = draft.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, available);
    if (!entries.length) return;
    try {
      const createdAt = new Date().toISOString();
      const tasks = [...savedNotes.tasks, ...entries.map((text) => ({ id: window.crypto.randomUUID(), text: text.slice(0, MAX_TASK_LENGTH), completed: false, createdAt }))];
      persist(tasks);
      setDraft("");
    } catch {
      setError("The next steps could not be saved in this browser.");
    }
  };

  const toggleTask = (id: string, completed: boolean) => {
    setError(null);
    try {
      persist(savedNotes.tasks.map((task) => task.id === id ? { ...task, completed } : task));
    } catch {
      setError("The next step could not be updated in this browser.");
    }
  };

  const clearCompleted = () => {
    setError(null);
    try {
      persist(savedNotes.tasks.filter((task) => !task.completed));
    } catch {
      setError("Completed next steps could not be cleared in this browser.");
    }
  };

  const dismissNotice = () => {
    try {
      window.localStorage.setItem(noticeStorageKey(viewer), "acknowledged");
    } catch {
      // Keep the notice dismissed for this view when browser storage is unavailable.
    }
    setNoticeVisible(false);
  };

  return (
    <SpaceBetween size="m">
      {noticeVisible ? <Flashbar items={[{
        type: "info",
        header: "Workflow notes are a browser-local scratchpad",
        content: <>Use these notes to resume short-term investigation only. They can be cleared with browser data and are not shared or backed up. Put durable or team-visible context in <Link href="https://www.notion.so" external>Notion</Link> or the <Link href={durableHref} external>GitHub pull request or workflow</Link>.</>,
        dismissible: true,
        onDismiss: dismissNotice,
      }]} /> : null}
      {error ? <Flashbar items={[{ type: "error", header: "Failure queue was not saved", content: error, dismissible: true, onDismiss: () => setError(null) }]} /> : null}
      {savedNotes.tasks.length ? <div className="workflow-task-list">{savedNotes.tasks.map((task) => <div className={`workflow-task${task.completed ? " workflow-task-complete" : ""}`} key={task.id}><Checkbox checked={task.completed} onChange={({ detail }) => toggleTask(task.id, detail.checked)}>{task.text}</Checkbox></div>)}</div> : null}
      <FormField>
        <Textarea value={draft} rows={3} placeholder="Add a next step. Use a new line for another task." disabled={savedNotes.tasks.length >= MAX_TASKS} onChange={({ detail }) => setDraft(detail.value.slice(0, MAX_TASK_LENGTH * 4))} />
      </FormField>
      <SpaceBetween direction="horizontal" size="s">
        <SaveButton disabled={!draft.trim() || savedNotes.tasks.length >= MAX_TASKS} onClick={addTasks}>Add {draft.split(/\r?\n/).filter((line) => line.trim()).length > 1 ? "tasks" : "task"}</SaveButton>
        {completedTasks ? <Button onClick={clearCompleted}>Clear completed</Button> : null}
      </SpaceBetween>
    </SpaceBetween>
  );
}
