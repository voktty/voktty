import { isPathInWorkspace } from "@/modules/remote";
import {
  currentWorkspaceEnv,
  LOCAL_WORKSPACE,
  type WorkspaceEnv,
} from "@/modules/workspace";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

const FS_CHANGED_EVENT = "fs:changed";

export type FsChangedPayload = { paths: string[]; sessionId?: number };

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
    if (isPathInWorkspace(workspace, p)) {
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
    void invoke("remote_watch_add", {
      sessionId: workspace.sessionId,
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
    if (isPathInWorkspace(workspace, p)) {
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
    void invoke("remote_watch_remove", {
      sessionId: workspace.sessionId,
      paths: workspacePaths,
    }).catch(() => {});
  }
}

export function matchesWatchEvent(
  event: FsChangedPayload,
  workspace: WorkspaceEnv,
): boolean {
  if (event.sessionId === undefined) return workspace.kind !== "ssh";
  return workspace.kind === "ssh" && workspace.sessionId === event.sessionId;
}

export function listenFsChanged(
  handler: (paths: string[]) => void,
  workspace: WorkspaceEnv = currentWorkspaceEnv(),
): Promise<() => void> {
  return getCurrentWebviewWindow().listen<FsChangedPayload>(
    FS_CHANGED_EVENT,
    (event) => {
      if (matchesWatchEvent(event.payload, workspace)) {
        handler(
          event.payload.paths.map((path) =>
            normalizeWorkspaceEventPath(path, workspace),
          ),
        );
      }
    },
  );
}

export function parentDir(path: string): string {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (i <= 0) return path.slice(0, i + 1) || path;
  return path.slice(0, i);
}
