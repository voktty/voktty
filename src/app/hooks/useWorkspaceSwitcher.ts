import { native } from "@/modules/ai/lib/native";
import { t } from "@/modules/i18n";
import { closeRemoteWorkspace, openRemoteWorkspace } from "@/modules/remote";
import type { Tab } from "@/modules/tabs";
import {
  getWslHome,
  LOCAL_WORKSPACE,
  useWorkspaceEnvStore,
  type WorkspaceEnv,
  workspaceScopeKey,
} from "@/modules/workspace";
import { homeDir } from "@tauri-apps/api/path";
import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  reusableWorkspaceEnv,
  sameRemoteHost,
  sameWorkspace,
} from "./workspaceActivation";

async function resolveEnvHome(env: WorkspaceEnv): Promise<string> {
  if (env.kind === "ssh") return env.root;
  return env.kind === "wsl"
    ? getWslHome(env.distro)
    : (await homeDir()).replace(/\\/g, "/");
}

async function connectRemoteEnv(
  env: Extract<WorkspaceEnv, { kind: "ssh" }>,
): Promise<Extract<WorkspaceEnv, { kind: "ssh" }>> {
  const session = await openRemoteWorkspace(
    env.connection,
    env.root || undefined,
  );
  return {
    ...env,
    root: session.workspace_root,
    sessionId: session.session_id,
  };
}

async function closeRemoteEnv(env: WorkspaceEnv): Promise<void> {
  if (env.kind === "ssh" && env.sessionId !== undefined) {
    await closeRemoteWorkspace(env.sessionId).catch(() => {});
  }
}

function workspaceTarget(env: WorkspaceEnv): string {
  return env.kind === "ssh"
    ? env.connection.name || env.connection.host
    : env.kind;
}

type Params = {
  tabsRef: RefObject<Tab[]>;
  workspaceEnv: WorkspaceEnv;
  setWorkspaceEnv: (env: WorkspaceEnv) => void;
  resetWorkspace: (home?: string, env?: WorkspaceEnv) => void;
  /** Dispose live sessions and clear App-owned pane/handle ref maps. */
  clearWorkspaceState: () => void;
};

/**
 * Owns the resolved home / launch cwd. switchWorkspace runs an interactive
 * local⇄WSL switch (tears down sessions, re-authorizes home, resets tabs).
 * activateWorkspaceEnv changes the active tab context without tearing down
 * another tab's remote session.
 */
