import {
  parseRemotePath,
  remoteProjectForPath,
  REMOTE_PROJECTS_CHANGED,
  type RemoteProject,
} from "@/modules/connections/model/remoteProjects";
import { findSshProfile } from "@/modules/connections/model/remoteSshProfiles";
import { usePreferencesStore } from "@/modules/settings/preferences";
import type { SshConnection } from "@/modules/ssh/types";

type Target = {
  path: string;
  project: Readonly<RemoteProject>;
  profile: Readonly<SshConnection>;
  key: string;
};

function posixPath(path: string): boolean {
  return (
    path.length <= 32768 &&
    path.startsWith("/") &&
    !path.startsWith("//") &&
    !/[\\\x00]/.test(path) &&
    !path.split("/").some((part) => part === "." || part === "..")
  );
}

function target(path: string): Target | null {
  try {
    if (path.length > 32768 || /[\\\x00]/.test(path)) return null;
    const parsed = parseRemotePath(path);
    if (!parsed || !posixPath(parsed.hostPath)) return null;
    const project = remoteProjectForPath(path);
    if (
      !project ||
      project.environmentId !== parsed.environmentId ||
      typeof project.cwd !== "string" ||
      !posixPath(project.cwd) ||
      typeof project.key !== "string" ||
      project.key.length > 32768 ||
      typeof project.projectId !== "string" ||
      project.projectId.length > 32768
    )
      return null;
    const root = project.cwd.replace(/\/+$/, "") || "/";
    const prefix = root === "/" ? "/" : `${root}/`;
    if (parsed.hostPath !== root && !parsed.hostPath.startsWith(prefix))
      return null;
    const saved = findSshProfile(
      parsed.environmentId,
      usePreferencesStore.getState().sshConnections ?? [],
      { kind: "local" },
    );
    if (!saved || JSON.stringify(saved).length > 32768) return null;
    const profile = Object.freeze({
      id: saved.id,
      name: saved.name,
      host: saved.host,
      user: saved.user,
      port: saved.port,
      identityFile: saved.identityFile,
      extraArgs: saved.extraArgs,
      initialDirectory: saved.initialDirectory,
    });
    const captured = Object.freeze({
      key: project.key,
      projectId: project.projectId,
      environmentId: project.environmentId,
      cwd: root,
    });
    return {
      path,
      project: captured,
      profile,
      key: JSON.stringify([path, captured, profile]),
    };
  } catch {
    return null;
  }
}

export type ProjectFilenameSource = Readonly<{
  key: string;
  isCurrent: () => boolean;
  retire: () => void;
  request: (
    query: string,
    showHidden: boolean,
    isCurrent: () => boolean,
  ) => Promise<unknown>;
}>;
const sources = new WeakMap<ProjectFilenameSource, string>();

export function captureProjectFilenameSearch(
  path: string,
): ProjectFilenameSource | null {
  const captured = target(path);
  if (!captured) return null;
  let current = true;
  const isCurrent = () => current && target(path)?.key === captured.key;
  const source = Object.freeze({
    key: captured.key,
    isCurrent,
    retire: () => {
      current = false;
    },
    request: async (
      query: string,
      showHidden: boolean,
      callerCurrent: () => boolean,
    ) => {
      const allowed = () => isCurrent() && callerCurrent();
      if (!allowed()) throw new Error("Filename search retired.");
      const { createProjectDocument } = await import(
        "@/modules/remote/projectDocument"
      );
      if (!allowed()) throw new Error("Filename search retired.");
      return createProjectDocument(captured.path, captured.project, [
        captured.profile,
      ]).searchNames(query, showHidden, allowed);
    },
  });
  sources.set(source, path);
  return source;
}

export function isProjectFilenameSource(
  source: ProjectFilenameSource,
  path: string,
): boolean {
  return sources.get(source) === path && source.isCurrent();
}

export function createProjectFilenameSearchStore(path: string) {
  let snapshot = { source: captureProjectFilenameSearch(path) };
  const listeners = new Map<object, () => void>();
  let stop: (() => void) | undefined;
  const refresh = (force: boolean) => {
    const next = captureProjectFilenameSearch(path);
    if (!force && next?.key === snapshot.source?.key) return;
    snapshot.source?.retire();
    snapshot = { source: next };
    for (const [receipt, listener] of [...listeners])
      if (listeners.get(receipt) === listener) listener();
  };
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      if (listeners.size >= 256)
        throw new Error("Filename search listener capacity exceeded.");
      const receipt = {};
      listeners.set(receipt, listener);
      if (!stop) {
        let current = true;
        const changed = () => {
          if (current) refresh(false);
        };
        let unsubscribe = () => {};
        const cleanup = () => {
          current = false;
          try {
            unsubscribe();
          } finally {
            window.removeEventListener(REMOTE_PROJECTS_CHANGED, changed);
          }
        };
        stop = cleanup;
        try {
          unsubscribe = usePreferencesStore.subscribe((next, previous) => {
            if (next.sshConnections !== previous.sshConnections) changed();
          });
          window.addEventListener(REMOTE_PROJECTS_CHANGED, changed);
          refresh(true);
        } catch (error) {
          listeners.delete(receipt);
          if (stop === cleanup) {
            stop = undefined;
            snapshot.source?.retire();
            cleanup();
          }
          throw error;
        }
      }
      return () => {
        if (!listeners.delete(receipt)) return;
        if (!listeners.size) {
          snapshot.source?.retire();
          const cleanup = stop;
          stop = undefined;
          cleanup?.();
        }
      };
    },
  };
}
