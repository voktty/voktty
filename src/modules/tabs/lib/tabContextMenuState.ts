import { create } from "zustand";

interface TabContextMenuState {
  isOpen: boolean;
  setOpen: (open: boolean) => void;
}

export const useTabContextMenuStore = create<TabContextMenuState>((set) => ({
  isOpen: false,
  setOpen: (open: boolean) => set({ isOpen: open }),
}));

/**
 * Returns true if any context menu is currently open, either tracked in state
 * or present in the DOM (e.g. Radix ContextMenu / DropdownMenu portals).
 */
export function isAnyContextMenuOpen(): boolean {
  if (useTabContextMenuStore.getState().isOpen) return true;
  if (typeof document !== "undefined") {
    const activeMenu = document.querySelector(
      '[role="menu"][data-state="open"], [data-radix-menu-content][data-state="open"]',
    );
    if (activeMenu) return true;
  }
  return false;
}
