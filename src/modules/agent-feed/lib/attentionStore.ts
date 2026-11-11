import { create } from "zustand";
import type { WorkspaceEnv } from "@/modules/workspace";
import type { AttentionItem, HostAgent } from "./attention";

/** The two views of a team tab. */
export type TeamView = "board" | "communications";

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
  /** Named agents live on each watched host, busy or not. */
  agents: Record<string, HostAgent[]>;
  origins: Record<string, AttentionOrigin>;
  /** Host whose communications the owner is looking at, if any. */
  viewing: string | null;
  /** View the next team tab to show opens on; taken once. */
  requestedView: TeamView | null;
  /** Questions the owner has already seen in the log. */
  seen: Record<string, true>;
  setWaiting: (
    sourceKey: string,
    items: AttentionItem[],
    origin: AttentionOrigin,
    agents?: HostAgent[],
  ) => void;
  setViewing: (sourceKey: string | null) => void;
  requestView: (view: TeamView | null) => void;
  dropSource: (sourceKey: string) => void;
  markSeen: (sourceKey: string) => void;
};

/** Kept in memory only: the questions' text is never persisted. */
export const useAgentAttention = create<AttentionState>((set) => ({
  bySource: {},
  agents: {},
  origins: {},
  seen: {},
  viewing: null,
  requestedView: null,
  setWaiting: (sourceKey, items, origin, agents = []) =>
    set((state) => ({
      bySource: { ...state.bySource, [sourceKey]: items },
      agents: { ...state.agents, [sourceKey]: agents },
      origins: { ...state.origins, [sourceKey]: origin },
    })),
  setViewing: (viewing) => set({ viewing }),
  requestView: (requestedView) => set({ requestedView }),
  dropSource: (sourceKey) =>
    set((state) => {
      const { [sourceKey]: _items, ...bySource } = state.bySource;
      const { [sourceKey]: _agents, ...agents } = state.agents;
      const { [sourceKey]: _origin, ...origins } = state.origins;
      return { bySource, agents, origins };
    }),
  markSeen: (sourceKey) =>
    set((state) => {
      const seen = { ...state.seen };
      for (const item of state.bySource[sourceKey] ?? []) seen[item.recordId] = true;
      return { seen };
    }),
}));

/** Watch key of the host a workspace runs on. */
export function hostKeyOf(env: WorkspaceEnv | undefined): string | null {
  if (!env || env.kind === "local") return "local";
  return env.kind === "ssh" ? `ssh:${env.connection.id}` : null;
}

/** Watch key of the host a team project lives on (`remote://voktty-ssh-<id>/...`). */
export function hostKeyOfProject(projectPath: string): string {
  const match = /^remote:\/\/voktty-ssh-([^/]+)\//.exec(projectPath);
  return match ? `ssh:${decodeURIComponent(match[1])}` : "local";
}

/** Waiting questions the owner has not looked at yet. */
export function unseenAttention(state: Pick<AttentionState, "bySource" | "seen">): AttentionItem[] {
  return Object.values(state.bySource)
    .flat()
    .filter((item) => !state.seen[item.recordId]);
}
