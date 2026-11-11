import { create } from "zustand";
import type { WorkspaceEnv } from "@/modules/workspace";
import type { AttentionItem } from "./attention";

/** Where to open the log for a host that has an agent waiting. */
export type AttentionOrigin = {
  key: string;
  env: WorkspaceEnv;
  tabId: number;
  leafId: number;
};

type AttentionState = {
  /** Agents waiting for the owner, per watched host. */
  bySource: Record<string, AttentionItem[]>;
  origins: Record<string, AttentionOrigin>;
  /** Questions the owner has already seen in the log. */
  seen: Record<string, true>;
  setWaiting: (sourceKey: string, items: AttentionItem[], origin: AttentionOrigin) => void;
  dropSource: (sourceKey: string) => void;
  markSeen: (sourceKey: string) => void;
};

/** Kept in memory only: the questions' text is never persisted. */
export const useAgentAttention = create<AttentionState>((set) => ({
  bySource: {},
  origins: {},
  seen: {},
  setWaiting: (sourceKey, items, origin) =>
    set((state) => ({
      bySource: { ...state.bySource, [sourceKey]: items },
      origins: { ...state.origins, [sourceKey]: origin },
    })),
  dropSource: (sourceKey) =>
    set((state) => {
      const { [sourceKey]: _items, ...bySource } = state.bySource;
      const { [sourceKey]: _origin, ...origins } = state.origins;
      return { bySource, origins };
    }),
  markSeen: (sourceKey) =>
    set((state) => {
      const seen = { ...state.seen };
      for (const item of state.bySource[sourceKey] ?? []) seen[item.recordId] = true;
      return { seen };
    }),
}));

/** Waiting questions the owner has not looked at yet. */
export function unseenAttention(state: Pick<AttentionState, "bySource" | "seen">): AttentionItem[] {
  return Object.values(state.bySource)
    .flat()
    .filter((item) => !state.seen[item.recordId]);
}