export function useWorkspaceSwitcher({
  tabsRef,
  workspaceEnv,
  setWorkspaceEnv,
  resetWorkspace,
  clearWorkspaceState,
}: Params) {
  const [home, setHome] = useState<string | null>(null);
  const [launchCwd, setLaunchCwd] = useState<string | null>(null);
  // Keep the host paths stable while `home`/`launchCwd` follow the active
  // workspace. They are needed when a remote space becomes empty or when a
  // new space is created from a remote one.
  const [localHome, setLocalHome] = useState<string | null>(null);
  const [localLaunchCwd, setLocalLaunchCwd] = useState<string | null>(null);
  const [launchCwdResolved, setLaunchCwdResolved] = useState(false);
  const activationGenerationRef = useRef(0);
  const activationRequestsRef = useRef(new Map<string, number>());

  useEffect(() => {
    homeDir()
      .then(async (p) => {
        const normalized = p.replace(/\\/g, "/");
        if (
          normalized === "/data/user/0" ||
          normalized === "/data/data" ||
          normalized === "/" ||
          normalized === "/data" ||
          normalized.endsWith("/0")
        ) {
          return;
        }
        setLocalHome(normalized);
        setHome((current) => current ?? normalized);
        try {
          await native.workspaceAuthorize(normalized);
        } catch {
          // Bootstrap already authorizes home from Rust; ignore.
        }
      })
      .catch(() => setHome(null));
  }, []);

  useEffect(() => {
    native
      .workspaceCurrentDir()
      .then((cwd) => {
        setLocalLaunchCwd(cwd);
        setLaunchCwd((current) => current ?? cwd);
        setLocalHome((current) => current ?? cwd);
        setHome((current) => current ?? cwd);
      })
      .catch(() => setLaunchCwd(null))
      .finally(() => setLaunchCwdResolved(true));
  }, []);

  const authorizeHome = useCallback(
    async (nextHome: string, isRemote: boolean) => {
      setHome(nextHome);
      setLaunchCwd(nextHome);
      if (isRemote) return;
      try {
        await native.workspaceAuthorize(nextHome);
      } catch {
        // Non-fatal — git panel will surface "not authorized" if needed.
      }
    },
    [],
  );

  const switchWorkspace = useCallback(
    async (env: WorkspaceEnv): Promise<WorkspaceEnv | null> => {
      activationGenerationRef.current += 1;
      const isConnectedRemote =
        env.kind === "ssh" &&
        workspaceEnv.kind === "ssh" &&
        workspaceEnv.sessionId !== undefined;
      if (
        sameWorkspace(env, workspaceEnv) &&
        (env.kind !== "ssh" || isConnectedRemote)
      ) {
        return null;
      }
      const dirty = tabsRef.current.some((t) => t.kind === "editor" && t.dirty);
      if (dirty) {
        window.alert(t("feedback.unsavedBeforeWorkspaceSwitch"));
        return null;
      }

      let prepared = env;
      const target = workspaceTarget(env);
      if (env.kind === "ssh") {
        useWorkspaceEnvStore.getState().beginConnection(env, target);
      }
      try {
        if (env.kind === "ssh") prepared = await connectRemoteEnv(env);
      } catch (e) {
        useWorkspaceEnvStore
          .getState()
          .failConnection(
            env,
            target,
            e instanceof Error ? e.message : String(e),
          );
        window.alert(String(e));
        return null;
      }

      clearWorkspaceState();
      await closeRemoteEnv(workspaceEnv);
      setWorkspaceEnv(prepared.kind === "local" ? LOCAL_WORKSPACE : prepared);
      const nextHome = await resolveEnvHome(prepared);
      await authorizeHome(nextHome, prepared.kind === "ssh");
      if (env.kind === "ssh") {
        useWorkspaceEnvStore.getState().clearConnection(env);
      }
      resetWorkspace(nextHome, prepared);
      return prepared;
    },
    [
      workspaceEnv,
      setWorkspaceEnv,
      resetWorkspace,
      tabsRef,
      clearWorkspaceState,
      authorizeHome,
    ],
  );

  const adoptWorkspaceEnv = useCallback(
    async (env: WorkspaceEnv): Promise<WorkspaceEnv | null> => {
      activationGenerationRef.current += 1;
      let prepared = env;
      const target = workspaceTarget(env);
      if (env.kind === "ssh") {
        useWorkspaceEnvStore.getState().beginConnection(env, target);
      }
      try {
        if (env.kind === "ssh") prepared = await connectRemoteEnv(env);
      } catch (error) {
        useWorkspaceEnvStore
          .getState()
          .failConnection(
            env,
            target,
            error instanceof Error ? error.message : String(error),
          );
        return null;
      }
      await closeRemoteEnv(workspaceEnv);
      setWorkspaceEnv(prepared.kind === "local" ? LOCAL_WORKSPACE : prepared);
      let nextHome: string;
      try {
        nextHome = await resolveEnvHome(prepared);
      } catch {
        return null;
      }
      await authorizeHome(nextHome, prepared.kind === "ssh");
      if (env.kind === "ssh") {
        useWorkspaceEnvStore.getState().clearConnection(env);
      }
      return prepared;
    },
    [workspaceEnv, setWorkspaceEnv, authorizeHome],
  );

  const activateWorkspaceEnv = useCallback(
    async (env: WorkspaceEnv): Promise<WorkspaceEnv | null> => {
      const reusable = reusableWorkspaceEnv(env, workspaceEnv);
      if (reusable) {
        useWorkspaceEnvStore.getState().clearConnection(env);
        return reusable;
      }
      const generation = activationGenerationRef.current;
      const resourceKey = workspaceScopeKey(env);
      const requestId =
        (activationRequestsRef.current.get(resourceKey) ?? 0) + 1;
      activationRequestsRef.current.set(resourceKey, requestId);
      const isCurrentRequest = () =>
        activationGenerationRef.current === generation &&
        activationRequestsRef.current.get(resourceKey) === requestId;
      let prepared = env;
      const target = workspaceTarget(env);
      if (env.kind === "ssh") {
        useWorkspaceEnvStore.getState().beginConnection(env, target);
      }
      try {
        if (
          env.kind === "ssh" &&
          workspaceEnv.kind === "ssh" &&
          sameRemoteHost(env.connection, workspaceEnv.connection) &&
          workspaceEnv.sessionId !== undefined
        ) {
          prepared = {
            ...env,
            sessionId: workspaceEnv.sessionId,
          };
        } else if (env.kind === "ssh" && env.sessionId === undefined) {
          prepared = await connectRemoteEnv(env);
        }
      } catch (err) {
        if (!isCurrentRequest()) return null;
        const msg = err instanceof Error ? err.message : String(err);
        useWorkspaceEnvStore.getState().failConnection(env, target, msg);
        throw err;
      }

      let nextHome: string;
      try {
        nextHome = await resolveEnvHome(prepared);
      } catch {
        if (prepared !== workspaceEnv) await closeRemoteEnv(prepared);
        return null;
      }
      if (!isCurrentRequest()) {
        if (prepared !== workspaceEnv) await closeRemoteEnv(prepared);
        return null;
      }

      setWorkspaceEnv(prepared.kind === "local" ? LOCAL_WORKSPACE : prepared);
      await authorizeHome(nextHome, prepared.kind === "ssh");
      if (env.kind === "ssh") {
        useWorkspaceEnvStore.getState().clearConnection(env);
      }
      return prepared;
    },
    [workspaceEnv, setWorkspaceEnv, authorizeHome],
  );

  return {
    home,
    launchCwd,
    localHome,
    localLaunchCwd,
    launchCwdResolved,
    switchWorkspace,
    activateWorkspaceEnv,
    adoptWorkspaceEnv,
  };
}
