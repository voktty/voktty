import { create } from "zustand";

export type ProcessState =
  | "idle"
  | "running"
  | "completed"
  | "failed"
  | "attention";

export type LeafProcessInfo = {
  leafId: number;
  state: ProcessState;
  progress: number | null; // 0..100
  command: string | null;
  exitCode: number | null;
  startedAt: number | null;
  finishedAt: number | null;
};

type TerminalProgressStore = {
  leaves: Record<number, LeafProcessInfo>;
  setLeafCommandStart: (leafId: number, command?: string | null) => void;
  setLeafProgress: (
    leafId: number,
    progress: number | null,
    state?: ProcessState,
  ) => void;
  setLeafCommandEnd: (leafId: number, exitCode: number | null) => void;
  processPtyOutput: (leafId: number, text: string) => void;
  clearLeaf: (leafId: number) => void;
  acknowledgeLeaf: (leafId: number) => void;
};

const AUTO_RESET_COMPLETED_MS = 14000;
const completedTimers = new Map<number, ReturnType<typeof setTimeout>>();
const INFERRED_RUNNING_SETTLE_MS = 6000;
const inferredTimers = new Map<number, ReturnType<typeof setTimeout>>();

function clearCompletedTimer(leafId: number): void {
  const t = completedTimers.get(leafId);
  if (t) {
    clearTimeout(t);
    completedTimers.delete(leafId);
  }
}

function clearInferredTimer(leafId: number): void {
  const t = inferredTimers.get(leafId);
  if (t) {
    clearTimeout(t);
    inferredTimers.delete(leafId);
  }
}

export function extractProgressFromText(text: string): number | null {
  if (!text || text.length === 0) return null;

  // Match step fractions like [12/48] or (12/48)
  const stepMatch = text.match(
    /\[\s*(\d+)\s*\/\s*(\d+)\s*\]|\(\s*(\d+)\s*\/\s*(\d+)\s*\)/,
  );
  if (stepMatch) {
    const current = Number(stepMatch[1] ?? stepMatch[3]);
    const total = Number(stepMatch[2] ?? stepMatch[4]);
    if (total > 0 && current <= total) {
      return Math.min(100, Math.max(0, Math.round((current / total) * 100)));
    }
  }

  // Match percentage like "45%", "[45%]", "45.2%", "Progress: 80%"
  const percentMatches = Array.from(
    text.matchAll(/(?:^|[^\w.])(\d{1,3}(?:\.\d+)?)\s*%/g),
  );
  if (percentMatches.length > 0) {
    const lastMatch = percentMatches[percentMatches.length - 1];
    const val = parseFloat(lastMatch[1]);
    if (!isNaN(val) && val >= 0 && val <= 100) {
      return Math.round(val);
    }
  }

  return null;
}

export type Osc9Progress = {
  state: "none" | "normal" | "error" | "indeterminate" | "warning";
  progress: number | null;
};

export function parseOsc9Progress(data: string): Osc9Progress | null {
  if (!data.startsWith("4") && !data.startsWith("4;")) return null;
  const parts = data.split(";");
  if (parts.length < 2) return null;
  const rawState = parseInt(parts[1], 10);
  const rawProgress = parts.length > 2 ? parseInt(parts[2], 10) : null;
  const progress =
    rawProgress !== null &&
    Number.isFinite(rawProgress) &&
    rawProgress >= 0 &&
    rawProgress <= 100
      ? rawProgress
      : null;

  switch (rawState) {
    case 0:
      return { state: "none", progress: 100 };
    case 1:
      return { state: "normal", progress: progress ?? 0 };
    case 2:
      return { state: "error", progress: progress };
    case 3:
      return { state: "indeterminate", progress: null };
    case 4:
      return { state: "warning", progress: progress };
    default:
      return null;
  }
}

