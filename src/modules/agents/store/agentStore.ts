import { create } from "zustand";
import type {
  AgentNotification,
  AgentSession,
  AgentStatus,
  LocalAgentState,
} from "../lib/types";

const MAX_NOTIFICATIONS = 50;

let notifSeq = 0;

type AgentStoreState = {
  sessions: Record<number, AgentSession>;
  localAgent: LocalAgentState;
  notifications: AgentNotification[];
  /** CLI finished state awaiting hover confirmation: leafId -> tabId */
  pulsingLeaves: Record<number, number>;
  /** Tab with pulsing leaf: tabId -> true */
  pulsingTabs: Record<number, true>;
  start: (leafId: number, tabId: number, agent: string) => void;
  setStatus: (leafId: number, status: AgentStatus) => void;
  finish: (leafId: number) => void;
  startPulse: (leafId: number, tabId: number) => void;
  clearPulse: (leafId: number) => void;
  clearTabPulse: (tabId: number) => void;
  setLocalAgent: (state: LocalAgentState) => void;
  pushNotification: (
    n: Omit<AgentNotification, "id" | "at" | "read">,
  ) => void;
  removeNotification: (id: string) => void;
  markAllRead: () => void;
  clearNotifications: () => void;
};

export const useAgentStore = create<AgentStoreState>((set) => ({
  sessions: {},
  localAgent: null,
  notifications: [],
  pulsingLeaves: {},
  pulsingTabs: {},

  start: (leafId, tabId, agent) =>
    set((s) => {
      const now = Date.now();
      return {
        sessions: {
          ...s.sessions,
          [leafId]: {
            leafId,
            tabId,
            agent,
            status: "working",
            startedAt: now,
            lastActivityAt: now,
            attentionSince: null,
          },
        },
      };
    }),

  setStatus: (leafId, status) =>
    set((s) => {
      const prev = s.sessions[leafId];
      if (!prev || prev.status === status) return s;
      const now = Date.now();
      return {
        sessions: {
          ...s.sessions,
          [leafId]: {
            ...prev,
            status,
            lastActivityAt: now,
            attentionSince: status === "waiting" ? now : null,
          },
        },
      };
    }),

  finish: (leafId) =>
    set((s) => {
      if (!s.sessions[leafId]) return s;
      const next = { ...s.sessions };
      delete next[leafId];
      return { sessions: next };
    }),

  startPulse: (leafId, tabId) =>
    set((s) => {
      const leaves =
        s.pulsingLeaves[leafId] === tabId
          ? s.pulsingLeaves
          : { ...s.pulsingLeaves, [leafId]: tabId };
      const tabs = s.pulsingTabs[tabId]
        ? s.pulsingTabs
        : { ...s.pulsingTabs, [tabId]: true as const };
      if (leaves === s.pulsingLeaves && tabs === s.pulsingTabs) return s;
      return { pulsingLeaves: leaves, pulsingTabs: tabs };
    }),

  clearPulse: (leafId) =>
    set((s) => {
      const tabId = s.pulsingLeaves[leafId];
      if (tabId === undefined) return s;
      const nextLeaves = { ...s.pulsingLeaves };
      delete nextLeaves[leafId];
      const tabStillPulsing = Object.values(nextLeaves).some((id) => id === tabId);
      if (tabStillPulsing || !s.pulsingTabs[tabId]) {
        return { pulsingLeaves: nextLeaves };
      }
      const nextTabs = { ...s.pulsingTabs };
      delete nextTabs[tabId];
      return { pulsingLeaves: nextLeaves, pulsingTabs: nextTabs };
    }),

  clearTabPulse: (tabId) =>
    set((s) => {
      if (!s.pulsingTabs[tabId]) return s;
      if (Object.values(s.pulsingLeaves).some((id) => id === tabId)) return s;
      const next = { ...s.pulsingTabs };
      delete next[tabId];
      return { pulsingTabs: next };
    }),

  setLocalAgent: (state) =>
    set((s) => {
      if (s.localAgent === state) return s;
      if (
        s.localAgent &&
        state &&
        s.localAgent.agent === state.agent &&
        s.localAgent.status === state.status
      ) {
        return s;
      }
      return { localAgent: state };
    }),

  pushNotification: (n) =>
    set((s) => ({
      notifications: [
        { ...n, id: `n${++notifSeq}`, at: Date.now(), read: false },
        ...s.notifications,
      ].slice(0, MAX_NOTIFICATIONS),
    })),

  removeNotification: (id) =>
    set((s) => ({
      notifications: s.notifications.filter((n) => n.id !== id),
    })),

  markAllRead: () =>
    set((s) => {
      if (!s.notifications.some((n) => !n.read)) return s;
      return { notifications: s.notifications.map((n) => ({ ...n, read: true })) };
    }),

  clearNotifications: () => set({ notifications: [] }),
}));

/** The tab/leaf of the agent that most recently entered the waiting state, for
 *  the keyboard jump-to-attention shortcut. Null when none is waiting. */
export function nextAttentionTarget(): { tabId: number; leafId: number } | null {
  const waiting = Object.values(useAgentStore.getState().sessions)
    .filter((s) => s.status === "waiting")
    .sort((a, b) => (b.attentionSince ?? 0) - (a.attentionSince ?? 0));
  const t = waiting[0];
  return t ? { tabId: t.tabId, leafId: t.leafId } : null;
}
