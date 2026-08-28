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
  modelsSubTab: "models" | "agents";
  tabScrollPositions: Record<string, number>;
  modalPosition: { x: number; y: number } | null;
  openSettings: (tab?: SettingsTab) => void;
  closeSettings: () => void;
  setActiveTab: (tab: SettingsTab) => void;
  setModelsSubTab: (subTab: "models" | "agents") => void;
  setTabScroll: (tab: string, scrollTop: number) => void;
  setModalPosition: (pos: { x: number; y: number } | null) => void;
};

export const useSettingsModalStore = create<SettingsModalState>((set) => ({
  open: false,
  activeTab: getInitialTab(),
  modelsSubTab: "models",
  tabScrollPositions: {},
  modalPosition: null,
  openSettings: (tab?: SettingsTab) =>
    set((state) => {
      let nextTab = tab ?? state.activeTab ?? getInitialTab();
      let nextSubTab: "models" | "agents" = state.modelsSubTab;
      if (nextTab === "agents") {
        nextTab = "models";
        nextSubTab = "agents";
      } else if (nextTab === "models") {
        nextSubTab = "models";
      }
      persistLastTab(nextTab);
      return {
        open: true,
        activeTab: nextTab,
        modelsSubTab: nextSubTab,
      };
    }),
  closeSettings: () => set({ open: false }),
  setActiveTab: (tab: SettingsTab) => {
    let nextTab = tab;
    let nextSubTab: "models" | "agents" | null = null;
    if (tab === "agents") {
      nextTab = "models";
      nextSubTab = "agents";
    } else if (tab === "models") {
      nextSubTab = "models";
    }
    persistLastTab(nextTab);
    set({
      activeTab: nextTab,
      ...(nextSubTab ? { modelsSubTab: nextSubTab } : {}),
    });
  },
  setModelsSubTab: (subTab) => set({ modelsSubTab: subTab }),
  setTabScroll: (tab: string, scrollTop: number) =>
    set((state) => ({
      tabScrollPositions: {
        ...state.tabScrollPositions,
        [tab]: scrollTop,
      },
    })),
  setModalPosition: (pos) => set({ modalPosition: pos }),
}));
