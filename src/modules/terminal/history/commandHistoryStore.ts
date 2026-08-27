import { create } from "zustand";

export type HistoryShellFilter = "all" | "powershell" | "unix" | "local";

export type CommandHistoryStore = {
  isOpen: boolean;
  searchQuery: string;
  shellFilter: HistoryShellFilter;
  scrollPosition: number;
  modalPosition: { x: number; y: number } | null;
  openHistory: (initialQuery?: string) => void;
  closeHistory: () => void;
  toggleHistory: () => void;
  setSearchQuery: (query: string) => void;
  setShellFilter: (filter: HistoryShellFilter) => void;
  setScrollPosition: (scroll: number) => void;
  setModalPosition: (pos: { x: number; y: number } | null) => void;
};

export const useCommandHistoryStore = create<CommandHistoryStore>((set) => ({
  isOpen: false,
  searchQuery: "",
  shellFilter: "all",
  scrollPosition: 0,
  modalPosition: null,
  openHistory: (initialQuery = "") =>
    set({ isOpen: true, searchQuery: initialQuery }),
  closeHistory: () => set({ isOpen: false }),
  toggleHistory: () => set((s) => ({ isOpen: !s.isOpen })),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setShellFilter: (shellFilter) => set({ shellFilter }),
  setScrollPosition: (scrollPosition) => set({ scrollPosition }),
  setModalPosition: (modalPosition) => set({ modalPosition }),
}));
