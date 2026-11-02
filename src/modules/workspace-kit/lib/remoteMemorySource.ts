import type { WorkspaceEnv } from "@/modules/workspace/env";
import type { MemoryPanelTarget } from "@/modules/workspace-kit/lib/memoryPanel";
import {
  parseRemotePath,
  remotePath,
  remoteProjectForPath,
  REMOTE_PROJECTS_CHANGED,
} from "@/modules/connections/model/remoteProjects";
import {
  findSshProfile,
  remoteSshConnectionForProfile,
} from "@/modules/connections/model/remoteSshProfiles";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { normalizedRemoteSessionConnection } from "@/modules/remote/sessionConnectionIdentity";

export function memoryFailure(code: string): never {
  throw Object.assign(new Error(`Project memory ${code}`), { code });
}

function directory(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 4096 &&
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !/[\\\x00-\x1f\x7f]/.test(value) &&
    value.split("/").length <= 129 &&
    !value.split("/").some((part) => part === "." || part === "..")
  );
}
const within = (root: string, path: string) =>
  path === root || path.startsWith(root === "/" ? "/" : `${root}/`);

function resolve(target: MemoryPanelTarget) {
  if (target.path.startsWith("remote://")) {
    if (
      (target.environment.kind !== "local" &&
        target.environment.kind !== "ssh") ||
      /[\\\x00-\x1f\x7f]/.test(target.path)
    )
      memoryFailure("unsupported");
    const parsed = parseRemotePath(target.path);
    const project = remoteProjectForPath(target.path);
    if (
      !parsed ||
      !project ||
      project.environmentId !== parsed.environmentId ||
      !directory(parsed.hostPath) ||
      !directory(project.cwd)
    )
      memoryFailure("unsupported");
    const root = project.cwd.replace(/\/+$/, "") || "/";
    if (!within(root, parsed.hostPath)) memoryFailure("denied");
    const profile = findSshProfile(
      parsed.environmentId,
      usePreferencesStore.getState().sshConnections ?? [],
      { kind: "local" },
    );
    if (!profile) memoryFailure("unsupported");
    const connection = normalizedRemoteSessionConnection(
      remoteSshConnectionForProfile(profile),
    );
    const env = target.environment;
    if (
      env.kind === "ssh" &&
      (env.connection.id !== profile.id ||
        !directory(env.root) ||
        !within(env.root.replace(/\/+$/, "") || "/", root) ||
        JSON.stringify(normalizedRemoteSessionConnection(env.connection)) !==
          JSON.stringify(connection))
    )
      memoryFailure("denied");
    return {
      profileId: profile.id,
      connection,
      root,
      path: parsed.hostPath,
      environmentId: parsed.environmentId,
      identity: JSON.stringify([project, profile.id, connection]),
    };
  }
  const env = target.environment;
  if (env.kind !== "ssh" || !directory(env.root) || !directory(target.path))
    memoryFailure("unsupported");
  const root = env.root.replace(/\/+$/, "") || "/";
  if (!within(root, target.path)) memoryFailure("denied");
  const connection = normalizedRemoteSessionConnection(env.connection);
  if (!env.connection.id || !connection.host) memoryFailure("invalidInput");
  return {
    profileId: env.connection.id,
    connection,
    root,
    path: target.path,
    environmentId: null,
    identity: JSON.stringify([env.connection.id, root, connection]),
  };
}

export function captureRemoteMemorySource(target: MemoryPanelTarget) {
  const captured = structuredClone(target);
  const source = resolve(captured);
  let retired = false;
  function observe() {
    if (retired || source.environmentId === null) return;
    try {
      if (resolve(captured).identity !== source.identity) retired = true;
    } catch {
      retired = true;
    }
  }
  const unsubscribe =
    source.environmentId === null
      ? () => undefined
      : usePreferencesStore.subscribe(observe);
  if (source.environmentId !== null && typeof window !== "undefined")
    window.addEventListener(REMOTE_PROJECTS_CHANGED, observe);
  return {
    key: Object.freeze({ profileId: source.profileId, root: source.root }),
    connection: source.connection,
    check() {
      observe();
      if (retired) memoryFailure("cancelled");
    },
    checkSelection(path: unknown, environment: unknown) {
      if (
        path !== captured.path ||
        !environment ||
        typeof environment !== "object"
      )
        memoryFailure("denied");
      const actual = environment as WorkspaceEnv;
      if (source.environmentId !== null) {
        if (captured.environment.kind === "local") {
          if (actual.kind !== "local") memoryFailure("denied");
        } else if (
          actual.kind !== "ssh" ||
          !actual.connection ||
          actual.connection.id !== source.profileId ||
          actual.root !==
            (captured.environment as Extract<WorkspaceEnv, { kind: "ssh" }>)
              .root ||
          JSON.stringify(
            normalizedRemoteSessionConnection(actual.connection),
          ) !== JSON.stringify(source.connection)
        )
          memoryFailure("denied");
      } else if (
        actual.kind !== "ssh" ||
        !actual.connection ||
        actual.connection.id !== source.profileId ||
        actual.root !==
          (captured.environment as Extract<WorkspaceEnv, { kind: "ssh" }>)
            .root ||
        JSON.stringify(normalizedRemoteSessionConnection(actual.connection)) !==
          JSON.stringify(source.connection)
      )
        memoryFailure("denied");
      return source.path;
    },
    hostRoot(root: unknown) {
      if (typeof root !== "string") memoryFailure("unavailable");
      const host =
        source.environmentId === null ? root : parseRemotePath(root)?.hostPath;
      if (
        !host ||
        !directory(host) ||
        !within(source.root, host) ||
        (source.environmentId !== null &&
          parseRemotePath(root)?.environmentId !== source.environmentId)
      )
        memoryFailure("denied");
      return host;
    },
    displayRoot(root: unknown) {
      if (
        typeof root !== "string" ||
        !directory(root) ||
        !within(source.root, root)
      )
        memoryFailure("denied");
      const path =
        source.environmentId === null
          ? root
          : remotePath(source.environmentId, root);
      if (path.length > 4096) memoryFailure("limit");
      return path;
    },
    dispose() {
      retired = true;
      unsubscribe();
      if (typeof window !== "undefined")
        window.removeEventListener(REMOTE_PROJECTS_CHANGED, observe);
    },
  };
}

export type RemoteMemorySource = ReturnType<typeof captureRemoteMemorySource>;
