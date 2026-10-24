import { create } from "zustand";
import {
  captureTerminalInputTarget,
  type TerminalInputTarget,
} from "@/modules/terminal/lib/useTerminalSession";

export type HistoryShellFilter = "all" | "powershell" | "unix" | "local";

export type CommandHistoryStore = {
  isOpen: boolean;
  targetLeafId: number | null;
  inputTarget: TerminalInputTarget | null;
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
  inputTarget: null,
  searchQuery: "",
  shellFilter: "all",
  scrollPosition: 0,
  modalPosition: null,
  openHistory: (initialQuery = "", targetLeafId) => {
    const inputTarget = captureTerminalInputTarget(targetLeafId);
    set({
      isOpen: true,
      searchQuery: initialQuery,
      targetLeafId: inputTarget?.leafId ?? null,
      inputTarget,
    });
  },
  closeHistory: () =>
    set({ isOpen: false, targetLeafId: null, inputTarget: null }),
  toggleHistory: (targetLeafId) =>
    set((s) => {
      const inputTarget = s.isOpen
        ? null
        : captureTerminalInputTarget(targetLeafId);
      return {
        isOpen: !s.isOpen,
        targetLeafId: inputTarget?.leafId ?? null,
        inputTarget,
      };
    }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setShellFilter: (shellFilter) => set({ shellFilter }),
  setScrollPosition: (scrollPosition) => set({ scrollPosition }),
  setModalPosition: (modalPosition) => set({ modalPosition }),
}));
