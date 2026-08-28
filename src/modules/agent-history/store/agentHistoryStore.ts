import { create } from "zustand";
import {
  clearAllHistory,
  deleteHistorySession,
  fetchHistoryStats,
  fetchMessages,
  fetchSessions,
  rescanHistory,
} from "../lib/agentHistoryBridge";
import type { HistoryMessage, HistorySession, HistoryStats, SessionFilter } from "../types";

interface AgentHistoryState {
  isOpen: boolean;
  sessions: HistorySession[];
  activeSessionId: string | null;
  activeSession: HistorySession | null;
  messages: HistoryMessage[];
  isLoading: boolean;
  isScanning: boolean;
  searchQuery: string;
  selectedAgent: string;
  selectedProject: string;
  stats: HistoryStats | null;

  // Actions
  openHistory: () => void;
  closeHistory: () => void;
  toggleHistory: () => void;
  setSearchQuery: (q: string) => void;
  setSelectedAgent: (agent: string) => void;
  setSelectedProject: (project: string) => void;
  loadSessions: () => Promise<void>;
  selectSession: (id: string) => Promise<void>;
  rescan: () => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  clearAll: () => Promise<void>;
}

export const useAgentHistoryStore = create<AgentHistoryState>((set, get) => ({
  isOpen: false,
  sessions: [],
  activeSessionId: null,
  activeSession: null,
  messages: [],
  isLoading: false,
  isScanning: false,
  searchQuery: "",
  selectedAgent: "all",
  selectedProject: "",
  stats: null,

  openHistory: () => {
    set({ isOpen: true });
    void (async () => {
      await get().loadSessions();
      if (get().sessions.length === 0) {
        await get().rescan();
      }
    })();
  },

  closeHistory: () => set({ isOpen: false }),

  toggleHistory: () => {
    const next = !get().isOpen;
    set({ isOpen: next });
    if (next) {
      void (async () => {
        await get().loadSessions();
        if (get().sessions.length === 0) {
          await get().rescan();
        }
      })();
    }
  },

  setSearchQuery: (searchQuery) => {
    set({ searchQuery });
    void get().loadSessions();
  },

  setSelectedAgent: (selectedAgent) => {
    set({ selectedAgent });
    void get().loadSessions();
  },

  setSelectedProject: (selectedProject) => {
    set({ selectedProject });
    void get().loadSessions();
  },

  loadSessions: async () => {
    const { searchQuery, selectedAgent, selectedProject } = get();
    set({ isLoading: true });

    try {
      const filter: SessionFilter = {
        search_query: searchQuery.trim() || undefined,
        agent: selectedAgent !== "all" ? selectedAgent : undefined,
        project: selectedProject.trim() || undefined,
        limit: 100,
      };

      const [sessions, stats] = await Promise.all([
        fetchSessions(filter),
        fetchHistoryStats(),
      ]);

      const safeSessions = Array.isArray(sessions) ? sessions : [];
      const activeSessionId = get().activeSessionId;
      let activeSession = safeSessions.find((s) => s.id === activeSessionId) || null;

      if (!activeSession && safeSessions.length > 0) {
        activeSession = safeSessions[0];
      }

      set({
        sessions: safeSessions,
        stats: stats ?? null,
        activeSessionId: activeSession ? activeSession.id : null,
        activeSession,
      });

      if (activeSession) {
        void get().selectSession(activeSession.id);
      } else {
        set({ messages: [] });
      }
    } finally {
      set({ isLoading: false });
    }
  },

  selectSession: async (id: string) => {
    const sessions = get().sessions;
    const activeSession = sessions.find((s) => s.id === id) || null;
    set({ activeSessionId: id, activeSession, isLoading: true });

    try {
      const messages = await fetchMessages(id, 0, 500);
      set({ messages });
    } finally {
      set({ isLoading: false });
    }
  },

  rescan: async () => {
    set({ isScanning: true });
    try {
      const stats = await rescanHistory();
      if (stats) {
        set({ stats });
      }
    } finally {
      set({ isScanning: false });
    }
    await get().loadSessions();
  },

  deleteSession: async (id: string) => {
    await deleteHistorySession(id);
    const sessions = get().sessions.filter((s) => s.id !== id);
    const nextActive = sessions[0] || null;

    set({
      sessions,
      activeSessionId: nextActive ? nextActive.id : null,
      activeSession: nextActive,
    });

    if (nextActive) {
      void get().selectSession(nextActive.id);
    } else {
      set({ messages: [] });
    }
  },

  clearAll: async () => {
    await clearAllHistory();
    set({
      sessions: [],
      activeSessionId: null,
      activeSession: null,
      messages: [],
    });
  },
}));