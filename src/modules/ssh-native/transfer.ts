import { invoke } from "@tauri-apps/api/core";
import { Channel } from "@tauri-apps/api/core";
import { SshNativeCallError } from "./client";
import { toSshNativeError } from "./adapt";
import type { SshErrorCode } from "./types";

/** Mirrors of the transfer DTOs in `ssh_native::sftp::transfer`. */

export type JobDirection = "upload" | "download";

export type ConflictPolicy = "ask" | "overwrite" | "skip" | "rename" | "resume";

export type JobState =
  | "queued"
  | "running"
  | "paused"
  | "awaitingDecision"
  | "completed"
  | "failed"
  | "cancelled";

export type TransferStep = {
  source: string;
  destination: string;
  size: number;
  isDir: boolean;
};

export type TransferProgress = {
  bytesDone: number;
  bytesTotal: number;
  filesDone: number;
  filesTotal: number;
  bytesPerSecond?: number;
  secondsRemaining?: number;
};

export type JobSummary = {
  id: string;
  direction: JobDirection;
  state: JobState;
  sourceRoot: string;
  destinationRoot: string;
  policy: ConflictPolicy;
  error?: string;
};

export type TransferRequest = {
  direction: JobDirection;
  sourceRoot: string;
  destinationRoot: string;
  /** Names relative to `sourceRoot`. Empty means the whole root. */
  items?: string[];
  policy?: ConflictPolicy;
};

export type TransferEvent =
  | { kind: "progress"; jobId: string; progress: TransferProgress }
  | { kind: "needsDecision"; jobId: string; step: TransferStep }
  | { kind: "finished"; jobId: string; skipped: number }
  | { kind: "failed"; jobId: string; code: SshErrorCode; message: string }
  | { kind: "cancelled"; jobId: string };

/** A state the job will not leave on its own. */
export function isTerminal(state: JobState): boolean {
  return state === "completed" || state === "failed" || state === "cancelled";
}

export function isActive(state: JobState): boolean {
  return state === "running" || state === "awaitingDecision";
}

async function call<T>(command: string, args: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw new SshNativeCallError(toSshNativeError(error));
  }
}

export function startTransfer(
  handle: string,
  request: TransferRequest,
  onEvent: (event: TransferEvent) => void,
): Promise<JobSummary> {
  const channel = new Channel<TransferEvent>();
  channel.onmessage = onEvent;
  return call("ssh_native_transfer_start", { handle, request, onEvent: channel });
}

/**
 * Answer a conflict. The policy applies to the rest of the job, and `ask` is
 * refused by Rust because it would stop again on the same file.
 */
export function decideTransfer(
  handle: string,
  jobId: string,
  policy: Exclude<ConflictPolicy, "ask">,
  onEvent: (event: TransferEvent) => void,
): Promise<JobSummary> {
  const channel = new Channel<TransferEvent>();
  channel.onmessage = onEvent;
  return call("ssh_native_transfer_decide", {
    handle,
    jobId,
    policy,
    onEvent: channel,
  });
}

export function cancelTransfer(jobId: string): Promise<JobSummary> {
  return call("ssh_native_transfer_cancel", { jobId });
}

export function listTransfers(): Promise<JobSummary[]> {
  return call("ssh_native_transfer_list", {});
}

export function transferProgress(jobId: string): Promise<TransferProgress | null> {
  return call("ssh_native_transfer_progress", { jobId });
}
