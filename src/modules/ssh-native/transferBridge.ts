import type { RemoteWorkspaceEnv } from "@/modules/remote";
import { nativeHandleFor } from "./handles";
import { startTransfer, type JobSummary, type TransferEvent } from "./transfer";
import { useTransferQueue } from "./transferStore";
import { group } from "./transferPaths";

export type EnqueuedTransfer = {
  summary: JobSummary;
  /**
   * Settles when the job reaches a terminal state.
   *
   * Callers await it so a transfer still reports its outcome the way the
   * previous scp-backed one did. No surface renders the queue yet, so
   * resolving on start alone would leave the user with a spinner that never
   * ends.
   */
  done: Promise<void>;
};

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
        settle?.();
        break;
      case "failed":
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
      // behind a prompt no surface renders yet.
      policy: "overwrite",
    },
    onEvent,
  );
  useTransferQueue.getState().upsert(summary);
  return { summary, done };
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
