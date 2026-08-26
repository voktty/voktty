import {
  banHostedParticipant,
  getHostedParticipants,
  grantHostedControl,
  hostedTerminalNeedsSnapshot,
  removeHostedParticipant,
  revokeHostedControl,
  stopHostedTerminal,
} from "@/modules/collab/lib/host";
import {
  createHostedShare,
  type HostedShare,
  type HostedTerminalTarget,
} from "@/modules/collab/lib/sharing";
import { synchronizeHostedTerminalSnapshot } from "@/modules/collab/lib/snapshot";
import type { CollabParticipant } from "@/modules/collab/types";
import { create } from "zustand";

export type HostedTerminalView = HostedTerminalTarget & {
  title: string;
  status: "starting" | "ready" | "stopping" | "error";
  share: HostedShare | null;
  participants: CollabParticipant[];
  error: string | null;
};

type HostStore = {
  sessions: Record<number, HostedTerminalView>;
};

export const useCollabHostStore = create<HostStore>(() => ({ sessions: {} }));

const SNAPSHOT_MAINTENANCE_MS = 1000;
const PARTICIPANT_MAINTENANCE_MS = 400;
const snapshotTimers = new Map<number, ReturnType<typeof setInterval>>();
const snapshotRefreshes = new Set<number>();
const participantTimers = new Map<number, ReturnType<typeof setInterval>>();
const participantRefreshes = new Set<number>();

function stopSnapshotMaintenance(ptyId: number): void {
  const timer = snapshotTimers.get(ptyId);
  if (timer !== undefined) clearInterval(timer);
  snapshotTimers.delete(ptyId);
  snapshotRefreshes.delete(ptyId);
}

function stopParticipantMaintenance(ptyId: number): void {
  const timer = participantTimers.get(ptyId);
  if (timer !== undefined) clearInterval(timer);
  participantTimers.delete(ptyId);
  participantRefreshes.delete(ptyId);
}

async function maintainHostedSnapshot(
  target: HostedTerminalTarget,
): Promise<void> {
  if (snapshotRefreshes.has(target.ptyId)) return;
  snapshotRefreshes.add(target.ptyId);
  try {
    let required: boolean;
    try {
      required = await hostedTerminalNeedsSnapshot(target.ptyId);
    } catch {
      stopSnapshotMaintenance(target.ptyId);
      return;
    }
    if (required) {
      await synchronizeHostedTerminalSnapshot(target.leafId, target.ptyId);
    }
  } catch {
  } finally {
    snapshotRefreshes.delete(target.ptyId);
  }
}

function startSnapshotMaintenance(target: HostedTerminalTarget): void {
  stopSnapshotMaintenance(target.ptyId);
  snapshotTimers.set(
    target.ptyId,
    setInterval(
      () => void maintainHostedSnapshot(target),
      SNAPSHOT_MAINTENANCE_MS,
    ),
  );
}

async function maintainHostedParticipants(ptyId: number): Promise<void> {
  if (participantRefreshes.has(ptyId)) return;
  participantRefreshes.add(ptyId);
  try {
    await refreshHostedParticipants(ptyId);
  } catch {
  } finally {
    participantRefreshes.delete(ptyId);
  }
}

function startParticipantMaintenance(ptyId: number): void {
  stopParticipantMaintenance(ptyId);
  void maintainHostedParticipants(ptyId);
  participantTimers.set(
    ptyId,
    setInterval(
      () => void maintainHostedParticipants(ptyId),
      PARTICIPANT_MAINTENANCE_MS,
    ),
  );
}

function setHostedView(ptyId: number, view: HostedTerminalView): void {
  useCollabHostStore.setState((state) => ({
    sessions: { ...state.sessions, [ptyId]: view },
  }));
}

function patchHostedView(
  ptyId: number,
  patch: Partial<HostedTerminalView>,
): void {
  useCollabHostStore.setState((state) => {
    const current = state.sessions[ptyId];
    if (!current) return state;
    return {
      sessions: {
        ...state.sessions,
        [ptyId]: { ...current, ...patch },
      },
    };
  });
}

export async function startHostedShare(
  target: HostedTerminalTarget & { title: string },
  customPath?: string,
): Promise<void> {
  stopSnapshotMaintenance(target.ptyId);
  stopParticipantMaintenance(target.ptyId);
  setHostedView(target.ptyId, {
    ...target,
    status: "starting",
    share: null,
    participants: [],
    error: null,
  });
  try {
    const share = await createHostedShare(target, undefined, customPath);
    patchHostedView(target.ptyId, { status: "ready", share });
    startSnapshotMaintenance(target);
    startParticipantMaintenance(target.ptyId);
  } catch (error) {
    patchHostedView(target.ptyId, {
      status: "error",
      error: String(error),
    });
    throw error;
  }
}

export async function stopHostedShare(ptyId: number): Promise<void> {
  stopSnapshotMaintenance(ptyId);
  stopParticipantMaintenance(ptyId);
  patchHostedView(ptyId, { status: "stopping", error: null });
  try {
    await stopHostedTerminal(ptyId);
    useCollabHostStore.setState((state) => {
      const sessions = { ...state.sessions };
      delete sessions[ptyId];
      return { sessions };
    });
  } catch (error) {
    const current = useCollabHostStore.getState().sessions[ptyId];
    if (current) {
      startSnapshotMaintenance(current);
      startParticipantMaintenance(ptyId);
    }
    patchHostedView(ptyId, { status: "error", error: String(error) });
    throw error;
  }
}

export function hostedTerminalForLeaf(
  sessions: Record<number, HostedTerminalView>,
  leafId: number,
): HostedTerminalView | undefined {
  return Object.values(sessions).find(
    (session) => session.leafId === leafId && session.share !== null,
  );
}

export async function refreshHostedParticipants(ptyId: number): Promise<void> {
  const participants = await getHostedParticipants(ptyId);
  patchHostedView(ptyId, { participants });
}

export async function setHostedParticipantControl(
  ptyId: number,
  participantId: string,
  enabled: boolean,
): Promise<void> {
  try {
    if (enabled) await grantHostedControl(ptyId, participantId);
    else await revokeHostedControl(ptyId, participantId);
    await refreshHostedParticipants(ptyId);
    patchHostedView(ptyId, { error: null });
  } catch (error) {
    patchHostedView(ptyId, { error: String(error) });
    throw error;
  }
}

export async function removeParticipant(
  ptyId: number,
  participantId: string,
): Promise<void> {
  try {
    await removeHostedParticipant(ptyId, participantId);
    await refreshHostedParticipants(ptyId);
    patchHostedView(ptyId, { error: null });
  } catch (error) {
    patchHostedView(ptyId, { error: String(error) });
    throw error;
  }
}

export async function banParticipant(
  ptyId: number,
  participantId: string,
): Promise<void> {
  try {
    await banHostedParticipant(ptyId, participantId);
    await refreshHostedParticipants(ptyId);
    patchHostedView(ptyId, { error: null });
  } catch (error) {
    patchHostedView(ptyId, { error: String(error) });
    throw error;
  }
}
