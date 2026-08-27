import { create } from "zustand";

export type HistoryShellFilter = "all" | "powershell" | "unix" | "local";

export type CommandHistoryStore = {
  isOpen: boolean;
  searchQuery: string;
  shellFilter: HistoryShellFilter;
  openHistory: (initialQuery?: string) => void;
  closeHistory: () => void;
  toggleHistory: () => void;
  setSearchQuery: (query: string) => void;
  setShellFilter: (filter: HistoryShellFilter) => void;
};

export const useCommandHistoryStore = create<CommandHistoryStore>((set) => ({
  isOpen: false,
  searchQuery: "",
  shellFilter: "all",
  openHistory: (initialQuery = "") =>
    set({ isOpen: true, searchQuery: initialQuery }),
  closeHistory: () => set({ isOpen: false }),
  toggleHistory: () => set((s) => ({ isOpen: !s.isOpen })),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setShellFilter: (shellFilter) => set({ shellFilter }),
}));
