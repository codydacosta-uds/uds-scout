export type RenovateMajorChange = {
  dependency: string | null;
  from: string;
  to: string;
};

export type RenovateUpdateDetails = {
  major: boolean;
  majorChanges: RenovateMajorChange[];
};

type RenovateUpdateInput = {
  body?: string | null;
  head?: string;
  labels?: { name: string }[];
  title?: string;
};

function markdownCells(line: string) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, "|"));
}

function plainMarkdown(value: string) {
  return value
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/[`*_~]/g, "")
    .trim();
}

function versionChange(value: string) {
  const normalized = value
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/[`*~]/g, "")
    .trim();
  const versions = normalized.split(/\s*(?:->|=>|→)\s*/);
  if (versions.length < 2) return null;
  return { from: versions[0].trim(), to: versions[1].trim() };
}

function leadingVersionIncrease(change: { from: string; to: string } | null) {
  if (!change) return false;
  const fromMajor = Number(change.from.match(/(?:^|\D)(\d+)(?=\.\d+)/)?.[1]);
  const toMajor = Number(change.to.match(/(?:^|\D)(\d+)(?=\.\d+)/)?.[1]);
  return Number.isSafeInteger(fromMajor) && Number.isSafeInteger(toMajor) && toMajor > fromMajor;
}

function majorLabel(label: string) {
  return /^(?:major|semver[-/: ]major|type[-/: ]major|update[-/: ]major|renovate[-/: ]major)$/i.test(label.trim());
}

export function analyzeRenovateUpdate(input: RenovateUpdateInput): RenovateUpdateDetails {
  const body = input.body ?? "";
  const lines = body.split(/\r?\n/);
  const majorChanges: RenovateMajorChange[] = [];
  let explicitMajor = (input.labels ?? []).some((label) => majorLabel(label.name))
    || /\b(?:update type|update)\s*[:=]\s*(?:\*\*)?major\b/i.test(body)
    || /(?:^|\/)major(?:-|\/)/i.test(input.head ?? "")
    || /\bmajor version (?:update|upgrade)\b/i.test(input.title ?? "");

  for (let index = 0; index < lines.length - 2; index += 1) {
    const headers = markdownCells(lines[index]).map((header) => plainMarkdown(header).toLowerCase());
    const separators = markdownCells(lines[index + 1]);
    if (headers.length < 2 || separators.length !== headers.length || !separators.every((cell) => /^:?-{3,}:?$/.test(cell))) continue;
    const packageIndex = headers.findIndex((header) => /^(?:package|dependency|image)$/.test(header));
    const updateIndex = headers.findIndex((header) => /^(?:update|update type|bump)$/.test(header));
    const changeIndex = headers.findIndex((header) => /^(?:change|version change|versions?)$/.test(header));

    for (let rowIndex = index + 2; rowIndex < lines.length && lines[rowIndex].includes("|"); rowIndex += 1) {
      const cells = markdownCells(lines[rowIndex]);
      if (cells.length !== headers.length) break;
      const updateType = updateIndex >= 0 ? plainMarkdown(cells[updateIndex]).toLowerCase() : "";
      const change = changeIndex >= 0 ? versionChange(cells[changeIndex]) : null;
      const rowIsMajor = /\bmajor\b/.test(updateType) || leadingVersionIncrease(change);
      if (!rowIsMajor) continue;
      explicitMajor = true;
      if (change) {
        majorChanges.push({
          dependency: packageIndex >= 0 ? plainMarkdown(cells[packageIndex]) || null : null,
          ...change,
        });
      }
    }
  }

  return {
    major: explicitMajor || majorChanges.length > 0,
    majorChanges: majorChanges.filter((change, index, changes) => changes.findIndex((candidate) => candidate.dependency === change.dependency && candidate.from === change.from && candidate.to === change.to) === index),
  };
}
