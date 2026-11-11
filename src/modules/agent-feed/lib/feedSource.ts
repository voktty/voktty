import { invoke } from "@tauri-apps/api/core";
import { RemoteRequestError, requestRemoteResult } from "@/modules/remote/client";
import { liveRemoteSessionId } from "@/modules/remote/sessionAliases";
import { recoverLostRemoteSession } from "@/modules/remote/sessionManager";
import { isSessionLostError } from "@/modules/remote/sessionPool";
import { terminalRestoreProject } from "@/modules/tabs/lib/terminalProjectRestore";
import type { WorkspaceEnv } from "@/modules/workspace";
import type { FeedRequest, FeedResponse } from "./types";

type SshEnv = Extract<WorkspaceEnv, { kind: "ssh" }>;

/** `root` and `project` are null when the window has no project folder. */
export type FeedTarget =
  | { kind: "local"; root: string | null; project: string | null }
  | {
      kind: "ssh";
      root: string | null;
      project: string | null;
      host: string;
      env: SshEnv;
    };

export type FeedTargetProblem = "disconnected" | "unsupported";

function lastSegment(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/** Where the feed reads from: the active window's project and environment. */
export function feedTargetFor(
  root: string | null,
  env: WorkspaceEnv,
): FeedTarget | FeedTargetProblem {
  const remote = root?.startsWith("remote://")
    ? terminalRestoreProject(root)
    : undefined;
  const path = root?.startsWith("remote://") ? (remote?.hostPath ?? null) : root;
  const project = path ? lastSegment(path) : null;
  if (env.kind === "local") {
    return remote
      ? "unsupported"
      : { kind: "local", root: path, project };
  }
  if (env.kind === "ssh") {
    if (env.sessionId == null) return "disconnected";
    return {
      kind: "ssh",
      root: path,
      project,
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

/**
 * One poll. Follows a reconnected SSH session and, unless `recover` is
 * false, reopens a lost one. The background watcher passes false: it reads
 * only connections a tab keeps open and never opens one itself.
 */
export async function pollFeed(
  target: FeedTarget,
  request: FeedRequest,
  { recover = true }: { recover?: boolean } = {},
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
    if (!recover) throw new FeedSourceError("disconnected", String(error));
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
