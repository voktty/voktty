import { create } from "zustand";
import type { SettingsTab } from "./openSettingsWindow";

export type SettingsModalState = {
  open: boolean;
  activeTab: SettingsTab;
  openSettings: (tab?: SettingsTab) => void;
  closeSettings: () => void;
  setActiveTab: (tab: SettingsTab) => void;
};

export const useSettingsModalStore = create<SettingsModalState>((set) => ({
  open: false,
  activeTab: "general",
  openSettings: (tab?: SettingsTab) =>
    set({
      open: true,
      activeTab: tab ?? "general",
    }),
  closeSettings: () => set({ open: false }),
  setActiveTab: (tab: SettingsTab) => set({ activeTab: tab }),
}));
