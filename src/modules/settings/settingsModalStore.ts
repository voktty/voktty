import { create } from "zustand";
import type { SettingsTab } from "./openSettingsWindow";

const LAST_TAB_STORAGE_KEY = "voktty-settings-last-tab";

function getInitialTab(): SettingsTab {
  if (typeof window === "undefined") return "general";
  try {
    const saved = localStorage.getItem(LAST_TAB_STORAGE_KEY) as SettingsTab | null;
    if (
      saved &&
      [
        "general",
        "editor",
        "themes",
        "shortcuts",
        "models",
        "agents",
        "extensions",
        "ssh",
        "rdp",
        "docker",
        "mcp",
        "vault",
        "about",
      ].includes(saved)
    ) {
      return saved;
    }
  } catch {
    // Ignore storage errors
  }
  return "general";
}

function persistLastTab(tab: SettingsTab) {
  try {
    localStorage.setItem(LAST_TAB_STORAGE_KEY, tab);
  } catch {
    // Ignore storage errors
  }
}

export type SettingsModalState = {
  open: boolean;
  activeTab: SettingsTab;
  tabScrollPositions: Record<string, number>;
  modalPosition: { x: number; y: number } | null;
  openSettings: (tab?: SettingsTab) => void;
  closeSettings: () => void;
  setActiveTab: (tab: SettingsTab) => void;
  setTabScroll: (tab: string, scrollTop: number) => void;
  setModalPosition: (pos: { x: number; y: number } | null) => void;
};

export const useSettingsModalStore = create<SettingsModalState>((set) => ({
  open: false,
  activeTab: getInitialTab(),
  tabScrollPositions: {},
  modalPosition: null,
  openSettings: (tab?: SettingsTab) =>
    set((state) => {
      const nextTab = tab ?? state.activeTab ?? getInitialTab();
      persistLastTab(nextTab);
      return {
        open: true,
        activeTab: nextTab,
      };
    }),
  closeSettings: () => set({ open: false }),
  setActiveTab: (tab: SettingsTab) => {
    persistLastTab(tab);
    set({ activeTab: tab });
  },
  setTabScroll: (tab: string, scrollTop: number) =>
    set((state) => ({
      tabScrollPositions: {
        ...state.tabScrollPositions,
        [tab]: scrollTop,
      },
    })),
  setModalPosition: (pos) => set({ modalPosition: pos }),
}));
