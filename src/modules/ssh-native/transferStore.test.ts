import { describe, expect, it } from "vitest";
import { reduce, upsertJob, type QueueEntry } from "./transferStore";
import type { JobSummary, TransferEvent, TransferStep } from "./transfer";

function summary(overrides: Partial<JobSummary> = {}): JobSummary {
  return {
    id: "transfer-1",
    direction: "download",
    state: "running",
    sourceRoot: "/srv",
    destinationRoot: "C:/tmp",
    policy: "ask",
    ...overrides,
  };
}

function entry(overrides: Partial<QueueEntry> = {}): QueueEntry {
  return { summary: summary(), ...overrides };
}

const step: TransferStep = {
  source: "/srv/a.txt",
  destination: "C:/tmp/a.txt",
  size: 10,
  isDir: false,
};

const progress = {
  bytesDone: 5,
  bytesTotal: 10,
  filesDone: 0,
  filesTotal: 1,
};

describe("upsertJob", () => {
  it("appends a job the queue has not seen", () => {
    const jobs = upsertJob([], summary());
    expect(jobs).toHaveLength(1);
    expect(jobs[0].summary.id).toBe("transfer-1");
  });

  it("replaces the summary of a job already there, keeping its progress", () => {
    const jobs = upsertJob([entry({ progress })], summary({ state: "paused" }));
    expect(jobs).toHaveLength(1);
    expect(jobs[0].summary.state).toBe("paused");
    expect(jobs[0].progress).toEqual(progress);
  });
});

describe("reduce", () => {
  it("drops an event for a job the queue never saw", () => {
    const jobs: QueueEntry[] = [];
    const event: TransferEvent = { kind: "progress", jobId: "ghost", progress };
    expect(reduce(jobs, event)).toBe(jobs);
  });

  it("records progress without touching the state", () => {
    const jobs = reduce([entry()], { kind: "progress", jobId: "transfer-1", progress });
    expect(jobs[0].progress).toEqual(progress);
    expect(jobs[0].summary.state).toBe("running");
  });

  it("parks the job on a conflict and keeps the offending file", () => {
    const jobs = reduce([entry()], {
      kind: "needsDecision",
      jobId: "transfer-1",
      step,
    });
    expect(jobs[0].summary.state).toBe("awaitingDecision");
    expect(jobs[0].conflict).toEqual(step);
  });

  it("clears the conflict once the job finishes", () => {
    const parked = reduce([entry()], {
      kind: "needsDecision",
      jobId: "transfer-1",
      step,
    });
    const done = reduce(parked, { kind: "finished", jobId: "transfer-1", skipped: 2 });
    expect(done[0].summary.state).toBe("completed");
    expect(done[0].conflict).toBeUndefined();
    expect(done[0].skipped).toBe(2);
  });

  it("keeps the message of a failure", () => {
    const jobs = reduce([entry()], {
      kind: "failed",
      jobId: "transfer-1",
      code: "unreachable",
      message: "link died",
    });
    expect(jobs[0].summary.state).toBe("failed");
    expect(jobs[0].summary.error).toBe("link died");
  });

  it("marks a cancellation without inventing an error", () => {
    const jobs = reduce([entry()], { kind: "cancelled", jobId: "transfer-1" });
    expect(jobs[0].summary.state).toBe("cancelled");
    expect(jobs[0].summary.error).toBeUndefined();
  });

  it("does not let a late event resurrect a terminal job", () => {
    const cancelled = reduce([entry()], { kind: "cancelled", jobId: "transfer-1" });
    for (const event of [
      { kind: "finished", jobId: "transfer-1", skipped: 0 },
      { kind: "needsDecision", jobId: "transfer-1", step },
      { kind: "failed", jobId: "transfer-1", code: "protocol", message: "late" },
    ] as TransferEvent[]) {
      expect(reduce(cancelled, event)[0].summary.state).toBe("cancelled");
    }
  });

  it("ignores late progress for a job that already finished", () => {
    const done = reduce([entry()], { kind: "finished", jobId: "transfer-1", skipped: 0 });
    const later = reduce(done, { kind: "progress", jobId: "transfer-1", progress });
    expect(later[0].progress).toBeUndefined();
    expect(later[0].summary.state).toBe("completed");
  });

  it("touches only the job the event names", () => {
    const jobs = [entry(), entry({ summary: summary({ id: "transfer-2" }) })];
    const updated = reduce(jobs, { kind: "cancelled", jobId: "transfer-2" });
    expect(updated[0].summary.state).toBe("running");
    expect(updated[1].summary.state).toBe("cancelled");
  });

  it("returns the same array when nothing changed, so renders are not forced", () => {
    const done = reduce([entry()], { kind: "finished", jobId: "transfer-1", skipped: 0 });
    expect(reduce(done, { kind: "finished", jobId: "transfer-1", skipped: 9 })).toBe(done);
  });
});
