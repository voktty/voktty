import { invoke } from "@tauri-apps/api/core";
import { RemoteRequestError, requestRemoteResult } from "@/modules/remote/client";
import { liveRemoteSessionId } from "@/modules/remote/sessionAliases";
import { recoverLostRemoteSession } from "@/modules/remote/sessionManager";
import { isSessionLostError } from "@/modules/remote/sessionPool";
import { terminalRestoreProject } from "@/modules/tabs/lib/terminalProjectRestore";
import type { WorkspaceEnv } from "@/modules/workspace";
import type { FeedRequest, FeedResponse } from "./types";

type SshEnv = Extract<WorkspaceEnv, { kind: "ssh" }>;

export type FeedTarget =
  | { kind: "local"; root: string; project: string }
  | { kind: "ssh"; root: string; project: string; host: string; env: SshEnv };

export type FeedTargetProblem = "noProject" | "disconnected" | "unsupported";

function lastSegment(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/** Where the feed reads from: the active window's project and environment. */
export function feedTargetFor(
  root: string | null,
  env: WorkspaceEnv,
): FeedTarget | FeedTargetProblem {
  if (!root) return "noProject";
  const remote = root.startsWith("remote://")
    ? terminalRestoreProject(root)
    : undefined;
  if (root.startsWith("remote://") && !remote) return "noProject";
  const path = remote?.hostPath ?? root;
  if (env.kind === "local") {
    return remote
      ? "unsupported"
      : { kind: "local", root: path, project: lastSegment(path) };
  }
  if (env.kind === "ssh") {
    if (env.sessionId == null) return "disconnected";
    return {
      kind: "ssh",
      root: path,
      project: lastSegment(path),
      host: env.connection.name || env.connection.host,
      env,
    };
  }
  return "unsupported";
}

export class FeedSourceError extends Error {
  constructor(
    readonly reason: "helperOutdated" | "disconnected" | "failed",
    message: string,
  ) {
    super(message);
    this.name = "FeedSourceError";
  }
}

/** One poll. Follows a reconnected SSH session and recovers a lost one. */
export async function pollFeed(
  target: FeedTarget,
  request: FeedRequest,
): Promise<FeedResponse> {
  if (target.kind === "local") {
    try {
      return await invoke<FeedResponse>("agent_feed_poll", { request });
    } catch (error) {
      throw new FeedSourceError("failed", String(error));
    }
  }
  const ask = (sessionId: number) =>
    requestRemoteResult<FeedResponse>(sessionId, "agentFeed.poll", request);
  const sessionId = liveRemoteSessionId(target.env.sessionId as number);
  try {
    return await ask(sessionId);
  } catch (error) {
    if (error instanceof RemoteRequestError && error.code === "method_not_found")
      throw new FeedSourceError("helperOutdated", error.message);
    if (!isSessionLostError(error))
      throw new FeedSourceError("failed", String(error));
    try {
      const recovered = await recoverLostRemoteSession(
        sessionId,
        target.env.connection.id,
        target.env.connection,
        target.env.root,
      );
      return await ask(recovered.session_id);
    } catch (retry) {
      throw new FeedSourceError("disconnected", String(retry));
    }
  }
}
