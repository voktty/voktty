import type { RemoteWorkspaceEnv } from "@/modules/remote";
import { nativeHandleFor } from "./handles";
import {
  decideTransfer,
  isTerminal,
  startTransfer,
  type ConflictPolicy,
  type JobSummary,
  type TransferEvent,
} from "./transfer";
import { useTransferQueue } from "./transferStore";
import { group } from "./transferPaths";

export type EnqueuedTransfer = {
  summary: JobSummary;
  /**
   * Settles when the job reaches a terminal state.
   *
   * Callers await it so a transfer still reports its outcome the way the
   * previous scp-backed one did, rather than resolving the moment the job is
   * queued.
   */
  done: Promise<void>;
};

type Live = {
  handle: string;
  onEvent: (event: TransferEvent) => void;
};

/**
 * Which handle started each job, and the listener that settles its promise.
 *
 * Answering a conflict opens a second channel for the same job, so both the
 * handle and the original listener have to survive past `start`.
 */
const live = new Map<string, Live>();

/**
 * Hand a selection to the native transfer queue.
 *
 * Resolves to `undefined` when the native backend is not serving this
 * workspace, so the caller keeps its existing behaviour instead of silently
 * doing nothing.
 */
async function enqueue(
  env: RemoteWorkspaceEnv,
  direction: "upload" | "download",
  paths: string[],
  destinationRoot: string,
  sourceIsLocal: boolean,
): Promise<EnqueuedTransfer | undefined> {
  const handle = await nativeHandleFor(env);
  if (handle === undefined) return undefined;

  const grouped = group(paths, sourceIsLocal);
  if (!grouped) return undefined;

  let settle: (() => void) | undefined;
  let reject: ((error: Error) => void) | undefined;
  const done = new Promise<void>((resolve, fail) => {
    settle = resolve;
    reject = fail;
  });

  const onEvent = (event: TransferEvent) => {
    useTransferQueue.getState().apply(event);
    switch (event.kind) {
      case "finished":
      case "cancelled":
        live.delete(event.jobId);
        settle?.();
        break;
      case "failed":
        live.delete(event.jobId);
        reject?.(new Error(event.message));
        break;
      default:
        break;
    }
  };

  const summary = await startTransfer(
    handle,
    {
      direction,
      sourceRoot: grouped.root,
      destinationRoot,
      items: grouped.items,
      // Overwriting matches what the scp path did. Asking would park the job
      // behind a prompt the queue panel only shows once it is mounted.
      policy: "overwrite",
    },
    onEvent,
  );

  if (isTerminal(summary.state)) {
    settle?.();
  } else {
    live.set(summary.id, { handle, onEvent });
  }
  useTransferQueue.getState().upsert(summary);
  return { summary, done };
}

/**
 * Answer a conflict from the queue panel.
 *
 * Silently does nothing for a job this window did not start, since the handle
 * that owns it lives with whoever did.
 */
export async function decideTransferConflict(
  jobId: string,
  policy: Exclude<ConflictPolicy, "ask">,
): Promise<void> {
  const entry = live.get(jobId);
  if (!entry) return;

  const summary = await decideTransfer(entry.handle, jobId, policy, entry.onEvent);
  useTransferQueue.getState().upsert(summary);
}

export function enqueueDownload(
  env: RemoteWorkspaceEnv,
  remotePaths: string[],
  localDirectory: string,
): Promise<EnqueuedTransfer | undefined> {
  return enqueue(env, "download", remotePaths, localDirectory, false);
}

export function enqueueUpload(
  env: RemoteWorkspaceEnv,
  localPaths: string[],
  remoteDirectory: string,
): Promise<EnqueuedTransfer | undefined> {
  return enqueue(env, "upload", localPaths, remoteDirectory, true);
}

/** Test seam: the map is module state and would leak between cases. */
export function resetTransferBridge(): void {
  live.clear();
}
