import { listProjectFiles, type ProjectFile } from "./fs";
import { subscribeDirsChanged } from "./fileTree";
import { scorePath, type FuzzyHit } from "./fuzzy";
import { resolveWorkspacePath } from "./paths";
import { looksLikeProject } from "./recents";
import { normalizeEditorPath, type FileOpenOptions } from "./search";
import {
  assertProjectFileSourceCurrent,
  createProjectFileSourceStore,
  ProjectFileSourceRetiredError,
} from "@/modules/remote/projectFileSource";

const MAX_RECENTS = 30;
const MAX_RESULTS = 80;
const REFRESH_MS = 150;
const CACHE_LIMIT = 8;
const MAX_SCANS = 256;

type Listener = () => void;

const cache = new Map<string, ProjectFile[]>();
const inflight = new Map<string, Promise<ProjectFile[]>>();
type RemoteScope = {
  store: ReturnType<typeof createProjectFileSourceStore>;
  stop: () => void;
  scans: number;
  initializing: boolean;
};
const remoteScopes = new Map<string, RemoteScope>();
let activeScans = 0;
let lastCwd: string | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let refreshing = false;
let refreshAgain = false;
const listeners = new Set<Listener>();
const recentsByCwd = new Map<string, string[]>();

function releaseUnusedScope(cwd: string, scope = remoteScopes.get(cwd)) {
  if (
    !scope ||
    scope.scans ||
    cache.has(cwd) ||
    remoteScopes.get(cwd) !== scope
  )
    return;
  remoteScopes.delete(cwd);
  scope.stop();
}

function captureRemoteScope(cwd: string): RemoteScope {
  const existing = remoteScopes.get(cwd);
  if (existing) return existing;
  if (remoteScopes.size >= MAX_SCANS)
    throw new Error("Project file index capacity exceeded.");
  const scope: RemoteScope = {
    store: createProjectFileSourceStore(cwd),
    stop: () => {},
    scans: 0,
    initializing: true,
  };
  remoteScopes.set(cwd, scope);
  return scope;
}

function activateRemoteScope(cwd: string, scope: RemoteScope) {
  if (!scope.initializing) return;
  try {
    scope.stop = scope.store.subscribe(() => {
      if (scope.initializing || remoteScopes.get(cwd) !== scope) return;
      cache.delete(cwd);
      inflight.delete(cwd);
      recentsByCwd.delete(normCwd(cwd));
      try {
        notifyProjectFilesChanged();
      } catch {
        // A presentation listener cannot interrupt retirement of other sources.
      } finally {
        if (lastCwd === cwd) scheduleIndexRefresh();
        releaseUnusedScope(cwd, scope);
      }
    });
  } finally {
    scope.initializing = false;
  }
}

function normCwd(cwd: string): string {
  return cwd.replace(/\/+$/, "") || "/";
}

function notifyProjectFilesChanged() {
  for (const listener of listeners) listener();
}

export function subscribeProjectFiles(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function peekProjectFiles(cwd: string): ProjectFile[] | null {
  if (
    cwd.startsWith("remote://voktty-ssh-") &&
    !remoteScopes.get(cwd)?.store.getSnapshot().source?.isCurrent()
  )
    return null;
  return cache.get(cwd) ?? null;
}

export function invalidateProjectFiles(cwd?: string) {
  if (cwd) {
    if (!cache.has(cwd) && !inflight.has(cwd)) return;
    cache.delete(cwd);
    inflight.delete(cwd);
    releaseUnusedScope(cwd);
  } else {
    cache.clear();
    inflight.clear();
    for (const [path, scope] of remoteScopes) releaseUnusedScope(path, scope);
    lastCwd = null;
    if (refreshTimer != null) {
      clearTimeout(refreshTimer);
      refreshTimer = null;
    }
  }
  notifyProjectFilesChanged();
}

function scheduleIndexRefresh() {
  if (!lastCwd) return;
  if (typeof document !== "undefined" && document.hidden) return;
  if (refreshTimer != null) return;
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    void runIndexRefresh();
  }, REFRESH_MS);
}

async function runIndexRefresh() {
  if (refreshing) {
    refreshAgain = true;
    return;
  }
  const cwd = lastCwd;
  if (!cwd) return;
  refreshing = true;
  try {
    await loadProjectFiles(cwd, true);
  } catch {
    /* next focus / dir change will retry */
  } finally {
    refreshing = false;
    if (refreshAgain) {
      refreshAgain = false;
      scheduleIndexRefresh();
    }
  }
}

