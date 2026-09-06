import { create } from "zustand";

/** Lifted out of StatusBar so the tool launcher can open the arcade too. It
 * was reachable only from one small status bar button. */
export type ArcadeStore = {
  isOpen: boolean;
  openArcade: () => void;
  closeArcade: () => void;
  toggleArcade: () => void;
};

export const useArcadeStore = create<ArcadeStore>((set) => ({
  isOpen: false,
  openArcade: () => set({ isOpen: true }),
  closeArcade: () => set({ isOpen: false }),
  toggleArcade: () => set((s) => ({ isOpen: !s.isOpen })),
}));
