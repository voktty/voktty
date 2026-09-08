import { create } from "zustand";

export type WorkspaceTab = "notes" | "kanban";

type NotesBoardState = {
  isOpen: boolean;
  activeTab: WorkspaceTab;
  width: number;
  height: number;
  toggle: () => void;
  open: (tab?: WorkspaceTab) => void;
  close: () => void;
  setTab: (tab: WorkspaceTab) => void;
  setSize: (size: { width?: number; height?: number }) => void;
};

const DEFAULT_WIDTH = 640;
const DEFAULT_HEIGHT = 540;
const MIN_WIDTH = 420;
const MIN_HEIGHT = 380;
const MAX_WIDTH = 1000;
const MAX_HEIGHT = 800;

export const useNotesBoardStore = create<NotesBoardState>((set) => ({
  isOpen: false,
  activeTab: "notes",
  width: DEFAULT_WIDTH,
  height: DEFAULT_HEIGHT,

  toggle: () => set((s) => ({ isOpen: !s.isOpen })),

  open: (tab) =>
    set((s) => ({
      isOpen: true,
      activeTab: tab ?? s.activeTab,
    })),

  close: () => set({ isOpen: false }),

  setTab: (tab) => set({ activeTab: tab }),

  setSize: ({ width, height }) =>
    set((s) => ({
      width:
        width !== undefined
          ? Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, width))
          : s.width,
      height:
        height !== undefined
          ? Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, height))
          : s.height,
    })),
}));
