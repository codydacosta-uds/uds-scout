import { NextRequest, NextResponse } from "next/server";
import { currentGitHubViewer } from "@/lib/github";
import { readLocalSettings, writeLocalSettings } from "@/lib/local-settings";
import { CONFIGURED_WORKSPACE_PRESETS, workspacePresetsWithConfig, type WorkspacePreset } from "@/lib/repository-constants";

export const runtime = "nodejs";

const MAX_PRESETS = 20;
const MAX_REPOSITORIES_PER_PRESET = 25;

function sameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === request.headers.get("host");
  } catch {
    return false;
  }
}

function validatePresets(value: unknown): WorkspacePreset[] | null {
  if (!Array.isArray(value) || value.length > MAX_PRESETS) return null;
  const presets: WorkspacePreset[] = [];
  const ids = new Set<string>();
  const labels = new Set<string>();
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object") return null;
    const item = candidate as { id?: unknown; label?: unknown; repositories?: unknown };
    const id = typeof item.id === "string" ? item.id.trim() : "";
    const label = typeof item.label === "string" ? item.label.trim() : "";
    if (!id || id.length > 80 || !/^[a-zA-Z0-9_-]+$/.test(id) || ids.has(id.toLowerCase())) return null;
    if (!label || label.length > 60 || labels.has(label.toLowerCase()) || !Array.isArray(item.repositories)) return null;
    const repositories = [...new Set(item.repositories.filter((repository): repository is string => typeof repository === "string").map((repository) => repository.trim()).filter(Boolean))];
    if (!repositories.length || repositories.length > MAX_REPOSITORIES_PER_PRESET || repositories.some((repository) => !/^[^/\s]+\/[^/\s]+$/.test(repository))) return null;
    ids.add(id.toLowerCase());
    labels.add(label.toLowerCase());
    presets.push({ id, label, repositories, source: "user" });
  }
  return presets;
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: "Cross-origin setup requests are not allowed." }, { status: 403 });
  }

  const viewer = currentGitHubViewer();
  const settings = readLocalSettings(viewer);
  if (!settings) {
    return NextResponse.json({ error: "Complete workspace setup before saving quick select groups." }, { status: 409 });
  }

  const body = await request.json().catch(() => null) as { presets?: unknown } | null;
  const presets = validatePresets(body?.presets);
  if (!presets) {
    return NextResponse.json({ error: `Choose up to ${MAX_PRESETS} groups with a name and 1–${MAX_REPOSITORIES_PER_PRESET} repositories each.` }, { status: 400 });
  }
  const configuredIds = new Set(CONFIGURED_WORKSPACE_PRESETS.map((preset) => preset.id.toLowerCase()));
  const configuredLabels = new Set(CONFIGURED_WORKSPACE_PRESETS.map((preset) => preset.label.toLowerCase()));
  if (presets.some((preset) => configuredIds.has(preset.id.toLowerCase()) || configuredLabels.has(preset.label.toLowerCase()))) {
    return NextResponse.json({ error: "Repository-configured quick select groups cannot be replaced from workspace settings." }, { status: 400 });
  }

  writeLocalSettings({ ...settings, workspacePresets: presets }, viewer);
  return NextResponse.json({ presets: workspacePresetsWithConfig(presets) });
}
