import { create } from "zustand";

export const useLayoutVisibilityStore = create<{
  focusMode: boolean;
  toggleFocus: () => void;
}>(() => ({
  focusMode: false,
  toggleFocus: () => useLayoutVisibilityStore.setState((state) => ({
    focusMode: !state.focusMode,
  })),
}));

export function toggleHarnessSessions() {
  window.dispatchEvent(new Event("voktty:toggle-harness-sessions"));
}
