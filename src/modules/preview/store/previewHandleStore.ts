import { create } from "zustand";
import type { PreviewPaneHandle } from "../PreviewPane";

type PreviewHandleState = {
  handles: Map<number, PreviewPaneHandle>;
  activeTabId: number | null;
  registerHandle: (id: number, handle: PreviewPaneHandle | null) => void;
  setActiveTabId: (id: number | null) => void;
  getHandle: (id: number) => PreviewPaneHandle | null;
  getActiveHandle: () => PreviewPaneHandle | null;
};

export const usePreviewHandleStore = create<PreviewHandleState>((set, get) => ({
  handles: new Map(),
  activeTabId: null,
  registerHandle: (id, handle) => {
    set((state) => {
      const handles = new Map(state.handles);
      if (handle) handles.set(id, handle);
      else handles.delete(id);
      return { handles };
    });
  },
  setActiveTabId: (id) => set({ activeTabId: id }),
  getHandle: (id) => get().handles.get(id) ?? null,
  getActiveHandle: () => {
    const { handles, activeTabId } = get();
    if (activeTabId != null) {
      const active = handles.get(activeTabId);
      if (active) return active;
    }
    if (handles.size === 1) {
      return handles.values().next().value ?? null;
    }
    return null;
  },
}));
