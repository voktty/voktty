import { create } from "zustand";
import type {
  JobSummary,
  TransferEvent,
  TransferProgress,
  TransferStep,
} from "./transfer";
import { isTerminal } from "./transfer";

export type QueueEntry = {
  summary: JobSummary;
  progress?: TransferProgress;
  /** The file the run stopped on, present only while awaiting a decision. */
  conflict?: TransferStep;
  skipped?: number;
};

type State = {
  jobs: QueueEntry[];
};

type Actions = {
  upsert: (summary: JobSummary) => void;
  apply: (event: TransferEvent) => void;
  forget: (jobId: string) => void;
  clearFinished: () => void;
  reset: () => void;
};

/**
 * Pure reducer over the queue.
 *
 * An event for a job the store has never seen is dropped rather than
 * inventing a half-populated row: the summary from `start` always arrives
 * first, and a stray event means the job belongs to another window.
 */
export function reduce(jobs: QueueEntry[], event: TransferEvent): QueueEntry[] {
  const index = jobs.findIndex((entry) => entry.summary.id === event.jobId);
  if (index === -1) return jobs;

  const current = jobs[index];
  const next = applyToEntry(current, event);
  if (next === current) return jobs;

  const updated = jobs.slice();
  updated[index] = next;
  return updated;
}

function applyToEntry(entry: QueueEntry, event: TransferEvent): QueueEntry {
  // A terminal job never moves again, so a late event from a run that was
  // already cancelled cannot resurrect it.
  if (isTerminal(entry.summary.state) && event.kind !== "progress") {
    return entry;
  }

  switch (event.kind) {
    case "progress":
      return isTerminal(entry.summary.state)
        ? entry
        : { ...entry, progress: event.progress };
    case "needsDecision":
      return {
        ...entry,
        summary: { ...entry.summary, state: "awaitingDecision" },
        conflict: event.step,
      };
    case "finished":
      return {
        ...entry,
        summary: { ...entry.summary, state: "completed" },
        conflict: undefined,
        skipped: event.skipped,
      };
    case "failed":
      return {
        ...entry,
        summary: { ...entry.summary, state: "failed", error: event.message },
        conflict: undefined,
      };
    case "cancelled":
      return {
        ...entry,
        summary: { ...entry.summary, state: "cancelled" },
        conflict: undefined,
      };
  }
}

export function upsertJob(jobs: QueueEntry[], summary: JobSummary): QueueEntry[] {
  const index = jobs.findIndex((entry) => entry.summary.id === summary.id);
  if (index === -1) return [...jobs, { summary }];

  const updated = jobs.slice();
  updated[index] = { ...updated[index], summary };
  return updated;
}

export const useTransferQueue = create<State & Actions>((set) => ({
  jobs: [],
  upsert: (summary) => set((state) => ({ jobs: upsertJob(state.jobs, summary) })),
  apply: (event) => set((state) => ({ jobs: reduce(state.jobs, event) })),
  forget: (jobId) =>
    set((state) => ({
      jobs: state.jobs.filter((entry) => entry.summary.id !== jobId),
    })),
  clearFinished: () =>
    set((state) => ({
      jobs: state.jobs.filter((entry) => !isTerminal(entry.summary.state)),
    })),
  reset: () => set({ jobs: [] }),
}));
