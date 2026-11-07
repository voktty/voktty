import type { RemoteWorkspaceEnv } from "@/modules/remote";
import { openRemoteTunnel } from "@/modules/remote/client";

type Tunnel = { tunnelId: number; localPort: number };
type OpenTunnel = (
  sessionId: number,
  remotePort: number,
  preferredLocalPort?: number,
) => Promise<Tunnel>;

const tunnels = new Map<string, Promise<Tunnel>>();
const launches = new Set<string>();

const key = (sessionId: number, remotePort: number) =>
  `${sessionId}:${remotePort}`;

/**
 * One tunnel per remote session and port. Reopening the same preview reuses
 * it instead of spending one of the session's few tunnel slots; a failed open
 * is forgotten so the next attempt starts clean.
 */
export function ensurePreviewTunnel(
  sessionId: number,
  remotePort: number,
  open: OpenTunnel = openRemoteTunnel,
): Promise<{ url: string; localPort: number }> {
  const id = key(sessionId, remotePort);
  let pending = tunnels.get(id);
  if (!pending) {
    pending = open(sessionId, remotePort, remotePort);
    tunnels.set(id, pending);
    pending.catch(() => {
      if (tunnels.get(id) === pending) tunnels.delete(id);
    });
  }
  return pending.then((tunnel) => ({
    localPort: tunnel.localPort,
    url: `http://127.0.0.1:${tunnel.localPort}`,
  }));
}

/** Forget every tunnel of a session that has ended; the native side closes them. */
export function forgetPreviewTunnels(sessionId: number): void {
  const prefix = `${sessionId}:`;
  for (const id of [...tunnels.keys()]) {
    if (id.startsWith(prefix)) tunnels.delete(id);
  }
  for (const id of [...launches]) {
    if (id.startsWith(prefix)) launches.delete(id);
  }
  for (const [port, target] of [...remoteTargets]) {
    if (target.sessionId === sessionId) remoteTargets.delete(port);
  }
}

/** The preview itself typed the command that serves this port. */
export function markPreviewLaunch(sessionId: number, remotePort: number): void {
  launches.add(key(sessionId, remotePort));
}

export function wasLaunchedByPreview(
  sessionId: number,
  remotePort: number,
): boolean {
  return launches.has(key(sessionId, remotePort));
}

export function resetPreviewTunnels(): void {
  remoteTargets.clear();
  tunnels.clear();
  launches.clear();
}

export type RemotePreviewTarget = {
  /** Session whose files the page is built from. */
  sessionId: number;
  /** Project folder on the host; null when it is not known. */
  root: string | null;
  env: RemoteWorkspaceEnv;
};

const remoteTargets = new Map<number, RemotePreviewTarget>();

/** Remember which remote project a tunneled local port shows. */
export function registerRemotePreview(
  localPort: number,
  target: RemotePreviewTarget,
): void {
  remoteTargets.set(localPort, target);
}

function loopbackPort(url: string): number | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:") return null;
    if (!["127.0.0.1", "localhost"].includes(parsed.hostname)) return null;
    const port = Number(parsed.port);
    return Number.isInteger(port) && port > 0 ? port : null;
  } catch {
    return null;
  }
}

export function remotePreviewForUrl(url: string): RemotePreviewTarget | null {
  const port = loopbackPort(url);
  return port === null ? null : (remoteTargets.get(port) ?? null);
}

/** A file saved on a host belongs to the page when it lies in the project folder. */
export function saveAffectsRemotePreview(
  url: string,
  save: { sessionId: number; path: string },
): boolean {
  const target = remotePreviewForUrl(url);
  if (!target || target.sessionId !== save.sessionId) return false;
  if (target.root === null) return true;
  const root = target.root.replace(/\/+$/, "");
  return save.path === root || save.path.startsWith(`${root}/`);
}
