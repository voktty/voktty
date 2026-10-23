import { afterEach, expect, it, vi } from "vitest";
import type { PtySession } from "@/modules/terminal/lib/pty-bridge";
const mocks = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock("@/modules/terminal/lib/pty-bridge", () => ({ openPty: mocks.open }));
vi.mock("@/modules/harness/lib/projectTerminalTarget", () => ({
  openProjectTerminalTarget: async () => undefined,
}));
import {
  captureLegacyPtyMigration,
  killAllPtys,
  spawnPty,
  startOwnedPty,
  hasLegacyPty,
} from "@/modules/harness/lib/pty";
function session(id: number) {
  return {
    id,
    close: vi.fn().mockResolvedValue(undefined),
    write: vi.fn().mockResolvedValue(undefined),
    resize: vi.fn().mockResolvedValue(undefined),
  };
}
afterEach(async () => {
  await killAllPtys();
  vi.resetAllMocks();
});

it("reserves the logical ID without retiring its original resource before confirmation", async () => {
  const pty = session(1);
  mocks.open.mockResolvedValueOnce(pty);
  const owner = startOwnedPty("confirm", "/srv/app", 80, 24);
  await owner.ready;
  const fence = captureLegacyPtyMigration("confirm");
  try {
    await owner.write("still running\r");
    expect(pty.write).toHaveBeenCalledWith("still running\r");
    expect(pty.close).not.toHaveBeenCalled();
    await expect(spawnPty("confirm", "/srv/app", 80, 24)).rejects.toThrow(
      "being migrated",
    );
    expect(mocks.open).toHaveBeenCalledOnce();
    await fence.close();
    expect(owner.isCurrent()).toBe(false);
    expect(pty.close).toHaveBeenCalledOnce();
  } finally {
    fence.release();
  }
});

it("waits for the captured opening and its native close before acknowledging migration cleanup", async () => {
  let resolve!: (pty: PtySession) => void;
  const pty = session(1);
  mocks.open.mockReturnValueOnce(
    new Promise<PtySession>((done) => {
      resolve = done;
    }),
  );
  const opening = spawnPty("opening", "/srv/app", 80, 24);
  await vi.waitFor(() => expect(mocks.open).toHaveBeenCalledOnce());
  const fence = captureLegacyPtyMigration("opening");
  let settled = false;
  const closing = fence.close().then(() => {
    settled = true;
  });
  try {
    await Promise.resolve();
    expect(settled).toBe(false);
    resolve(pty);
    await Promise.all([opening, closing]);
    expect(pty.close).toHaveBeenCalledOnce();
    expect(settled).toBe(true);
  } finally {
    fence.release();
  }
});

it("retries only its captured failed resource after releasing the fence and creating a successor", async () => {
  const oldPty = session(1);
  const next = session(2);
  mocks.open.mockResolvedValueOnce(oldPty).mockResolvedValueOnce(next);
  await spawnPty("retry", "/srv/app", 80, 24);
  const old = captureLegacyPtyMigration("retry");
  oldPty.close.mockRejectedValueOnce(new Error("close failed"));
  await expect(old.close()).rejects.toThrow("close failed");
  old.release();
  await spawnPty("retry", "/srv/app", 80, 24);
  const replacement = captureLegacyPtyMigration("retry");
  try {
    old.release();
    await old.close();
    expect(next.close).not.toHaveBeenCalled();
    await expect(spawnPty("retry", "/srv/app", 80, 24)).rejects.toThrow(
      "being migrated",
    );
    await replacement.close();
    expect(next.close).toHaveBeenCalledOnce();
  } finally {
    replacement.release();
  }
});

it("refuses an empty-only fence atomically while a live or failed native receipt remains", async () => {
  const pty = session(1);
  mocks.open.mockResolvedValueOnce(pty);
  const owner = startOwnedPty("cold-guard", "/srv/app", 80, 24);
  await owner.ready;
  expect(hasLegacyPty("cold-guard")).toBe(true);
  expect(() => captureLegacyPtyMigration("cold-guard", true)).toThrow(
    "foreground",
  );
  expect(owner.isCurrent()).toBe(true);
  expect(pty.close).not.toHaveBeenCalled();
  pty.close.mockRejectedValueOnce(new Error("native cleanup pending"));
  await expect(owner.close()).rejects.toThrow("native cleanup pending");
  expect(hasLegacyPty("cold-guard")).toBe(true);
  expect(() => captureLegacyPtyMigration("cold-guard", true)).toThrow(
    "foreground",
  );
  await owner.close();
  expect(hasLegacyPty("cold-guard")).toBe(false);
  const empty = captureLegacyPtyMigration("cold-guard", true);
  await empty.close();
  empty.release();
});
