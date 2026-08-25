import { prettyCwd } from "./paths";

const KEY = "monocode.recentProjects";
const MAX = 20;

export type RecentProject = {
  path: string;
  openedAt: number;
};

export function normalizeProjectPath(path: string): string {
  return path.replace(/\/+$/, "") || "/";
}

function normalize(path: string): string {
  return normalizeProjectPath(path);
}

export function sameProjectPath(a: string, b: string): boolean {
  return normalizeProjectPath(a) === normalizeProjectPath(b);
}

export function loadRecents(): RecentProject[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: RecentProject[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const rec = item as { path?: unknown; openedAt?: unknown };
      if (typeof rec.path !== "string" || !rec.path) continue;
      const openedAt =
        typeof rec.openedAt === "number" && Number.isFinite(rec.openedAt)
          ? rec.openedAt
          : 0;
      out.push({ path: normalize(rec.path), openedAt });
    }
    return out;
  } catch {
    return [];
  }
}

function save(next: RecentProject[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // private mode / quota
  }
}

export function rememberProject(path: string): RecentProject[] {
  const normalized = normalize(path);
  if (normalized === "~") return loadRecents();
  const prev = loadRecents().filter((p) => p.path !== normalized);
  const next = [{ path: normalized, openedAt: Date.now() }, ...prev].slice(
    0,
    MAX,
  );
  save(next);
  return next;
}

/** Most recently opened project, if any. Used to restore the folder on launch. */
export function lastProjectPath(): string | null {
  for (const item of loadRecents()) {
    if (looksLikeProject(item.path)) return item.path;
  }
  return null;
}

/** Recents plus the current folder when it is a project not yet remembered. */
export function projectRailItems(
  recents: RecentProject[],
  currentCwd: string,
): RecentProject[] {
  const items: RecentProject[] = [];
  const seen = new Set<string>();
  const push = (path: string, openedAt: number) => {
    if (!looksLikeProject(path)) return;
    const normalized = normalize(path);
    if (seen.has(normalized)) return;
    seen.add(normalized);
    items.push({ path: normalized, openedAt });
  };
  if (currentCwd) push(currentCwd, Date.now());
  for (const item of recents) push(item.path, item.openedAt);
  return items;
}

/** True if this looks like a user project, not an app bundle or system root. */
export function looksLikeProject(path: string): boolean {
  if (!path || path === "/" || path === "~") return false;
  // Home itself arrives expanded (`/Users/me`), so the `~` check above misses
  // it. Indexing it walks `~/Library`, which trips the OS consent prompt.
  if (prettyCwd(path) === "~") return false;
  if (path.includes(".app/")) return false;
  return true;
}