export function rememberOpenedFile(cwd: string, path: string) {
  if (!path) return;
  const key = normCwd(cwd);
  const prev = recentsByCwd.get(key) ?? [];
  recentsByCwd.set(
    key,
    [path, ...prev.filter((item) => item !== path)].slice(0, MAX_RECENTS),
  );
}

export function recentOpenedFiles(cwd: string): string[] {
  return recentsByCwd.get(normCwd(cwd)) ?? [];
}

export function prefetchProjectFiles(cwd: string) {
  if (!looksLikeProject(cwd)) return;
  void loadProjectFiles(cwd).catch(() => undefined);
}

export function loadProjectFiles(
  cwd: string,
  refresh = false,
): Promise<ProjectFile[]> {
  if (!looksLikeProject(cwd)) return Promise.resolve([]);
  lastCwd = cwd;
  let scope: RemoteScope | undefined;
  try {
    if (cwd.startsWith("remote://voktty-ssh-")) scope = captureRemoteScope(cwd);
  } catch (error) {
    return Promise.reject(error);
  }
  const opening = inflight.get(cwd);
  if (scope?.initializing && opening) return opening;
  let source = scope?.store.getSnapshot().source;
  if (scope && !source?.isCurrent()) {
    releaseUnusedScope(cwd, scope);
    return Promise.reject(
      new Error("Remote project file index is unavailable."),
    );
  }
  const cached = cache.get(cwd);
  if (!refresh && cached) {
    cache.delete(cwd);
    cache.set(cwd, cached);
    return Promise.resolve(cached);
  }
  const pending = inflight.get(cwd);
  if (!refresh && pending) return pending;
  if (activeScans >= MAX_SCANS) {
    releaseUnusedScope(cwd, scope);
    return Promise.reject(new Error("Project file index capacity exceeded."));
  }
  activeScans++;
  if (scope) scope.scans++;
  let accept!: (files: ProjectFile[]) => void;
  let reject!: (error: unknown) => void;
  const read = new Promise<ProjectFile[]>((resolve, fail) => {
    accept = resolve;
    reject = fail;
  });
  const promise = read
    .then((files) => {
      if (source) assertProjectFileSourceCurrent(source.isCurrent);
      // A refresh or invalidation supersedes only this checkout's scan.
      if (inflight.get(cwd) !== promise) return files;
      cache.delete(cwd);
      cache.set(cwd, files);
      if (cache.size > CACHE_LIMIT) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) {
          cache.delete(oldest);
          releaseUnusedScope(oldest);
        }
      }
      notifyProjectFilesChanged();
      if (source) assertProjectFileSourceCurrent(source.isCurrent);
      return files;
    })
    .finally(() => {
      activeScans--;
      if (scope) scope.scans--;
      if (inflight.get(cwd) === promise) inflight.delete(cwd);
      releaseUnusedScope(cwd, scope);
    });
  inflight.set(cwd, promise);
  try {
    if (scope?.initializing) {
      const key = source?.key;
      activateRemoteScope(cwd, scope);
      source = scope.store.getSnapshot().source;
      assertProjectFileSourceCurrent(() =>
        Boolean(source?.isCurrent() && source.key === key),
      );
    }
    const result = source
      ? source.indexFiles(source.isCurrent)
      : listProjectFiles(cwd);
    void Promise.resolve(result).then(accept, reject);
  } catch (error) {
    reject(error);
  }
  return promise;
}

export type RankedFile = ProjectFile & FuzzyHit;

export function rankProjectFiles(
  files: ProjectFile[],
  query: string,
  recents: string[],
  limit = MAX_RESULTS,
): RankedFile[] {
  const recentRank = new Map(recents.map((path, index) => [path, index]));

  if (!query.trim()) {
    const byPath = new Map(files.map((file) => [file.path, file]));
    const out: RankedFile[] = [];
    const seen = new Set<string>();
    for (const path of recents) {
      if (seen.has(path)) continue;
      seen.add(path);
      const file = byPath.get(path);
      if (!file) continue;
      out.push({ ...file, score: 0, positions: [] });
      if (out.length >= limit) break;
    }
    return out;
  }

  const scored: RankedFile[] = [];
  for (const file of files) {
    const hit = scorePath(query, file.relative, file.name);
    if (!hit) continue;
    const recency = recentRank.get(file.path);
    const score =
      hit.score + (recency == null ? 0 : (MAX_RECENTS - recency) * 8);
    scored.push({ ...file, score, positions: hit.positions });
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.relative.length !== b.relative.length) {
      return a.relative.length - b.relative.length;
    }
    return a.relative.localeCompare(b.relative);
  });
  return scored.slice(0, limit);
}

