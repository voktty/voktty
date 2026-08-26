import {
  banParticipant,
  hostedTerminalForLeaf,
  removeParticipant,
  setHostedParticipantControl,
  startHostedShare,
  stopHostedShare,
  useCollabHostStore,
} from "@/modules/collab/lib/hostRuntime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createShare: vi.fn(),
  banParticipant: vi.fn(),
  getParticipants: vi.fn(),
  grantControl: vi.fn(),
  needsSnapshot: vi.fn(),
  removeParticipant: vi.fn(),
  synchronizeSnapshot: vi.fn(),
  stop: vi.fn(),
}));

vi.mock("@/modules/collab/lib/host", () => ({
  banHostedParticipant: mocks.banParticipant,
  getHostedParticipants: mocks.getParticipants,
  grantHostedControl: mocks.grantControl,
  hostedTerminalNeedsSnapshot: mocks.needsSnapshot,
  removeHostedParticipant: mocks.removeParticipant,
  revokeHostedControl: vi.fn(),
  stopHostedTerminal: mocks.stop,
}));

vi.mock("@/modules/collab/lib/sharing", () => ({
  createHostedShare: mocks.createShare,
}));

vi.mock("@/modules/collab/lib/snapshot", () => ({
  synchronizeHostedTerminalSnapshot: mocks.synchronizeSnapshot,
}));

const target = {
  leafId: 3,
  ptyId: 7,
  cols: 100,
  rows: 30,
  title: "Terminal",
};

describe("host collaboration runtime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    useCollabHostStore.setState({ sessions: {} });
    mocks.createShare.mockResolvedValue({
      invite: {
        sessionId: "session-1",
        inviteCode: "code-1",
        loopbackUrl: "ws://127.0.0.1/session-1",
        expiresAtMs: 1,
      },
      tunnel: {
        publicUrl: "https://example.trycloudflare.com",
        connectionUrl: "wss://example.trycloudflare.com/session-1",
      },
    });
    mocks.needsSnapshot.mockResolvedValue(true);
    mocks.getParticipants.mockResolvedValue([]);
    mocks.banParticipant.mockResolvedValue(undefined);
    mocks.grantControl.mockResolvedValue(undefined);
    mocks.removeParticipant.mockResolvedValue(undefined);
    mocks.synchronizeSnapshot.mockResolvedValue(undefined);
    mocks.stop.mockResolvedValue(true);
  });

  afterEach(async () => {
    if (useCollabHostStore.getState().sessions[target.ptyId]) {
      await stopHostedShare(target.ptyId);
    }
    vi.useRealTimers();
  });

  it("refreshes a snapshot before bounded replay loses continuity", async () => {
    await startHostedShare(target);
    await vi.advanceTimersByTimeAsync(1000);

    expect(mocks.needsSnapshot).toHaveBeenCalledWith(target.ptyId);
    expect(mocks.synchronizeSnapshot).toHaveBeenCalledWith(
      target.leafId,
      target.ptyId,
    );

    await stopHostedShare(target.ptyId);
    mocks.needsSnapshot.mockClear();
    await vi.advanceTimersByTimeAsync(2000);
    expect(mocks.needsSnapshot).not.toHaveBeenCalled();
  });

  it("keeps participants current while the terminal is shared", async () => {
    const participant = {
      id: "participant-1",
      name: "Ada",
      role: "observer" as const,
      controlRequested: true,
      typing: true,
    };
    mocks.getParticipants.mockResolvedValue([participant]);

    await startHostedShare(target);
    await vi.advanceTimersByTimeAsync(0);

    expect(mocks.getParticipants).toHaveBeenCalledWith(target.ptyId);
    expect(
      useCollabHostStore.getState().sessions[target.ptyId]?.participants,
    ).toEqual([participant]);
    expect(
      hostedTerminalForLeaf(
        useCollabHostStore.getState().sessions,
        target.leafId,
      )?.ptyId,
    ).toBe(target.ptyId);
    expect(
      useCollabHostStore.getState().sessions[target.ptyId]?.participants[0]
        ?.controlRequested,
    ).toBe(true);
    expect(
      useCollabHostStore.getState().sessions[target.ptyId]?.participants[0]
        ?.typing,
    ).toBe(true);

    await stopHostedShare(target.ptyId);
    mocks.getParticipants.mockClear();
    await vi.advanceTimersByTimeAsync(4000);
    expect(mocks.getParticipants).not.toHaveBeenCalled();
  });

  it("surfaces participant action failures on the hosted session", async () => {
    await startHostedShare(target);
    mocks.grantControl.mockRejectedValueOnce(new Error("control failed"));

    await expect(
      setHostedParticipantControl(target.ptyId, "participant-1", true),
    ).rejects.toThrow("control failed");
    expect(
      useCollabHostStore.getState().sessions[target.ptyId]?.error,
    ).toContain("control failed");

    mocks.removeParticipant.mockRejectedValueOnce(new Error("remove failed"));
    await expect(
      removeParticipant(target.ptyId, "participant-1"),
    ).rejects.toThrow("remove failed");
    expect(
      useCollabHostStore.getState().sessions[target.ptyId]?.error,
    ).toContain("remove failed");

    mocks.banParticipant.mockRejectedValueOnce(new Error("ban failed"));
    await expect(banParticipant(target.ptyId, "participant-1")).rejects.toThrow(
      "ban failed",
    );
    expect(
      useCollabHostStore.getState().sessions[target.ptyId]?.error,
    ).toContain("ban failed");
  });
});
