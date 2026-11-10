import { isPathInWorkspace } from "@/modules/remote";
import { isRemoteProjectUri } from "@/modules/explorer/lib/remoteProjectDir";
import {
  currentWorkspaceEnv,
  isWindowsNativePath,
  LOCAL_WORKSPACE,
  type WorkspaceEnv,
} from "@/modules/workspace";
import { invoke } from "@tauri-apps/api/core";
import { liveRemoteSessionId } from "@/modules/remote/sessionAliases";
import { onRemoteSessionRecovered } from "@/modules/remote/sessionManager";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

const FS_CHANGED_EVENT = "fs:changed";

export type FsChangedPayload = { paths: string[]; sessionId?: number };

/**
 * Remote watches per live helper session, counted the way they were added.
 * A lost session takes its watches with it, so recovery registers the same
 * paths on the replacement and the explorer keeps updating live.
 */
const remoteWatches = new Map<number, Map<string, number>>();
const remoteTreeWatches = new Map<number, Map<string, number>>();

function track(
  table: Map<number, Map<string, number>>,
  sessionId: number,
  paths: readonly string[],
  delta: 1 | -1,
): void {
  const counts = table.get(sessionId) ?? new Map<string, number>();
  for (const path of paths) {
    const next = (counts.get(path) ?? 0) + delta;
    if (next > 0) counts.set(path, next);
    else counts.delete(path);
  }
  if (counts.size > 0) table.set(sessionId, counts);
  else table.delete(sessionId);
}

function moveWatches(
  table: Map<number, Map<string, number>>,
  lostId: number,
  sessionId: number,
): Map<string, number> | undefined {
  const lost = table.get(lostId);
  if (!lost) return undefined;
  table.delete(lostId);
  const counts = table.get(sessionId) ?? new Map<string, number>();
  for (const [path, count] of lost)
    counts.set(path, (counts.get(path) ?? 0) + count);
  table.set(sessionId, counts);
  return lost;
}

onRemoteSessionRecovered((lostId, sessionId) => {
  const paths = moveWatches(remoteWatches, lostId, sessionId);
  if (paths) {
    for (const [path, count] of paths) {
      for (let index = 0; index < count; index += 1) {
        void invoke("remote_watch_add", { sessionId, paths: [path] }).catch(
          () => {},
        );
      }
    }
  }
  const trees = moveWatches(remoteTreeWatches, lostId, sessionId);
  if (trees) {
    for (const [root, count] of trees) {
      for (let index = 0; index < count; index += 1) {
        void invoke("remote_watch_add_tree", { root, sessionId }).catch(
          () => {},
        );
      }
    }
  }
});

export function isNetworkFilesystemPath(path: string): boolean {
  return /^[/\\]{2}[^/\\]/.test(path);
}

export function normalizeWorkspaceEventPath(
  path: string,
  workspace: WorkspaceEnv,
): string {
  if (workspace.kind !== "wsl") return path;
  const normalized = path.replace(/\\/g, "/");
  const root = `//wsl$/${workspace.distro}`;
  const lower = normalized.toLowerCase();
  const lowerRoot = root.toLowerCase();
  if (lower === lowerRoot) return "/";
  if (lower.startsWith(`${lowerRoot}/`)) {
    return `/${normalized.slice(root.length + 1)}`;
  }
  return path;
}

export function watchAdd(
  paths: string[],
  workspace: WorkspaceEnv = currentWorkspaceEnv(),
): void {
  if (paths.length === 0) return;
  const workspacePaths: string[] = [];
  const localPaths: string[] = [];
  for (const p of paths) {
    if (isRemoteProjectUri(p)) continue;
    if (workspace.kind !== "local" && isPathInWorkspace(workspace, p)) {
      workspacePaths.push(p);
    } else {
      if (!isNetworkFilesystemPath(p)) localPaths.push(p);
    }
  }
  if (localPaths.length > 0) {
    void invoke("fs_watch_add", {
      paths: localPaths,
      workspace: LOCAL_WORKSPACE,
    }).catch(() => {});
  }
  if (workspacePaths.length > 0 && workspace.kind === "wsl") {
    void invoke("fs_watch_add", {
      paths: workspacePaths,
      workspace,
    }).catch(() => {});
  }
  if (
    workspacePaths.length > 0 &&
    workspace.kind === "ssh" &&
    workspace.sessionId !== undefined
  ) {
    const sessionId = liveRemoteSessionId(workspace.sessionId);
    track(remoteWatches, sessionId, workspacePaths, 1);
    void invoke("remote_watch_add", {
      sessionId,
      paths: workspacePaths,
    }).catch(() => {});
  }
}

