import { create } from "zustand";

export type WorkspaceTab = "notes" | "kanban" | "review";

export type Position = { x: number; y: number };

const POSITION_STORAGE_KEY = "voktty-notes-board-pos-v1";

type NotesBoardState = {
  isOpen: boolean;
  activeTab: WorkspaceTab;
  width: number;
  height: number;
  position: Position | null;
  pendingNewNote: number | null;
  toggle: () => void;
  open: (tab?: WorkspaceTab) => void;
  openReview: () => void;
  close: () => void;
  setTab: (tab: WorkspaceTab) => void;
  setSize: (size: { width?: number; height?: number }) => void;
  setPosition: (pos: Position | null) => void;
  resetPosition: () => void;
  requestNewNote: () => void;
  clearPendingNewNote: () => void;
};

const DEFAULT_WIDTH = 840;
const DEFAULT_HEIGHT = 580;
const MIN_WIDTH = 420;
const MIN_HEIGHT = 380;
const MAX_WIDTH = 1000;
const MAX_HEIGHT = 800;

function loadStoredPosition(): Position | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(POSITION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.x === "number" &&
      typeof parsed.y === "number" &&
      !Number.isNaN(parsed.x) &&
      !Number.isNaN(parsed.y)
    ) {
      return { x: parsed.x, y: parsed.y };
    }
    return null;
  } catch {
    return null;
  }
}

function persistPosition(pos: Position | null) {
  try {
    if (typeof localStorage === "undefined") return;
    if (pos === null) {
      localStorage.removeItem(POSITION_STORAGE_KEY);
    } else {
      localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify(pos));
    }
  } catch {
    // Ignore storage quota or disabled storage
  }
}

export const useNotesBoardStore = create<NotesBoardState>((set) => ({
  isOpen: false,
  activeTab: "notes",
  width: DEFAULT_WIDTH,
  height: DEFAULT_HEIGHT,
  position: loadStoredPosition(),
  pendingNewNote: null,

  toggle: () => set((s) => ({ isOpen: !s.isOpen })),

  open: (tab) =>
    set((s) => ({
      isOpen: true,
      activeTab: tab ?? s.activeTab,
    })),

  openReview: () =>
    set({
      isOpen: true,
      activeTab: "review",
    }),

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

  setPosition: (pos) => {
    persistPosition(pos);
    set({ position: pos });
  },

  resetPosition: () => {
    persistPosition(null);
    set({ position: null });
  },

  requestNewNote: () => {
    set({
      isOpen: true,
      activeTab: "notes",
      pendingNewNote: Date.now(),
    });
  },

  clearPendingNewNote: () => set({ pendingNewNote: null }),
}));
