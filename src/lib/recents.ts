import { prettyCwd } from "./paths";

const KEY = "monocode.recentProjects";
const RAIL_ORDER_KEY = "monocode.projectRailOrder";
const RAIL_PINNED_KEY = "monocode.projectRailPinned";
const ARCHIVED_KEY = "monocode.archivedProjects";
const ARCHIVED_CHANGED = "monocode:archived-projects-changed";
const MAX = 20;

export type RecentProject = {
  path: string;
  openedAt: number;
};

export type ArchivedProject = {
  path: string;
  archivedAt: number;
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
  dropArchived(normalized);
  const prev = loadRecents().filter((p) => p.path !== normalized);
  const next = [{ path: normalized, openedAt: Date.now() }, ...prev].slice(
    0,
    MAX,
  );
  save(next);
  return next;
}

/** Drops a project from the rail: its recent entry, saved order slot, and pin. */
function dropFromRail(path: string): RecentProject[] {
  const normalized = normalize(path);
  const next = loadRecents().filter((item) => item.path !== normalized);
  save(next);
  saveProjectRailOrder(
    loadProjectRailOrder().filter((entry) => entry !== normalized),
  );
  savePinnedProjects(
    loadPinnedProjects().filter((entry) => entry !== normalized),
  );
  return next;
}

/** Removes a project from the rail and from the archive (Delete). */
export function forgetProject(path: string): RecentProject[] {
  dropArchived(path);
  return dropFromRail(path);
}

/** Removes a project from the rail and files it in the archive (Archive). */
export function archiveProject(path: string): RecentProject[] {
  const normalized = normalize(path);
  if (!looksLikeProject(normalized)) return loadRecents();
  const recents = dropFromRail(normalized);
  const rest = loadArchivedProjects().filter((item) => item.path !== normalized);
  saveArchived([{ path: normalized, archivedAt: Date.now() }, ...rest]);
  return recents;
}

export function loadArchivedProjects(): ArchivedProject[] {
  try {
    const raw = localStorage.getItem(ARCHIVED_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: ArchivedProject[] = [];
    const seen = new Set<string>();
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const rec = item as { path?: unknown; archivedAt?: unknown };
      if (typeof rec.path !== "string" || !rec.path) continue;
      const path = normalize(rec.path);
      if (seen.has(path) || !looksLikeProject(path)) continue;
      seen.add(path);
      const archivedAt =
        typeof rec.archivedAt === "number" && Number.isFinite(rec.archivedAt)
          ? rec.archivedAt
          : 0;
      out.push({ path, archivedAt });
    }
    return out;
  } catch {
    return [];
  }
}

export function subscribeArchivedProjects(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(ARCHIVED_CHANGED, onChange);
  return () => window.removeEventListener(ARCHIVED_CHANGED, onChange);
}

function saveArchived(next: ArchivedProject[]) {
  try {
    localStorage.setItem(ARCHIVED_KEY, JSON.stringify(next));
  } catch {
    // private mode / quota
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(ARCHIVED_CHANGED));
  }
}

function dropArchived(path: string) {
  const normalized = normalize(path);
  const prev = loadArchivedProjects();
  const next = prev.filter((item) => item.path !== normalized);
  if (next.length === prev.length) return;
  saveArchived(next);
}

/** Most recently opened project, if any. Used to restore the folder on launch. */
export function lastProjectPath(): string | null {
  for (const item of loadRecents()) {
    if (looksLikeProject(item.path)) return item.path;
  }
  return null;
}

export type ProjectRailSections = {
  pinned: RecentProject[];
  projects: RecentProject[];
};

function readPathList(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: string[] = [];
    const seen = new Set<string>();
    for (const item of parsed) {
      if (typeof item !== "string" || !item) continue;
      const path = normalize(item);
      if (seen.has(path)) continue;
      seen.add(path);
      out.push(path);
    }
    return out;
  } catch {
    return [];
  }
}

function savePathList(key: string, paths: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(paths));
  } catch {
    // private mode / quota
  }
}

export function loadProjectRailOrder(): string[] {
  return readPathList(RAIL_ORDER_KEY);
}

export function saveProjectRailOrder(order: string[]) {
  savePathList(RAIL_ORDER_KEY, order.map(normalize));
}

export function loadPinnedProjects(): string[] {
  return readPathList(RAIL_PINNED_KEY);
}

export function savePinnedProjects(pinned: string[]) {
  savePathList(RAIL_PINNED_KEY, pinned.map(normalize));
}

/** All projects for the rail, keyed by normalized path. */
export function collectRailProjects(
  recents: RecentProject[],
  currentCwd: string,
): Map<string, RecentProject> {
  const map = new Map<string, RecentProject>();
  for (const item of recents) {
    if (!looksLikeProject(item.path)) continue;
    const path = normalize(item.path);
    map.set(path, { path, openedAt: item.openedAt });
  }
  if (currentCwd && looksLikeProject(currentCwd)) {
    const path = normalize(currentCwd);
    if (!map.has(path)) {
      map.set(path, { path, openedAt: Date.now() });
    }
  }
  return map;
}

/** Append new projects to the saved order without moving existing entries. */
export function syncProjectRailOrder(
  order: string[],
  projects: Map<string, RecentProject>,
): string[] {
  const paths = new Set(projects.keys());
  const next: string[] = [];
  const seen = new Set<string>();
  for (const path of order) {
    const normalized = normalize(path);
    if (!paths.has(normalized) || seen.has(normalized)) continue;
    seen.add(normalized);
    next.push(normalized);
  }
  const newcomers = [...paths]
    .filter((path) => !seen.has(path))
    .sort(
      (a, b) =>
        (projects.get(b)?.openedAt ?? 0) - (projects.get(a)?.openedAt ?? 0),
    );
  return [...next, ...newcomers];
}

export function projectRailSections(
  recents: RecentProject[],
  currentCwd: string,
  order: string[],
  pinnedPaths: string[],
): ProjectRailSections {
  const projects = collectRailProjects(recents, currentCwd);
  const syncedOrder = syncProjectRailOrder(order, projects);
  const pinnedSet = new Set(pinnedPaths.map(normalize));
  const pinned: RecentProject[] = [];
  const unpinned: RecentProject[] = [];
  for (const path of syncedOrder) {
    const item = projects.get(path);
    if (!item) continue;
    if (pinnedSet.has(path)) pinned.push(item);
    else unpinned.push(item);
  }
  return { pinned, projects: unpinned };
}

/** Recents plus the current folder when it is a project not yet remembered. */
export function projectRailItems(
  recents: RecentProject[],
  currentCwd: string,
): RecentProject[] {
  const projects = collectRailProjects(recents, currentCwd);
  const order = syncProjectRailOrder(loadProjectRailOrder(), projects);
  const { pinned, projects: unpinned } = projectRailSections(
    recents,
    currentCwd,
    order,
    loadPinnedProjects(),
  );
  return [...pinned, ...unpinned];
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
