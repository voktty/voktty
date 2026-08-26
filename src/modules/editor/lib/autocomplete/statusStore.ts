import { create } from "zustand";

export type CompletionStatus = {
  phase: "idle" | "requesting" | "ready" | "error" | "paused";
  pauseUntil?: number;
};

const IDLE_STATUS: CompletionStatus = { phase: "idle" };

type CompletionStatusState = {
  byEditorId: Record<number, CompletionStatus>;
  report: (editorId: number, status: CompletionStatus) => void;
  remove: (editorId: number) => void;
};

export const useCompletionStatusStore = create<CompletionStatusState>(
  (set) => ({
    byEditorId: {},
    report: (editorId, status) =>
      set((state) => {
        const previous = state.byEditorId[editorId] ?? IDLE_STATUS;
        if (
          previous.phase === status.phase &&
          previous.pauseUntil === status.pauseUntil
        ) {
          return state;
        }
        return {
          byEditorId: { ...state.byEditorId, [editorId]: status },
        };
      }),
    remove: (editorId) =>
      set((state) => {
        if (!state.byEditorId[editorId]) return state;
        const byEditorId = { ...state.byEditorId };
        delete byEditorId[editorId];
        return { byEditorId };
      }),
  }),
);
