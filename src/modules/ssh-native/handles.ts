import type { RemoteWorkspaceEnv } from "@/modules/remote";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { requestSshPrompt } from "@/modules/ssh/promptQueue";
import { defaultCredentials, hostKeyPrompt, toSshNativeError, toTarget } from "./adapt";
import { sftpClose, sftpOpen, sshNativeConnect, sshNativeDisconnect } from "./client";
import type { HostKeyApproval, SshCredential, SshNativeError } from "./types";

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
  const { host, port, user, identityFile, extraArgs } = env.connection;
  return JSON.stringify([env.connection.id, user, host, port ?? 22, identityFile, extraArgs, env.root]);
}

const RETRY_DELAY_MS = 15_000;
const states = new Map<string, { attempt: Promise<NativeHandleState>; retryAt: number; remoteSessionId?: number }>();

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
  if (existing && Date.now() < existing.retryAt) return existing.attempt;

  const attempt = openHandle(env).catch(
    (error): NativeHandleState => ({
      kind: "unavailable",
      error: toSshNativeError(error),
    }),
  );
  const entry = { attempt, retryAt: Number.POSITIVE_INFINITY, remoteSessionId: env.sessionId };
  states.set(key, entry);
  void attempt.then((result) => {
    if (states.get(key) === entry && result.kind === "unavailable") {
      entry.retryAt = Date.now() + RETRY_DELAY_MS;
    }
  });
  return attempt;
}

async function openHandle(env: RemoteWorkspaceEnv): Promise<NativeHandleState> {
  const connection = env.connection;
  const target = toTarget(connection);
  let credentials: SshCredential[] = defaultCredentials(connection);
  let approval: HostKeyApproval = { kind: "none" };
  let session;
  try {
    session = await sshNativeConnect(target, credentials, approval);
  } catch (failure) {
    const error = toSshNativeError(failure);
    const prompt = hostKeyPrompt(error);
    if (!prompt || error.code === "host_key_revoked" || prompt.host !== target.host) {
      if (error.code !== "auth_failed") throw failure;
    } else {
      const message = `${prompt.changed ? "WARNING: SSH host key changed" : "Unknown SSH host key"}\n${prompt.host}:${prompt.port}\n${prompt.keyType} ${prompt.fingerprint}\n\nTrust this key?`;
      if (await requestSshPrompt(message, true) !== "yes") throw failure;
      approval = { kind: "approve", keyBase64: prompt.keyBase64, remember: true };
    }
    try {
      session = await sshNativeConnect(target, credentials, approval);
    } catch (retryFailure) {
      if (toSshNativeError(retryFailure).code !== "auth_failed") throw retryFailure;
      if (connection.identityFile) {
        const passphrase = await requestSshPrompt(`Passphrase for ${connection.identityFile}`, false);
        if (passphrase !== null) {
          credentials = credentials.map((credential) => credential.kind === "privateKey"
            ? { ...credential, passphrase }
            : credential);
          try {
            session = await sshNativeConnect(target, credentials, approval);
          } catch (passphraseFailure) {
            if (toSshNativeError(passphraseFailure).code !== "auth_failed") throw passphraseFailure;
          }
        }
      }
      if (!session) {
        const password = await requestSshPrompt(`Password for ${connection.user ?? "user"}@${connection.host}`, false);
        if (password === null) throw retryFailure;
        session = await sshNativeConnect(target, [{ kind: "password", secret: password }], approval);
      }
    }
  }
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

  const state = await pending.attempt;
  if (state.kind !== "ready") return;
  await sftpClose(state.handle).catch(() => undefined);
  await sshNativeDisconnect(state.sessionId).catch(() => undefined);
}

export async function releaseNativeHandlesForRemoteSession(sessionId: number): Promise<void> {
  const entries = [...states.entries()].filter(([, entry]) => entry.remoteSessionId === sessionId);
  await Promise.all(entries.map(async ([key, entry]) => {
    if (states.get(key) !== entry) return;
    states.delete(key);
    const state = await entry.attempt;
    if (state.kind !== "ready") return;
    await sftpClose(state.handle).catch(() => undefined);
    await sshNativeDisconnect(state.sessionId).catch(() => undefined);
  }));
}

/** Every workspace that has been attempted, for the settings surface. */
export function nativeHandleKeys(): string[] {
  return [...states.keys()];
}

export function resetNativeHandles(): void {
  states.clear();
}
