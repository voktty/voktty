import { create } from "zustand";
import type { LiveAgent } from "./liveAgents";
import type { Session } from "./session";

export type NotchApprovalHandler = (
  sessionId: string,
  approvalId: number,
  decision: "allow" | "deny",
) => void;

export type NotchSubmitHandler = (sessionId: string, text: string) => void;

interface NotchState {
  expanded: boolean;
  activeAgentId: string | null;
  idleLauncherOpen: boolean;
  liveAgents: LiveAgent[];
  sessions: Session[];
  onApproval: NotchApprovalHandler | null;
  onSubmit: NotchSubmitHandler | null;

  setExpanded: (expanded: boolean) => void;
  toggleExpanded: () => void;
  setActiveAgentId: (id: string | null) => void;
  setIdleLauncherOpen: (open: boolean) => void;
  toggleIdleLauncher: () => void;

  syncHarnessState: (data: {
    liveAgents: LiveAgent[];
    sessions: Session[];
    onApproval?: NotchApprovalHandler;
    onSubmit?: NotchSubmitHandler;
  }) => void;
  clearHarnessState: () => void;
}

export const useNotchStore = create<NotchState>((set) => ({
  expanded: false,
  activeAgentId: null,
  idleLauncherOpen: false,
  liveAgents: [],
  sessions: [],
  onApproval: null,
  onSubmit: null,

  setExpanded: (expanded) => set({ expanded }),
  toggleExpanded: () => set((state) => ({ expanded: !state.expanded })),
  setActiveAgentId: (activeAgentId) => set({ activeAgentId }),
  setIdleLauncherOpen: (idleLauncherOpen) => set({ idleLauncherOpen }),
  toggleIdleLauncher: () =>
    set((state) => ({ idleLauncherOpen: !state.idleLauncherOpen })),

  syncHarnessState: ({ liveAgents, sessions, onApproval, onSubmit }) =>
    set((state) => {
      // Keep activeAgentId pointing to a valid running agent if possible
      let nextActiveId = state.activeAgentId;
      if (!liveAgents.some((a) => a.id === nextActiveId)) {
        nextActiveId = liveAgents[0]?.id ?? null;
      }
      return {
        liveAgents,
        sessions,
        onApproval: onApproval ?? state.onApproval,
        onSubmit: onSubmit ?? state.onSubmit,
        activeAgentId: nextActiveId,
      };
    }),

  clearHarnessState: () =>
    set({
      liveAgents: [],
      sessions: [],
      activeAgentId: null,
      onApproval: null,
      onSubmit: null,
    }),
}));
