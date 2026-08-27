import { create } from "zustand";

export type TerminalCopilotState = {
  isOpen: boolean;
  leafId: number | null;
  initialPrompt: string;
  autoApprovedLeafIds: number[];
  openCopilot: (leafId?: number | null, initialPrompt?: string) => void;
  toggleCopilot: (leafId?: number | null, initialPrompt?: string) => void;
  closeCopilot: () => void;
  allowAlwaysForLeaf: (leafId: number) => void;
  isLeafAutoApproved: (leafId: number) => boolean;
};

export const useTerminalCopilotStore = create<TerminalCopilotState>(
  (set, get) => ({
    isOpen: false,
    leafId: null,
    initialPrompt: "",
    autoApprovedLeafIds: [],
    openCopilot: (leafId = null, initialPrompt = "") => {
      set({ isOpen: true, leafId, initialPrompt });
    },
    toggleCopilot: (leafId = null, initialPrompt = "") => {
      const current = get();
      if (current.isOpen) {
        set({ isOpen: false, initialPrompt: "" });
      } else {
        set({ isOpen: true, leafId, initialPrompt });
      }
    },
    closeCopilot: () => set({ isOpen: false, initialPrompt: "" }),
    allowAlwaysForLeaf: (leafId: number) =>
      set((state) => ({
        autoApprovedLeafIds: state.autoApprovedLeafIds.includes(leafId)
          ? state.autoApprovedLeafIds
          : [...state.autoApprovedLeafIds, leafId],
      })),
    isLeafAutoApproved: (leafId: number) =>
      get().autoApprovedLeafIds.includes(leafId),
  }),
);
