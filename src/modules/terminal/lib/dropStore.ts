import { create } from "zustand";

type TerminalDropState = {
  targetLeafId: number | null;
  isWorkspaceHovered: boolean;
  setTarget: (leafId: number | null) => void;
  setWorkspaceHovered: (hovered: boolean) => void;
};

export const useTerminalDropStore = create<TerminalDropState>((set) => ({
  targetLeafId: null,
  isWorkspaceHovered: false,
  setTarget: (leafId) =>
    set((s) => (s.targetLeafId === leafId ? s : { targetLeafId: leafId })),
  setWorkspaceHovered: (hovered) =>
    set((s) => (s.isWorkspaceHovered === hovered ? s : { isWorkspaceHovered: hovered })),
}));
