import { create } from "zustand";
import { getActiveTerminalLeafId } from "../lib/useTerminalSession";

export type HistoryShellFilter = "all" | "powershell" | "unix" | "local";

export type CommandHistoryStore = {
  isOpen: boolean;
  targetLeafId: number | null;
  searchQuery: string;
  shellFilter: HistoryShellFilter;
  scrollPosition: number;
  modalPosition: { x: number; y: number } | null;
  openHistory: (initialQuery?: string, targetLeafId?: number | null) => void;
  closeHistory: () => void;
  toggleHistory: (targetLeafId?: number | null) => void;
  setSearchQuery: (query: string) => void;
  setShellFilter: (filter: HistoryShellFilter) => void;
  setScrollPosition: (scroll: number) => void;
  setModalPosition: (pos: { x: number; y: number } | null) => void;
};

export const useCommandHistoryStore = create<CommandHistoryStore>((set) => ({
  isOpen: false,
  targetLeafId: null,
  searchQuery: "",
  shellFilter: "all",
  scrollPosition: 0,
  modalPosition: null,
  openHistory: (initialQuery = "", targetLeafId) =>
    set({
      isOpen: true,
      searchQuery: initialQuery,
      targetLeafId: targetLeafId !== undefined ? targetLeafId : getActiveTerminalLeafId(),
    }),
  closeHistory: () => set({ isOpen: false, targetLeafId: null }),
  toggleHistory: (targetLeafId) =>
    set((s) => ({
      isOpen: !s.isOpen,
      targetLeafId: !s.isOpen
        ? targetLeafId !== undefined
          ? targetLeafId
          : getActiveTerminalLeafId()
        : null,
    })),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setShellFilter: (shellFilter) => set({ shellFilter }),
  setScrollPosition: (scrollPosition) => set({ scrollPosition }),
  setModalPosition: (modalPosition) => set({ modalPosition }),
}));
