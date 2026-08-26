export type LspPosition = {
  line: number;
  character: number;
};

export type LspLocation = {
  uri: string;
  range: { start: LspPosition };
};

export type NormalizedLspLocations = {
  locations: LspLocation[];
  truncated: boolean;
};

export const MAX_LSP_LOCATIONS = 1_000;

function normalizedPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/{2,}/g, "/");
}

export function lspLocationLabel(
  path: string,
  rootPath: string,
  line: number,
  character: number,
): string {
  const normalized = normalizedPath(path);
  const root = normalizedPath(rootPath).replace(/\/$/, "") || "/";
  const caseInsensitive = /^[A-Za-z]:\//.test(root);
  const candidate = caseInsensitive ? normalized.toLowerCase() : normalized;
  const prefix = root === "/" ? "/" : `${root}/`;
  const comparedPrefix = caseInsensitive ? prefix.toLowerCase() : prefix;
  const relative = candidate.startsWith(comparedPrefix)
    ? normalized.slice(prefix.length)
    : normalized;
  return `${relative}:${line + 1}:${character + 1}`;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function position(value: unknown): LspPosition | null {
  const candidate = record(value);
  if (!candidate) return null;
  const { line, character } = candidate;
  if (
    !Number.isSafeInteger(line) ||
    !Number.isSafeInteger(character) ||
    (line as number) < 0 ||
    (character as number) < 0
  ) {
    return null;
  }
  return { line: line as number, character: character as number };
}

function range(value: unknown): LspLocation["range"] | null {
  const candidate = record(value);
  if (!candidate) return null;
  const start = position(candidate.start);
  return start ? { start } : null;
}

function location(value: unknown): LspLocation | null {
  const candidate = record(value);
  if (!candidate) return null;
  if (typeof candidate.uri === "string" && candidate.uri.length > 0) {
    const locationRange = range(candidate.range);
    return locationRange ? { uri: candidate.uri, range: locationRange } : null;
  }
  if (
    typeof candidate.targetUri !== "string" ||
    candidate.targetUri.length === 0
  ) {
    return null;
  }
  const locationRange =
    range(candidate.targetSelectionRange) ?? range(candidate.targetRange);
  return locationRange
    ? { uri: candidate.targetUri, range: locationRange }
    : null;
}

export function normalizeLspLocations(
  value: unknown,
  maxLocations = MAX_LSP_LOCATIONS,
): NormalizedLspLocations {
  if (value === null || value === undefined) {
    return { locations: [], truncated: false };
  }
  const limit = Math.max(1, Math.min(MAX_LSP_LOCATIONS, maxLocations));
  const values = Array.isArray(value) ? value : [value];
  const locations: LspLocation[] = [];
  const seen = new Set<string>();
  let truncated = false;
  for (const raw of values) {
    const normalized = location(raw);
    if (!normalized) continue;
    const key = `${normalized.uri}\u0000${normalized.range.start.line}\u0000${normalized.range.start.character}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (locations.length >= limit) {
      truncated = true;
      break;
    }
    locations.push(normalized);
  }
  return { locations, truncated };
}
