/**
 * Where the first harness open actually spends its time.
 *
 * The first click takes seconds and later ones are instant, which is the
 * signature of a chunk being paid for once. But "chunk" hides three different
 * costs, and cutting modules only helps one of them:
 *
 *  - fetch and evaluate: resolving the dynamic import
 *  - render: turning the loaded component into a first frame
 *  - ready: the work its first effects do, which is IPC and database bound
 *
 * Marks are recorded once for the first open and kept, so the reading survives
 * long enough to be copied out of a release build, where there is no console.
 */

export type HarnessOpenPhase = "requested" | "loaded" | "rendered" | "ready";

const PHASES: readonly HarnessOpenPhase[] = [
  "requested",
  "loaded",
  "rendered",
  "ready",
];

const marks = new Map<HarnessOpenPhase, number>();

function now(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

/** First writer wins: only the cold open is worth measuring. */
export function markHarnessOpenPhase(phase: HarnessOpenPhase): void {
  if (marks.has(phase)) return;
  marks.set(phase, now());
}

export function resetHarnessOpenTiming(): void {
  marks.clear();
}

export type HarnessOpenTiming = {
  /** Milliseconds from the click to each phase, for the phases reached. */
  elapsed: Partial<Record<HarnessOpenPhase, number>>;
  /** Cost of each phase on its own, which is what identifies the culprit. */
  spans: Partial<Record<"load" | "render" | "ready", number>>;
  complete: boolean;
};

export function harnessOpenTiming(): HarnessOpenTiming | null {
  const start = marks.get("requested");
  if (start === undefined) return null;

  const elapsed: Partial<Record<HarnessOpenPhase, number>> = {};
  for (const phase of PHASES) {
    const at = marks.get(phase);
    if (at !== undefined) elapsed[phase] = Math.round(at - start);
  }

  const span = (from: HarnessOpenPhase, to: HarnessOpenPhase) => {
    const a = marks.get(from);
    const b = marks.get(to);
    return a === undefined || b === undefined ? undefined : Math.round(b - a);
  };

  return {
    elapsed,
    spans: {
      load: span("requested", "loaded"),
      render: span("loaded", "rendered"),
      ready: span("rendered", "ready"),
    },
    complete: marks.has("ready"),
  };
}
