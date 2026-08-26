const STORAGE_KEY = "voktty-quick-open-mru-v1";
const MAX_WORKSPACES = 20;
const MAX_FILES_PER_WORKSPACE = 100;

type RecentFilesState = Record<string, { files: string[]; touchedAt: number }>;

function parseState(raw: string | null): RecentFilesState {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).flatMap(([scope, entry]) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry))
          return [];
        const candidate = entry as { files?: unknown; touchedAt?: unknown };
        if (!Array.isArray(candidate.files)) return [];
        const files = candidate.files.filter(
          (path): path is string => typeof path === "string" && path.length > 0,
        );
        return [
          [
            scope,
            {
              files: files.slice(0, MAX_FILES_PER_WORKSPACE),
              touchedAt: Number(candidate.touchedAt) || 0,
            },
          ],
        ];
      }),
    );
  } catch {
    return {};
  }
}

function readState(): RecentFilesState {
  try {
    return parseState(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return {};
  }
}

function writeState(state: RecentFilesState): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Recency is optional when storage is unavailable.
  }
}

export function recentQuickOpenFiles(scope: string): string[] {
  return readState()[scope]?.files ?? [];
}

export function recordQuickOpenFile(scope: string, relativePath: string): void {
  if (!scope || !relativePath) return;
  const state = readState();
  const previous = state[scope]?.files ?? [];
  state[scope] = {
    files: [
      relativePath,
      ...previous.filter((path) => path !== relativePath),
    ].slice(0, MAX_FILES_PER_WORKSPACE),
    touchedAt: Date.now(),
  };

  const scopes = Object.keys(state);
  if (scopes.length > MAX_WORKSPACES) {
    for (const staleScope of scopes
      .sort((left, right) => state[right].touchedAt - state[left].touchedAt)
      .slice(MAX_WORKSPACES)) {
      delete state[staleScope];
    }
  }
  writeState(state);
}
