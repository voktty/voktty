import type { WorkspaceEnv } from "@/modules/workspace";
import { ensurePreviewTunnel, wasLaunchedByPreview } from "./previewTunnels";
import { portOfUrl } from "./remoteServer";

export type CaptureTarget = {
  url: string;
  /** Load through the inspector proxy: the page is remote and served by us. */
  inspectViaProxy: boolean;
};

type Deps = {
  leafEnv: (leafId: number) => WorkspaceEnv | undefined;
  tunnel: typeof ensurePreviewTunnel;
  launched: typeof wasLaunchedByPreview;
};

export function isRemoteCapture(
  leafId: number,
  leafEnv: Deps["leafEnv"],
): boolean {
  const env = leafEnv(leafId);
  return env?.kind === "ssh" && env.sessionId !== undefined;
}

/**
 * Where a captured dev server can actually be reached. A server that a remote
 * terminal prints as `localhost:<port>` lives on that host, so it needs an SSH
 * tunnel. Pages the preview served itself (PHP, no hot reload socket) go
 * through the inspector proxy; other remote dev servers load directly so their
 * hot reload keeps working.
 */
export async function resolveCaptureTarget(
  capture: { leafId: number; url: string },
  deps: Deps,
): Promise<CaptureTarget> {
  const env = deps.leafEnv(capture.leafId);
  if (env?.kind !== "ssh" || env.sessionId === undefined) {
    return { url: capture.url, inspectViaProxy: false };
  }
  const remotePort = portOfUrl(capture.url);
  if (remotePort === null) {
    return { url: capture.url, inspectViaProxy: false };
  }
  const tunnel = await deps.tunnel(env.sessionId, remotePort);
  return {
    url: tunnel.url,
    inspectViaProxy: deps.launched(env.sessionId, remotePort),
  };
}
