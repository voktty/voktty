import type { RemoteWorkspaceEnv } from "@/modules/remote";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { defaultCredentials, toSshNativeError, toTarget } from "./adapt";
import { sftpClose, sftpOpen, sshNativeConnect, sshNativeDisconnect } from "./client";
import type { SshNativeError } from "./types";

/**
 * A workspace either has a usable native handle or a recorded reason why not.
 *
 * The failure is kept rather than thrown: the explorer must keep working on the
 * helper, but the user turned the preference on and deserves to see why the
 * native path is not serving them.
 */
export type NativeHandleState =
  | { kind: "ready"; handle: string; sessionId: string; root: string }
  | { kind: "unavailable"; error: SshNativeError };

/** Identity of the connection, not of the helper session, which is ephemeral. */
export function workspaceKey(env: RemoteWorkspaceEnv): string {
  const { host, port, user } = env.connection;
  return `${user ?? ""}@${host}:${port ?? 22}${env.root}`;
}

const states = new Map<string, Promise<NativeHandleState>>();

/**
 * Resolve the workspace's native handle, opening one at most once per
 * workspace. Concurrent callers share the same in-flight attempt, so a burst of
 * listings cannot open a burst of sessions.
 */
export function ensureNativeHandle(
  env: RemoteWorkspaceEnv,
): Promise<NativeHandleState> {
  const key = workspaceKey(env);
  const existing = states.get(key);
  if (existing) return existing;

  const attempt = openHandle(env).catch(
    (error): NativeHandleState => ({
      kind: "unavailable",
      error: toSshNativeError(error),
    }),
  );
  states.set(key, attempt);
  return attempt;
}

async function openHandle(env: RemoteWorkspaceEnv): Promise<NativeHandleState> {
  const connection = env.connection;
  const session = await sshNativeConnect(
    toTarget(connection),
    defaultCredentials(connection),
  );
  try {
    const opened = await sftpOpen(session.id, env.root);
    return {
      kind: "ready",
      handle: opened.handle,
      sessionId: session.id,
      root: opened.root,
    };
  } catch (error) {
    // The session is useless without its channel, so it does not outlive it.
    await sshNativeDisconnect(session.id).catch(() => undefined);
    throw error;
  }
}

/** The handle to use for this workspace, or nothing when the helper serves it. */
export async function nativeHandleFor(
  env: RemoteWorkspaceEnv,
): Promise<string | undefined> {
  const backend = usePreferencesStore.getState().remoteFilesystemBackend;
  if (backend !== "native") return undefined;
  const state = await ensureNativeHandle(env);
  return state.kind === "ready" ? state.handle : undefined;
}

export async function releaseNativeHandle(env: RemoteWorkspaceEnv): Promise<void> {
  const key = workspaceKey(env);
  const pending = states.get(key);
  if (!pending) return;
  states.delete(key);

  const state = await pending;
  if (state.kind !== "ready") return;
  await sftpClose(state.handle).catch(() => undefined);
  await sshNativeDisconnect(state.sessionId).catch(() => undefined);
}

/** Every workspace that has been attempted, for the settings surface. */
export function nativeHandleKeys(): string[] {
  return [...states.keys()];
}

export function resetNativeHandles(): void {
  states.clear();
}
