import {
  parseRemotePath,
  remoteProjectForPath,
  REMOTE_PROJECTS_CHANGED,
  type RemoteProject,
} from "@/modules/connections/model/remoteProjects";
import { findSshProfile } from "@/modules/connections/model/remoteSshProfiles";
import { usePreferencesStore } from "@/modules/settings/preferences";
import type { SshConnection } from "@/modules/ssh/types";

let indexClient:
  | Promise<typeof import("@/modules/connections/model/remoteCommands")>
  | undefined;

function loadIndexClient() {
  if (indexClient) return indexClient;
  const request = import("@/modules/connections/model/remoteCommands").catch(
    (error) => {
      if (indexClient === request) indexClient = undefined;
      throw error;
    },
  );
  indexClient = request;
  return request;
}

export class ProjectFileSourceRetiredError extends Error {
  constructor() {
    super("Project file index request was retired.");
  }
}

export function assertProjectFileSourceCurrent(isCurrent: () => boolean): void {
  if (!isCurrent()) throw new ProjectFileSourceRetiredError();
}

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

export type ProjectFileSource = Readonly<{
  key: string;
  isCurrent: () => boolean;
  retire: () => void;
  indexFiles: (
    isCurrent: () => boolean,
  ) => Promise<import("@/modules/harness/lib/fs").ProjectFile[]>;
  listFiles: (
    isCurrent: () => boolean,
  ) => Promise<{ files: string[]; truncated: boolean }>;
  request: (
    query: string,
    showHidden: boolean,
    isCurrent: () => boolean,
  ) => Promise<unknown>;
}>;
const sources = new WeakMap<ProjectFileSource, string>();

export function captureProjectFileSource(
  path: string,
): ProjectFileSource | null {
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
    indexFiles: async (callerCurrent: () => boolean) => {
      const allowed = () => isCurrent() && callerCurrent();
      assertProjectFileSourceCurrent(allowed);
      try {
        const { readCapturedProjectIndex } = await loadIndexClient();
        assertProjectFileSourceCurrent(allowed);
        const files = await readCapturedProjectIndex(
          captured.path,
          captured.project,
          captured.profile,
          allowed,
        );
        assertProjectFileSourceCurrent(allowed);
        return files;
      } catch (error) {
        assertProjectFileSourceCurrent(allowed);
        throw error;
      }
    },
    listFiles: async (callerCurrent: () => boolean) => {
      const allowed = () => isCurrent() && callerCurrent();
      if (!allowed()) throw new Error("File index retired.");
      const { createProjectDocument } = await import(
        "@/modules/remote/projectDocument"
      );
      if (!allowed()) throw new Error("File index retired.");
      return createProjectDocument(captured.path, captured.project, [
        captured.profile,
      ]).listFiles(allowed);
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

export function isProjectFileSource(
  source: ProjectFileSource,
  path: string,
): boolean {
  return sources.get(source) === path && source.isCurrent();
}

export function createProjectFileSourceStore(path: string) {
  let snapshot = { source: captureProjectFileSource(path) };
  const listeners = new Map<object, () => void>();
  let stop: (() => void) | undefined;
  const refresh = (force: boolean) => {
    const next = captureProjectFileSource(path);
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
