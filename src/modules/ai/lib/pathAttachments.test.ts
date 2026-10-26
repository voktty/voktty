import { expect, it, vi } from "vitest";
import { readPathAttachment } from "@/modules/ai/lib/pathAttachments";
const io = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@/modules/ai/lib/native", () => ({ native: { readFile: io.read } }));

it("uses its original explicit SSH filesystem and distinguishes same-path files", async () => {
  io.read.mockResolvedValue({ kind: "text", content: "original", size: 8 });
  const workspace = {
    kind: "ssh" as const,
    root: "/repo",
    sessionId: 1,
    connection: { id: "fixture", name: "Fixture", host: "a.test" },
  };
  const pending = readPathAttachment("/repo/file.ts", workspace, () => true);
  workspace.connection.host = "changed.test";
  const original = await pending;
  expect(io.read).toHaveBeenLastCalledWith(
    "/repo/file.ts",
    expect.objectContaining({
      connection: expect.objectContaining({ host: "a.test" }),
    }),
  );
  const local = await readPathAttachment(
    "/repo/file.ts",
    { kind: "local" },
    () => true,
  );
  expect(original?.id).not.toBe(local?.id);
});

it("retains sixteen pending reads through retirement and never publishes their late text", async () => {
  let current = true;
  const releases: Array<
    (result: { kind: "text"; content: string; size: number }) => void
  > = [];
  io.read.mockImplementation(
    () => new Promise((resolve) => releases.push(resolve)),
  );
  const pending = Array.from({ length: 16 }, () =>
    readPathAttachment("/repo/file.ts", { kind: "local" }, () => current),
  );
  await vi.dynamicImportSettled();
  expect(releases).toHaveLength(16);
  current = false;
  expect(
    await readPathAttachment("/repo/fresh.ts", { kind: "local" }, () => true),
  ).toBeNull();
  for (const release of releases)
    release({ kind: "text", content: "late", size: 4 });
  expect(await Promise.all(pending)).toEqual(Array(16).fill(null));
  io.read.mockResolvedValue({ kind: "text", content: "fresh", size: 5 });
  expect(
    await readPathAttachment("/repo/fresh.ts", { kind: "local" }, () => true),
  ).toEqual(expect.objectContaining({ text: "fresh" }));
});

it("refuses unresolved and relative targets before native IO", async () => {
  io.read.mockClear();
  for (const path of [
    "remote://profile/repo/file.ts",
    "relative.ts",
    "file\u0000.ts",
  ]) {
    expect(
      await readPathAttachment(path, { kind: "local" }, () => true),
    ).toBeNull();
  }
  expect(io.read).not.toHaveBeenCalled();
});