/** Resolve a transcript or markdown file link to an existing project file. */
export async function resolveOpenablePath(
  cwd: string,
  href: string,
): Promise<string | undefined> {
  const direct = resolveWorkspacePath(href, cwd);
  if (!direct) return undefined;

  let files: ProjectFile[];
  try {
    files = await loadProjectFiles(cwd);
  } catch (error) {
    if (error instanceof ProjectFileSourceRetiredError) throw error;
    // The index only disambiguates shortened paths. Let the editor read the
    // direct path and show its own error if that file is unavailable too.
    return direct;
  }
  if (files.length === 0) return direct;

  const byPath = new Map(
    files.map((file) => [normalizeEditorPath(file.path), file]),
  );
  const normalizedDirect = normalizeEditorPath(direct);
  const exact = byPath.get(normalizedDirect);
  if (exact) return exact.path;

  const relHint = relativePathHint(href, cwd, direct);
  const exactRelative = files.find(
    (file) =>
      file.relative === relHint ||
      normalizeEditorPath(file.relative) === relHint,
  );
  if (exactRelative) return exactRelative.path;

  const suffixMatches = files.filter(
    (file) =>
      file.relative === relHint ||
      file.relative.endsWith(`/${relHint}`) ||
      relHint.endsWith(file.relative),
  );
  if (suffixMatches.length === 1) return suffixMatches[0].path;

  const baseName = relHint.split("/").filter(Boolean).pop() ?? relHint;
  const byName = files.filter((file) => file.name === baseName);
  if (byName.length === 0) return direct;
  if (byName.length === 1) return byName[0].path;

  return pickOpenableFile(byName, cwd, relHint).path;
}

/** Resolve shortened references while preserving paths selected from file UI. */
export async function resolveFileOpenRequest(
  cwd: string,
  path: string,
  options?: FileOpenOptions,
): Promise<string> {
  if (options?.exact) return path;
  return (await resolveOpenablePath(cwd, path)) ?? path;
}

function relativePathHint(href: string, cwd: string, direct: string): string {
  let value = href.trim().replace(/\\/g, "/");
  value = value.replace(
    /(?::\d+(?::\d+)?|#L\d+(?:-L\d+)?)$/,
    "",
  );
  if (value.startsWith("file://")) {
    try {
      value = decodeURIComponent(value.slice("file://".length));
    } catch {
      value = value.slice("file://".length);
    }
    value = value.replace(/\\/g, "/");
  }
  value = value.replace(/^\.\//, "").replace(/^\/+/, "");

  const base = cwd.replace(/\\/g, "/").replace(/\/+$/, "");
  const normalizedDirect = normalizeEditorPath(direct);
  if (base && base !== "~" && normalizedDirect.startsWith(`${base}/`)) {
    return normalizedDirect.slice(base.length + 1);
  }
  return value;
}

function pickOpenableFile(
  candidates: ProjectFile[],
  cwd: string,
  relHint: string,
): ProjectFile {
  const recents = recentOpenedFiles(cwd);
  for (const recent of recents) {
    const normalizedRecent = normalizeEditorPath(recent);
    const hit = candidates.find(
      (file) => normalizeEditorPath(file.path) === normalizedRecent,
    );
    if (hit) return hit;
  }

  const suffixMatches = candidates.filter(
    (file) =>
      file.relative === relHint || file.relative.endsWith(`/${relHint}`),
  );
  if (suffixMatches.length > 0) {
    return suffixMatches.sort(
      (a, b) => a.relative.length - b.relative.length,
    )[0];
  }

  return candidates.sort((a, b) => a.relative.length - b.relative.length)[0];
}

subscribeDirsChanged(scheduleIndexRefresh);

if (typeof document !== "undefined") {
  const resume = () => {
    if (document.hidden) return;
    // External changes have no checkout-scoped notification.
    for (const cwd of new Set([...cache.keys(), ...inflight.keys()])) {
      if (cwd !== lastCwd) invalidateProjectFiles(cwd);
    }
    scheduleIndexRefresh();
  };
  window.addEventListener("focus", resume);
  document.addEventListener("visibilitychange", resume);
}
