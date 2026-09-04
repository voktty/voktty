import {
  beginConnectionAttempt,
  IDLE_CONNECTION_STATE,
  type ResourceConnectionState,
  settleConnectionAttempt,
} from "@/modules/connections/lifecycle";
import { setLastWslDistro } from "@/modules/settings/store";
import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";

export type SshConnectionConfig = {
  host: string;
  user?: string;
  port?: number;
  identityFile?: string;
  extraArgs?: string;
  initialDirectory?: string;
  multiplexerMode?: "none" | "auto" | "tmux" | "screen" | "ask";
  tmuxSessionName?: string;
  activeMultiplexerSession?: string;
  multiplexerAction?: "auto" | "attach" | "attach_force" | "grouped" | "new";
};

export type SshWorkspaceConnection = SshConnectionConfig & {
  id: string;
  name: string;
};

export type SerialConnectionConfig = {
  portName: string;
  baudRate: number;
  dataBits?: 5 | 6 | 7 | 8;
  flowControl?: "none" | "software" | "hardware";
  parity?: "none" | "odd" | "even";
  stopBits?: 1 | 2;
};

export type DockerWorkspaceConnection = {
  containerId: string;
  containerName: string;
  image: string;
  shell?: string;
  user?: string;
  workdir?: string;
};

export type WorkspaceEnv =
  | { kind: "local" }
  | { kind: "wsl"; distro: string }
  | {
      kind: "ssh";
      connection: SshWorkspaceConnection;
      root: string;
      sessionId?: number;
    }
  | ({
      kind: "serial";
    } & SerialConnectionConfig)
  | {
      kind: "docker";
      connection: DockerWorkspaceConnection;
    };

export type NativePtyWorkspaceEnv =
  | Exclude<WorkspaceEnv, { kind: "docker" }>
  | ({ kind: "docker" } & DockerWorkspaceConnection);

export type WslDistro = {
  name: string;
  default: boolean;
  running: boolean;
};

export type WorkspaceConnectionAttempt = {
  key: string;
  target: string;
  env: WorkspaceEnv;
  state: ResourceConnectionState;
  updatedAt: number;
};

type State = {
  env: WorkspaceEnv;
  distros: WslDistro[];
  loading: boolean;
  error: string | null;
  connectionAttempts: Record<string, WorkspaceConnectionAttempt>;
  setEnv: (env: WorkspaceEnv) => void;
  beginConnection: (env: WorkspaceEnv, target: string) => string;
  failConnection: (env: WorkspaceEnv, target: string, message: string) => void;
  clearConnection: (env: WorkspaceEnv) => void;
  refreshDistros: () => Promise<WslDistro[]>;
};

export const LOCAL_WORKSPACE: WorkspaceEnv = { kind: "local" };

export function isWslWorkspacePath(path: string): boolean {
  return path === "." || path.startsWith("/");
}

export function isWindowsNativePath(path: string): boolean {
  return /^[a-zA-Z]:[/\\]/.test(path) || /^[/\\]{2}/.test(path);
}

function normalizedWorkspacePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+/g, "/");
}

function sshWorkspaceOwnsPath(
  env: Extract<WorkspaceEnv, { kind: "ssh" }>,
  path: string,
): boolean {
  if (isWindowsNativePath(path)) return false;
  const root = normalizedWorkspacePath(env.root).replace(/\/+$/, "") || "/";
  const candidate = normalizedWorkspacePath(path);
  if (candidate === "." || candidate === root) return true;
  return candidate.startsWith(root === "/" ? "/" : `${root}/`);
}

/** Resolves the filesystem that owns a document at open time. */
export function workspaceForDocumentPath(
  env: WorkspaceEnv | undefined,
  path: string,
): WorkspaceEnv {
  if (!env || env.kind === "local" || isWindowsNativePath(path)) {
    return LOCAL_WORKSPACE;
  }
  if (env.kind === "wsl") {
    return isWslWorkspacePath(path) ? env : LOCAL_WORKSPACE;
  }
  if (env.kind === "ssh") {
    return sshWorkspaceOwnsPath(env, path) ? env : LOCAL_WORKSPACE;
  }
  return LOCAL_WORKSPACE;
}

