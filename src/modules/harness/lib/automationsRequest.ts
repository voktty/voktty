import { create } from "zustand";

type AutomationsRequestState = {
  pending: boolean;
  request: () => void;
  /** Takes the request; true only for the first caller that sees it. */
  consume: () => boolean;
};

/**
 * The status bar lives outside the Harness tree. It asks for the full
 * Automations view here, and the focused visible Harness consumes the request,
 * so it survives a Harness tab that is still mounting.
 */
export const useAutomationsRequest = create<AutomationsRequestState>(
  (set, get) => ({
    pending: false,
    request: () => set({ pending: true }),
    consume: () => {
      if (!get().pending) return false;
      set({ pending: false });
      return true;
    },
  }),
);
