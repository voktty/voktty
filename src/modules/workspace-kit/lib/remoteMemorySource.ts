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
      !directory(parsed.hostPath) ||
      (project &&
        (project.environmentId !== parsed.environmentId ||
          !directory(project.cwd))) ||
      (!project && target.environment.kind !== "ssh")
    )
      memoryFailure("unsupported");
    const env = target.environment;
    if (env.kind === "ssh" && !directory(env.root))
      memoryFailure("unsupported");
    const selectedRoot =
      project?.cwd ??
      (env.kind === "ssh" &&
      within(env.root.replace(/\/+$/, "") || "/", parsed.hostPath)
        ? env.root
        : parsed.hostPath);
    const root = selectedRoot.replace(/\/+$/, "") || "/";
    if (!within(root, parsed.hostPath)) memoryFailure("denied");
    const savedProfile = findSshProfile(
      parsed.environmentId,
      usePreferencesStore.getState().sshConnections ?? [],
      { kind: "local" },
    );
    const profile =
      savedProfile ??
      (env.kind === "ssh"
        ? findSshProfile(parsed.environmentId, [env.connection], {
            kind: "local",
          })
        : undefined);
    if (!profile) memoryFailure("unsupported");
    const connection = normalizedRemoteSessionConnection(
      remoteSshConnectionForProfile(profile),
    );
    if (
      env.kind === "ssh" &&
      (env.connection.id !== profile.id ||
        !directory(env.root) ||
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
      attachedRoot:
        env.kind === "ssh" && !within(env.root.replace(/\/+$/, "") || "/", root)
          ? env.root.replace(/\/+$/, "") || "/"
          : null,
      identity: JSON.stringify([
        project ?? null,
        profile.id,
        connection,
        root,
        savedProfile ? "saved" : "attached",
      ]),
    };
  }
  const env = target.environment;
  if (env.kind !== "ssh" || !directory(env.root) || !directory(target.path))
    memoryFailure("unsupported");
  const workspaceRoot = env.root.replace(/\/+$/, "") || "/";
  const root = within(workspaceRoot, target.path)
    ? workspaceRoot
    : target.path.replace(/\/+$/, "") || "/";
  const connection = normalizedRemoteSessionConnection(env.connection);
  if (!env.connection.id || !connection.host) memoryFailure("invalidInput");
  return {
    profileId: env.connection.id,
    connection,
    root,
    path: target.path,
    environmentId: null,
    attachedRoot: null,
    identity: JSON.stringify([
      env.connection.id,
      workspaceRoot,
      root,
      connection,
    ]),
  };
}

export function captureRemoteMemorySource(
  target: MemoryPanelTarget,
  onRetire?: () => void,
) {
  const captured = structuredClone(target);
  const source = resolve(captured);
  let retired = false;
  let canonicalRoot: string | null = null;
  const remap = (path: string, from: string, to: string) => {
    if (!within(from, path)) memoryFailure("denied");
    const suffix =
      path === from ? "" : path.slice(from === "/" ? 1 : from.length + 1);
    const result = suffix ? `${to === "/" ? "" : to}/${suffix}` : to;
    if (!directory(result)) memoryFailure("unavailable");
    return result;
  };
  function retire() {
    if (retired) return;
    retired = true;
    onRetire?.();
  }
  function observe() {
    if (retired || source.environmentId === null) return;
    try {
      if (resolve(captured).identity !== source.identity) retire();
    } catch {
      retire();
    }
  }
  const unsubscribe =
    source.environmentId === null
      ? () => undefined
      : usePreferencesStore.subscribe(observe);
  if (source.environmentId !== null && typeof window !== "undefined")
    window.addEventListener(REMOTE_PROJECTS_CHANGED, observe);
  return {
    selectionKey: JSON.stringify([captured.path, source.identity]),
    key: Object.freeze({ profileId: source.profileId, root: source.root }),
    connection: source.connection,
    bindRoot(root: string) {
      if (retired) memoryFailure("cancelled");
      if (!directory(root)) memoryFailure("unavailable");
      const normalized = root.replace(/\/+$/, "") || "/";
      if (canonicalRoot !== null && canonicalRoot !== normalized) {
        retire();
        memoryFailure("cancelled");
      }
      if (
        source.attachedRoot !== null &&
        !within(source.attachedRoot, normalized)
      ) {
        canonicalRoot = normalized;
        memoryFailure("denied");
      }
      canonicalRoot = normalized;
    },
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
      return remap(source.path, source.root, canonicalRoot ?? source.root);
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
      return remap(host, source.root, canonicalRoot ?? source.root);
    },
    displayRoot(root: unknown) {
      if (
        typeof root !== "string" ||
        !directory(root) ||
        !within(canonicalRoot ?? source.root, root)
      )
        memoryFailure("denied");
      const display = remap(root, canonicalRoot ?? source.root, source.root);
      const path =
        source.environmentId === null
          ? display
          : remotePath(source.environmentId, display);
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