function documentPathKey(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  return /^[a-zA-Z]:\//.test(normalized) || normalized.startsWith("//")
    ? normalized.toLocaleLowerCase("en-US")
    : normalized;
}

export function documentWorkspaceKey(
  env: WorkspaceEnv | undefined,
  path: string,
): string {
  const owner = workspaceForDocumentPath(env, path);
  return `${workspaceScopeKey(owner)}:${documentPathKey(path)}`;
}

export function workspaceForNativeFs(
  env: WorkspaceEnv | undefined,
  path: string,
): WorkspaceEnv {
  return env?.kind === "wsl" && isWslWorkspacePath(path)
    ? env
    : LOCAL_WORKSPACE;
}

export const useWorkspaceEnvStore = create<State>((set) => ({
  env: LOCAL_WORKSPACE,
  distros: [],
  loading: false,
  error: null,
  connectionAttempts: {},
  setEnv: (env) => {
    set({ env });
    if (env.kind === "wsl") void setLastWslDistro(env.distro);
  },
  beginConnection: (env, target) => {
    const key = workspaceScopeKey(env);
    set((state) => ({
      connectionAttempts: {
        ...state.connectionAttempts,
        [key]: {
          key,
          target,
          env,
          state: beginConnectionAttempt(
            state.connectionAttempts[key]?.state ?? IDLE_CONNECTION_STATE,
            "resolving",
          ),
          updatedAt: Date.now(),
        },
      },
    }));
    return key;
  },
  failConnection: (env, target, message) => {
    const key = workspaceScopeKey(env);
    set((current) => {
      const previous =
        current.connectionAttempts[key]?.state ??
        beginConnectionAttempt(IDLE_CONNECTION_STATE, "resolving");
      return {
        connectionAttempts: {
          ...current.connectionAttempts,
          [key]: {
            key,
            target,
            env,
            state: settleConnectionAttempt(
              previous,
              previous.attempt,
              "failed",
              message,
            ),
            updatedAt: Date.now(),
          },
        },
      };
    });
  },
  clearConnection: (env) => {
    const key = workspaceScopeKey(env);
    set((state) => {
      if (!(key in state.connectionAttempts)) return state;
      const connectionAttempts = { ...state.connectionAttempts };
      delete connectionAttempts[key];
      return { connectionAttempts };
    });
  },
  refreshDistros: async () => {
    set({ loading: true, error: null });
    try {
      const distros = await invoke<WslDistro[]>("wsl_list_distros");
      set({ distros, loading: false });
      return distros;
    } catch (e) {
      set({ distros: [], loading: false, error: String(e) });
      return [];
    }
  },
}));

export function currentWorkspaceEnv(): WorkspaceEnv {
  return useWorkspaceEnvStore.getState().env;
}

/** Adapts the UI-owned Docker connection object to Rust's flat enum variant. */
export function workspaceEnvForNativePty(
  env: WorkspaceEnv,
): NativePtyWorkspaceEnv {
  if (env.kind !== "docker") return env;
  return { kind: "docker", ...env.connection };
}

export function workspaceScopeKey(env: WorkspaceEnv): string {
  if (env.kind === "wsl") return `wsl:${env.distro}`;
  if (env.kind === "ssh") return `ssh:${env.connection.id}:${env.root}`;
  if (env.kind === "serial") return `serial:${env.portName}:${env.baudRate}`;
  if (env.kind === "docker") {
    return `docker:${env.connection.containerId}`;
  }
  return "local";
}

export function parseWorkspaceScopeKey(key: string): WorkspaceEnv {
  return key.startsWith("wsl:")
    ? { kind: "wsl", distro: key.slice("wsl:".length) }
    : LOCAL_WORKSPACE;
}

export function currentWorkspaceScopeKey(): string {
  return workspaceScopeKey(currentWorkspaceEnv());
}

export async function getWslHome(distro: string): Promise<string> {
  return invoke<string>("wsl_home", { distro });
}

export function persistentWorkspaceEnv(env: WorkspaceEnv): WorkspaceEnv {
  if (env.kind !== "ssh") return env;
  const { sessionId: _sessionId, ...persisted } = env;
  return persisted;
}
