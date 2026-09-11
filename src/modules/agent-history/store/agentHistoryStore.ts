import { create } from "zustand";
import {
  clearAllHistory,
  deleteHistorySession,
  fetchHistoryStats,
  fetchMessages,
  fetchSessionPage,
  rescanHistory,
} from "../lib/agentHistoryBridge";
import type { HistoryMessage, HistorySession, HistoryStats } from "../types";

let messageRequest = 0;
let sessionPageRequest = 0;

interface AgentHistoryState {
  isOpen: boolean;
  sessions: HistorySession[];
  activeSessionId: string | null;
  activeSession: HistorySession | null;
  messages: HistoryMessage[];
  messageCache: Record<string, HistoryMessage[]>;
  isLoading: boolean;
  isMessagesLoading: boolean;
  isScanning: boolean;
  error: string | null;
  searchQuery: string;
  selectedAgent: string;
  selectedProject: string;
  stats: HistoryStats | null;
  hasMore: boolean;
  offset: number;
  nextOffset: number;

  // Actions
  openHistory: () => void;
  closeHistory: () => void;
  toggleHistory: () => void;
  setSearchQuery: (q: string) => void;
  setSelectedAgent: (agent: string) => void;
  setSelectedProject: (project: string) => void;
  loadSessions: () => Promise<void>;
  loadMoreSessions: () => Promise<void>;
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
  messageCache: {},
  isLoading: false,
  isMessagesLoading: false,
  isScanning: false,
  error: null,
  searchQuery: "",
  selectedAgent: "all",
  selectedProject: "",
  stats: null,
  hasMore: false,
  offset: 0,
  nextOffset: 0,

  openHistory: () => {
    set({ isOpen: true });
    void get().loadSessions();
  },

  closeHistory: () => set({ isOpen: false }),

  toggleHistory: () => {
    const next = !get().isOpen;
    set({ isOpen: next });
    if (next) {
      void get().loadSessions();
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
    const request = ++sessionPageRequest;
    const { searchQuery, selectedAgent, selectedProject } = get();
    set({ isLoading: true, error: null });

    try {
      const [page, stats] = await Promise.all([
        fetchSessionPage({
          limit: 100,
          offset: 0,
          ...(searchQuery.trim() ? { search_query: searchQuery.trim() } : {}),
          ...(selectedAgent !== "all" ? { agent: selectedAgent } : {}),
          ...(selectedProject ? { project: selectedProject } : {}),
        }),
        fetchHistoryStats(),
      ]);
      if (request !== sessionPageRequest) return;
      const safeSessions = Array.isArray(page.items) ? page.items : [];
      const activeSessionId = get().activeSessionId;
      let activeSession = safeSessions.find((s) => s.id === activeSessionId) || null;

      set({
        sessions: safeSessions,
        stats: stats ?? null,
        activeSessionId: activeSession ? activeSession.id : null,
        activeSession,
        hasMore: page.hasMore,
        offset: page.offset,
        nextOffset: page.offset + safeSessions.length,
        isScanning: page.scanning,
      });
      if (!activeSession) {
        messageRequest += 1;
        set({ messages: [], isMessagesLoading: false });
      }
    } catch (error) {
      if (request === sessionPageRequest) {
        set({ error: error instanceof Error ? error.message : String(error) });
      }
    } finally {
      if (request === sessionPageRequest) set({ isLoading: false });
    }
  },

  loadMoreSessions: async () => {
    const { hasMore, isLoading, nextOffset, sessions, searchQuery, selectedAgent, selectedProject } = get();
    if (!hasMore || isLoading) return;
    const request = ++sessionPageRequest;
    set({ isLoading: true, error: null });
    try {
      const page = await fetchSessionPage({
        limit: 100,
        offset: nextOffset,
        ...(searchQuery.trim() ? { search_query: searchQuery.trim() } : {}),
        ...(selectedAgent !== "all" ? { agent: selectedAgent } : {}),
        ...(selectedProject ? { project: selectedProject } : {}),
      });
      if (request !== sessionPageRequest) return;
      const known = new Set(sessions.map((session) => session.id));
      set({
        sessions: [...sessions, ...page.items.filter((session) => !known.has(session.id))],
        hasMore: page.hasMore,
        offset: page.offset,
        nextOffset: page.offset + page.items.length,
      });
    } catch (error) {
      if (request === sessionPageRequest) {
        set({ error: error instanceof Error ? error.message : String(error) });
      }
    } finally {
      if (request === sessionPageRequest) set({ isLoading: false });
    }
  },

  selectSession: async (id: string) => {
    const request = ++messageRequest;
    const sessions = get().sessions;
    const activeSession = sessions.find((s) => s.id === id) || null;
    const cached = get().messageCache[id];

    if (cached) {
      set({
        activeSessionId: id,
        activeSession,
        messages: cached,
        isMessagesLoading: false,
      });
      return;
    }

    set({ activeSessionId: id, activeSession, isMessagesLoading: true });

    try {
      const messages = await fetchMessages(id, 0, 500);
      if (request !== messageRequest || get().activeSessionId !== id) return;
      set((state) => ({
        messages,
        messageCache: {
          ...state.messageCache,
          [id]: messages,
        },
      }));
    } finally {
      if (request === messageRequest && get().activeSessionId === id) {
        set({ isMessagesLoading: false });
      }
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

    set((state) => {
      const newCache = { ...state.messageCache };
      delete newCache[id];
      return {
        sessions,
        messageCache: newCache,
        activeSessionId: nextActive ? nextActive.id : null,
        activeSession: nextActive,
      };
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
      messageCache: {},
    });
  },
}));