export function watchRemove(
  paths: string[],
  workspace: WorkspaceEnv = currentWorkspaceEnv(),
): void {
  if (paths.length === 0) return;
  const workspacePaths: string[] = [];
  const localPaths: string[] = [];
  for (const p of paths) {
    if (isRemoteProjectUri(p)) continue;
    if (workspace.kind !== "local" && isPathInWorkspace(workspace, p)) {
      workspacePaths.push(p);
    } else {
      localPaths.push(p);
    }
  }
  if (localPaths.length > 0) {
    void invoke("fs_watch_remove", {
      paths: localPaths,
      workspace: LOCAL_WORKSPACE,
    }).catch(() => {});
  }
  if (workspacePaths.length > 0 && workspace.kind === "wsl") {
    void invoke("fs_watch_remove", {
      paths: workspacePaths,
      workspace,
    }).catch(() => {});
  }
  if (
    workspacePaths.length > 0 &&
    workspace.kind === "ssh" &&
    workspace.sessionId !== undefined
  ) {
    const sessionId = liveRemoteSessionId(workspace.sessionId);
    track(remoteWatches, sessionId, workspacePaths, -1);
    void invoke("remote_watch_remove", {
      sessionId,
      paths: workspacePaths,
    }).catch(() => {});
  }
}

/**
 * Whole-tree watch for a repo root (git diff/review surfaces): every
 * non-skipped directory under it, kept current server-side as
 * subdirectories come and go.
 */
export function watchAddTree(
  root: string,
  workspace: WorkspaceEnv = currentWorkspaceEnv(),
): void {
  if (isRemoteProjectUri(root)) return;
  if (workspace.kind === "local") {
    if (isNetworkFilesystemPath(root)) return;
    void invoke("fs_watch_add_tree", {
      root,
      workspace: LOCAL_WORKSPACE,
    }).catch(() => {});
  } else if (workspace.kind === "ssh" && workspace.sessionId !== undefined) {
    const sessionId = liveRemoteSessionId(workspace.sessionId);
    track(remoteTreeWatches, sessionId, [root], 1);
    void invoke("remote_watch_add_tree", {
      root,
      sessionId,
    }).catch(() => {});
  }
}

export function watchRemoveTree(
  root: string,
  workspace: WorkspaceEnv = currentWorkspaceEnv(),
): void {
  if (isRemoteProjectUri(root)) return;
  if (workspace.kind === "local") {
    void invoke("fs_watch_remove_tree", {
      root,
      workspace: LOCAL_WORKSPACE,
    }).catch(() => {});
  } else if (workspace.kind === "ssh" && workspace.sessionId !== undefined) {
    const sessionId = liveRemoteSessionId(workspace.sessionId);
    track(remoteTreeWatches, sessionId, [root], -1);
    void invoke("remote_watch_remove_tree", {
      root,
      sessionId,
    }).catch(() => {});
  }
}

/**
 * Is `path` the tree root or somewhere under it? Case-insensitive so a
 * Windows drive-letter casing difference (`C:` vs `c:`) never breaks live
 * updates; on case-sensitive filesystems both sides come from the same
 * canonicalization pipeline, so an actual casing collision isn't expected.
 */
export function isPathWithinTree(path: string, root: string): boolean {
  const normalize = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
  const normalizedRoot = normalize(root).toLowerCase();
  if (!normalizedRoot) return false;
  const normalizedPath = normalize(path).toLowerCase();
  return (
    normalizedPath === normalizedRoot ||
    normalizedPath.startsWith(`${normalizedRoot}/`)
  );
}

export function matchesWatchEvent(
  event: FsChangedPayload,
  workspace: WorkspaceEnv,
): boolean {
  if (event.sessionId === undefined) return workspace.kind !== "ssh";
  return (
    workspace.kind === "ssh" &&
    workspace.sessionId !== undefined &&
    liveRemoteSessionId(workspace.sessionId) === event.sessionId
  );
}

/**
 * The event paths a listener in `workspace` should see. `watchAdd` sends local
 * Windows drive and UNC paths to the local watcher even while the Space is on
 * SSH, so their events must reach that listener too; any other local event
 * stays out, because its POSIX path could collide with a remote one.
 */
export function watchEventPaths(
  event: FsChangedPayload,
  workspace: WorkspaceEnv,
): string[] {
  if (matchesWatchEvent(event, workspace)) {
    return event.paths.map((path) =>
      normalizeWorkspaceEventPath(path, workspace),
    );
  }
  if (event.sessionId === undefined && workspace.kind === "ssh") {
    return event.paths.filter(isWindowsNativePath);
  }
  return [];
}

export function listenFsChanged(
  handler: (paths: string[]) => void,
  workspace: WorkspaceEnv = currentWorkspaceEnv(),
): Promise<() => void> {
  return getCurrentWebviewWindow().listen<FsChangedPayload>(
    FS_CHANGED_EVENT,
    (event) => {
      const paths = watchEventPaths(event.payload, workspace);
      if (paths.length > 0) handler(paths);
    },
  );
}

export function parentDir(path: string): string {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (i <= 0) return path.slice(0, i + 1) || path;
  return path.slice(0, i);
}
