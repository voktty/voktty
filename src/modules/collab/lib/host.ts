import type {
  CollabParticipant,
  HostedTerminalInvite,
  PublishedCollabTunnel,
} from "@/modules/collab/types";
import { invoke } from "@tauri-apps/api/core";

export function startHostedTerminal(
  ptyId: number,
  cols: number,
  rows: number,
  fileRoot?: string | null,
): Promise<HostedTerminalInvite> {
  const args: {
    ptyId: number;
    cols: number;
    rows: number;
    fileRoot?: string;
  } = {
    ptyId,
    cols,
    rows,
  };
  const trimmedRoot = fileRoot?.trim();
  if (trimmedRoot) args.fileRoot = trimmedRoot;
  return invoke<HostedTerminalInvite>("collab_host_start", args);
}

export function stopHostedTerminal(ptyId: number): Promise<boolean> {
  return invoke<boolean>("collab_host_stop", { ptyId });
}

export function beginHostedSnapshotBarrier(
  ptyId: number,
  token: string,
): Promise<number> {
  return invoke<number>("collab_host_snapshot_barrier", { ptyId, token });
}

export function setHostedSnapshot(
  ptyId: number,
  sequence: number,
  cols: number,
  rows: number,
  snapshot: string,
): Promise<void> {
  return invoke<void>("collab_host_set_snapshot", {
    ptyId,
    sequence,
    cols,
    rows,
    snapshot,
  });
}

export function hostedTerminalNeedsSnapshot(ptyId: number): Promise<boolean> {
  return invoke<boolean>("collab_host_snapshot_required", { ptyId });
}

export function publishHostedTerminal(
  ptyId: number,
  customPath?: string,
): Promise<PublishedCollabTunnel> {
  return invoke<PublishedCollabTunnel>("collab_host_publish", {
    ptyId,
    customPath: customPath?.trim() || null,
  });
}

export function unpublishHostedTerminal(ptyId: number): Promise<boolean> {
  return invoke<boolean>("collab_host_unpublish", { ptyId });
}

export function getHostedParticipants(
  ptyId: number,
): Promise<CollabParticipant[]> {
  return invoke<CollabParticipant[]>("collab_host_participants", { ptyId });
}

export function grantHostedControl(
  ptyId: number,
  participantId: string,
): Promise<void> {
  return invoke<void>("collab_host_grant_control", { ptyId, participantId });
}

export function revokeHostedControl(
  ptyId: number,
  participantId: string,
): Promise<void> {
  return invoke<void>("collab_host_revoke_control", { ptyId, participantId });
}

export function removeHostedParticipant(
  ptyId: number,
  participantId: string,
): Promise<void> {
  return invoke<void>("collab_host_remove_participant", {
    ptyId,
    participantId,
  });
}

export function banHostedParticipant(
  ptyId: number,
  participantId: string,
): Promise<void> {
  return invoke<void>("collab_host_ban_participant", {
    ptyId,
    participantId,
  });
}