export const useTerminalProgressStore = create<TerminalProgressStore>(
  (set) => ({
    leaves: {},

    setLeafCommandStart: (leafId, command) => {
      clearCompletedTimer(leafId);
      clearInferredTimer(leafId);
      set((s) => {
        const prev = s.leaves[leafId];
        const next: LeafProcessInfo = {
          leafId,
          state: "running",
          progress: null,
          command: command ?? prev?.command ?? null,
          exitCode: null,
          startedAt: Date.now(),
          finishedAt: null,
        };
        return { leaves: { ...s.leaves, [leafId]: next } };
      });
    },

    setLeafProgress: (leafId, progress, state = "running") => {
      set((s) => {
        const prev = s.leaves[leafId];
        if (!prev && state === "idle") return s;
        if (prev && prev.progress === progress && prev.state === state) return s;
        const next: LeafProcessInfo = {
          leafId,
          state,
          progress,
          command: prev?.command ?? null,
          exitCode: prev?.exitCode ?? null,
          startedAt: prev?.startedAt ?? Date.now(),
          finishedAt:
            state === "completed" || state === "failed" ? Date.now() : null,
        };
        return { leaves: { ...s.leaves, [leafId]: next } };
      });
    },

    setLeafCommandEnd: (leafId, exitCode) => {
      clearCompletedTimer(leafId);
      clearInferredTimer(leafId);
      const isSuccess = exitCode === 0 || exitCode === null;
      const targetState: ProcessState = isSuccess ? "completed" : "failed";

      set((s) => {
        const prev = s.leaves[leafId];
        const next: LeafProcessInfo = {
          leafId,
          state: targetState,
          progress: isSuccess ? 100 : prev?.progress ?? null,
          command: prev?.command ?? null,
          exitCode,
          startedAt: prev?.startedAt ?? null,
          finishedAt: Date.now(),
        };
        return { leaves: { ...s.leaves, [leafId]: next } };
      });

      if (isSuccess) {
        completedTimers.set(
          leafId,
          setTimeout(() => {
            completedTimers.delete(leafId);
            set((s) => {
              const current = s.leaves[leafId];
              if (current && current.state === "completed") {
                return {
                  leaves: {
                    ...s.leaves,
                    [leafId]: { ...current, state: "idle", progress: null },
                  },
                };
              }
              return s;
            });
          }, AUTO_RESET_COMPLETED_MS),
        );
      }
    },

    processPtyOutput: (leafId, text) => {
      const store = useTerminalProgressStore.getState();
      const current = store.leaves[leafId];
      // Only parse progress if currently running or not explicitly idle
      if (current && current.state !== "running" && current.state !== "idle") {
        return;
      }

      const percent = extractProgressFromText(text);
      if (percent !== null) {
        if (percent >= 100) {
          store.setLeafCommandEnd(leafId, 0);
          return;
        }
        store.setLeafProgress(leafId, percent, "running");
        clearInferredTimer(leafId);
        inferredTimers.set(
          leafId,
          setTimeout(() => {
            clearInferredTimer(leafId);
            const s = useTerminalProgressStore.getState();
            if (s.leaves[leafId]?.state === "running") {
              store.setLeafCommandEnd(leafId, 0);
            }
          }, INFERRED_RUNNING_SETTLE_MS),
        );
      }
    },

    clearLeaf: (leafId) => {
      clearCompletedTimer(leafId);
      clearInferredTimer(leafId);
      set((s) => {
        if (!(leafId in s.leaves)) return s;
        const next = { ...s.leaves };
        delete next[leafId];
        return { leaves: next };
      });
    },

    acknowledgeLeaf: (leafId) => {
      clearCompletedTimer(leafId);
      clearInferredTimer(leafId);
      set((s) => {
        const current = s.leaves[leafId];
        if (
          !current ||
          (current.state !== "completed" && current.state !== "failed")
        ) {
          return s;
        }
        return {
          leaves: {
            ...s.leaves,
            [leafId]: { ...current, state: "idle", progress: null },
          },
        };
      });
    },
  }),
);
