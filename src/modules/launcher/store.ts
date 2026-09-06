import { create } from "zustand";

export type LauncherStore = {
  isOpen: boolean;
  openLauncher: () => void;
  closeLauncher: () => void;
  toggleLauncher: () => void;
};

export const useLauncherStore = create<LauncherStore>((set) => ({
  isOpen: false,
  openLauncher: () => set({ isOpen: true }),
  closeLauncher: () => set({ isOpen: false }),
  toggleLauncher: () => set((s) => ({ isOpen: !s.isOpen })),
}));
