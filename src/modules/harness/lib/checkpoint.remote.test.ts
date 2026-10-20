import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));

import {
  CheckpointUnavailableError,
  checkpointsAvailable,
  ensureSessionCheckpoint,
  keepSessionChanges,
  sessionCheckpointFileDiff,
  sessionCheckpointStats,
  sessionCheckpointStatus,
  syncSessionCheckpoint,
  undoSessionChanges,
} from "./checkpoint";

const remote = "remote://voktty-ssh-p1/srv/app";

beforeEach(() => mocks.invoke.mockReset().mockResolvedValue({ files: [] }));

describe("checkpoints on a remote project", () => {
  it("reports unavailable and never reaches the local filesystem", async () => {
    expect(checkpointsAvailable(remote)).toBe(false);
    expect(checkpointsAvailable("/home/me/app")).toBe(true);

    await ensureSessionCheckpoint("s1", remote);
    await syncSessionCheckpoint("s1", remote);
    expect(await sessionCheckpointStatus("s1", remote)).toEqual({ files: [] });
    expect(await sessionCheckpointStats(remote, ["s1"])).toEqual({});
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("refuses Keep, Undo and per-file diffs with a typed error", async () => {
    for (const action of [
      () => keepSessionChanges("s1", remote),
      () => undoSessionChanges("s1", remote, "a.ts"),
      () => sessionCheckpointFileDiff("s1", remote, "a.ts"),
    ]) {
      await expect(action()).rejects.toBeInstanceOf(CheckpointUnavailableError);
    }
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("keeps using the native checkpoints for local projects", async () => {
    await ensureSessionCheckpoint("s1", "/home/me/app");
    await sessionCheckpointStatus("s1", "/home/me/app");
    expect(mocks.invoke).toHaveBeenCalledWith("session_checkpoint_ensure", {
      sessionId: "s1",
      cwd: "/home/me/app",
    });
    expect(mocks.invoke).toHaveBeenCalledWith("session_checkpoint_status", {
      sessionId: "s1",
      cwd: "/home/me/app",
    });
  });
});