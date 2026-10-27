// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  attachmentsFromFiles,
  attachmentsFromPaths,
  pickAttachments,
  mergeAttachments,
  MAX_ATTACHMENTS,
} from "@/modules/harness/lib/attachments";

const io = vi.hoisted(() => ({ invoke: vi.fn(), pick: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: io.invoke }));
vi.mock("@/modules/harness/lib/fs", () => ({
  basename: (path: string) => path.split(/[/\\]/).pop() ?? path,
  pickFiles: io.pick,
}));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
let current: boolean;
const guard = () => {
  if (!current) throw new DOMException("Retired", "AbortError");
};
const info = {
  path: "/project/image.png",
  name: "image.png",
  size: 12,
  isDir: false,
};
beforeEach(() => {
  current = true;
  io.invoke.mockReset();
  io.pick.mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("does not begin image reads after retirement during path inspection", async () => {
  const pending = deferred<(typeof info)[]>();
  io.invoke.mockReturnValue(pending.promise);
  const work = attachmentsFromPaths([info.path], guard);
  current = false;
  pending.resolve([info]);
  await expect(work).rejects.toMatchObject({ name: "AbortError" });
  expect(io.invoke).toHaveBeenCalledTimes(1);
});
it("does not inspect a picker result after retirement", async () => {
  const pending = deferred<string[]>();
  io.pick.mockReturnValue(pending.promise);
  const work = pickAttachments(guard);
  current = false;
  pending.resolve([info.path]);
  await expect(work).rejects.toMatchObject({ name: "AbortError" });
  expect(io.invoke).not.toHaveBeenCalled();
});
it("does not convert retirement during a failed image read into a path fallback", async () => {
  io.invoke.mockImplementation(async (command: string) => {
    if (command === "inspect_paths") return [info];
    current = false;
    throw new Error("read failed");
  });
  await expect(attachmentsFromPaths([info.path], guard)).rejects.toMatchObject({
    name: "AbortError",
  });
});
it("keeps current folder references local without reading their contents", async () => {
  io.invoke.mockResolvedValue([
    { ...info, path: "C:/project/folder", name: "folder", isDir: true },
  ]);
  const result = await attachmentsFromPaths(["C:/project/folder"], guard);
  expect(result).toEqual([
    expect.objectContaining({
      path: "C:/project/folder",
      mimeType: "inode/directory",
    }),
  ]);
  expect(io.invoke).toHaveBeenCalledOnce();
});
it("does not begin a second image read after the first retires", async () => {
  io.invoke.mockImplementation(async (command: string) => {
    if (command === "inspect_paths")
      return [info, { ...info, path: "/project/second.png" }];
    current = false;
    return "aW1hZ2U=";
  });
  await expect(
    attachmentsFromPaths([info.path, "/project/second.png"], guard),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(io.invoke).toHaveBeenCalledTimes(2);
});
it("retains ordinary image-read fallback for a current caller", async () => {
  io.invoke.mockImplementation(async (command: string) => {
    if (command === "inspect_paths") return [info];
    throw new Error("image unavailable");
  });
  const result = await attachmentsFromPaths([info.path], guard);
  expect(result[0].path).toBe(info.path);
  expect(result[0].data).toBeUndefined();
});
it("releases an image preview URL after retirement during blob reading", async () => {
  vi.stubGlobal("FileReader", undefined);
  const pending = deferred<ArrayBuffer>(),
    file = new File(["image"], "image.png", { type: "image/png" });
  vi.spyOn(file, "arrayBuffer").mockReturnValue(pending.promise);
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fixture");
  const work = attachmentsFromFiles([file], guard);
  current = false;
  pending.resolve(new ArrayBuffer(3));
  await expect(work).rejects.toMatchObject({ name: "AbortError" });
  expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:fixture");
  expect(io.invoke).not.toHaveBeenCalled();
});
it("does not persist a blob after its original caller retires", async () => {
  vi.stubGlobal("FileReader", undefined);
  const pending = deferred<ArrayBuffer>(),
    file = new File(["document"], "report.txt", { type: "text/plain" });
  vi.spyOn(file, "arrayBuffer").mockReturnValue(pending.promise);
  const work = attachmentsFromFiles([file], guard);
  current = false;
  pending.resolve(new ArrayBuffer(3));
  await expect(work).rejects.toMatchObject({ name: "AbortError" });
  expect(io.invoke).not.toHaveBeenCalled();
});
it("counts retired inspections until settlement and then recovers intake capacity", async () => {
  const pending = deferred<(typeof info)[]>();
  io.invoke.mockReturnValue(pending.promise);
  const requests = Array.from({ length: 256 }, () =>
    attachmentsFromPaths([info.path], guard).catch(() => null),
  );
  current = false;
  await expect(attachmentsFromPaths([info.path])).rejects.toThrow("capacity");
  expect(io.invoke).toHaveBeenCalledTimes(256);
  pending.resolve([info]);
  await Promise.all(requests);
  current = true;
  io.invoke.mockResolvedValue([{ ...info, isDir: true }]);
  expect(await attachmentsFromPaths([info.path], guard)).toHaveLength(1);
});

it("does not admit another attachment into an already full Composer", () => {
  const existing = Array.from({ length: MAX_ATTACHMENTS }, (_, id) => ({
    id: String(id),
    name: String(id),
    mimeType: "text/plain",
    kind: "file" as const,
    size: 1,
  }));
  const incoming = { ...existing[0], id: "overflow", name: "overflow" };
  expect(mergeAttachments(existing, [incoming])).toEqual(existing);
});
