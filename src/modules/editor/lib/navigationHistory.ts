export type EditorNavigationLocation = {
  spaceId: string;
  path: string;
  line: number;
  column: number;
};

export type NavigationHistory = {
  entries: EditorNavigationLocation[];
  index: number;
  limit: number;
  canGoBack: boolean;
  canGoForward: boolean;
};

export type NavigationDirection = "back" | "forward";

export type NavigationStep = {
  state: NavigationHistory;
  target: EditorNavigationLocation | null;
};

function normalizeLocation(
  location: EditorNavigationLocation,
): EditorNavigationLocation {
  return {
    ...location,
    path: location.path.replace(/\\/g, "/"),
    line: Math.max(1, Math.trunc(location.line)),
    column: Math.max(1, Math.trunc(location.column)),
  };
}

function sameLocation(
  left: EditorNavigationLocation,
  right: EditorNavigationLocation,
): boolean {
  return (
    left.spaceId === right.spaceId &&
    left.path === right.path &&
    left.line === right.line &&
    left.column === right.column
  );
}

function withIndex(
  entries: EditorNavigationLocation[],
  index: number,
  limit: number,
): NavigationHistory {
  return {
    entries,
    index,
    limit,
    canGoBack: index > 0,
    canGoForward: index >= 0 && index < entries.length - 1,
  };
}

export function createNavigationHistory(limit = 100): NavigationHistory {
  return withIndex([], -1, Math.max(2, Math.trunc(limit)));
}

function isNavigationLocation(value: unknown): value is EditorNavigationLocation {
  if (typeof value !== "object" || value === null) return false;
  const location = value as Partial<EditorNavigationLocation>;
  return (
    typeof location.spaceId === "string" &&
    location.spaceId.length > 0 &&
    typeof location.path === "string" &&
    location.path.length > 0 &&
    typeof location.line === "number" &&
    Number.isFinite(location.line) &&
    typeof location.column === "number" &&
    Number.isFinite(location.column)
  );
}

export function hydrateNavigationHistory(
  value: unknown,
  limit = 100,
): NavigationHistory {
  const safeLimit = Math.max(2, Math.trunc(limit));
  if (typeof value !== "object" || value === null) {
    return createNavigationHistory(safeLimit);
  }
  const candidate = value as { entries?: unknown; index?: unknown };
  if (!Array.isArray(candidate.entries)) {
    return createNavigationHistory(safeLimit);
  }
  const entries = candidate.entries
    .filter(isNavigationLocation)
    .map(normalizeLocation)
    .slice(-safeLimit);
  if (entries.length === 0) return createNavigationHistory(safeLimit);
  const requested =
    typeof candidate.index === "number" && Number.isFinite(candidate.index)
      ? Math.trunc(candidate.index)
      : entries.length - 1;
  return withIndex(
    entries,
    Math.max(0, Math.min(entries.length - 1, requested)),
    safeLimit,
  );
}

export function recordNavigation(
  state: NavigationHistory,
  origin: EditorNavigationLocation,
  destination: EditorNavigationLocation,
): NavigationHistory {
  const entries = state.entries.slice(0, state.index + 1);
  const append = (location: EditorNavigationLocation) => {
    const normalized = normalizeLocation(location);
    const previous = entries[entries.length - 1];
    if (!previous || !sameLocation(previous, normalized)) {
      entries.push(normalized);
    }
  };

  append(origin);
  append(destination);
  const bounded = entries.slice(-state.limit);
  return withIndex(bounded, bounded.length - 1, state.limit);
}

export function navigateHistory(
  state: NavigationHistory,
  direction: NavigationDirection,
): NavigationStep {
  const delta = direction === "back" ? -1 : 1;
  const index = state.index + delta;
  if (index < 0 || index >= state.entries.length) {
    return { state, target: null };
  }
  return {
    state: withIndex(state.entries, index, state.limit),
    target: state.entries[index],
  };
}
