import { expect, it, vi } from "vitest";
import { createProjectMemoryReader } from "@/modules/ai/lib/projectMemory";
import type { ReadResult } from "@/modules/ai/lib/native";
import type { AiFileRootContext } from "@/modules/ai/lib/aiFileContext";

const source: AiFileRootContext = {
  root: "/fixture",
  workspace: { kind: "local" },
};
const current = () => {};
const text = (content: string): ReadResult => ({
  kind: "text",
  content,
  size: content.length,
});
function fixture(
  options: Parameters<typeof createProjectMemoryReader>[1] = {},
) {
  const canonicalize = vi.fn(async (path: string) => path);
  const readFile = vi.fn<
    (
      path: string,
      workspace: AiFileRootContext["workspace"],
    ) => Promise<ReadResult>
  >(async () => text("memory"));
  return {
    canonicalize,
    readFile,
    reader: createProjectMemoryReader({ canonicalize, readFile }, options),
  };
}

it("bounds LRU snapshots and expires a cached memory after thirty seconds", async () => {
  let now = 0;
  const f = fixture({ cacheSize: 2, now: () => now });
  const a = { ...source, root: "/a" },
    b = { ...source, root: "/b" },
    c = { ...source, root: "/c" };
  await f.reader.read(a, current);
  await f.reader.read(b, current);
  await f.reader.read(a, current);
  expect(f.readFile).toHaveBeenCalledTimes(2);
  await f.reader.read(c, current);
  await f.reader.read(b, current);
  expect(f.readFile).toHaveBeenCalledTimes(4);
  now = 30_000;
  await f.reader.read(b, current);
  expect(f.readFile).toHaveBeenCalledTimes(5);
});

it("retains cancelled IO capacity until its native promise settles and never caches its result", async () => {
  const f = fixture({ limit: 1 });
  let active = true;
  const guard = () => {
    if (!active) throw new Error("retired");
  };
  let finish!: (result: ReadResult) => void;
  f.readFile.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const pending = f.reader.read(source, guard);
  const observed = expect(pending).rejects.toThrow("retired");
  await vi.waitFor(() => expect(f.readFile).toHaveBeenCalledTimes(1));
  active = false;
  await expect(
    f.reader.read({ ...source, root: "/other" }, current),
  ).rejects.toThrow("Too many");
  finish(text("late"));
  await observed;
  expect(await f.reader.read(source, current)).toBe("memory");
  expect(f.readFile).toHaveBeenCalledTimes(2);
});

it("does not let an older completion replace a newer snapshot", async () => {
  const f = fixture();
  let finish!: (result: ReadResult) => void;
  f.readFile.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const old = f.reader.read(source, current);
  await vi.waitFor(() => expect(f.readFile).toHaveBeenCalledTimes(1));
  f.readFile.mockResolvedValueOnce(text("new"));
  expect(await f.reader.read(source, current)).toBe("new");
  finish(text("old"));
  expect(await old).toBe("old");
  expect(await f.reader.read(source, current)).toBe("new");
  expect(f.readFile).toHaveBeenCalledTimes(2);
});

it("captures the SSH descriptor before root canonicalization awaits", async () => {
  const f = fixture();
  const original: AiFileRootContext = {
    root: "/fixture",
    workspace: {
      kind: "ssh",
      root: "/fixture",
      sessionId: 7,
      connection: { id: "fixture", name: "Original", host: "fixture.invalid" },
    },
  };
  let finish!: (root: string) => void;
  f.canonicalize.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const pending = f.reader.read(original, current);
  original.workspace = {
    kind: "ssh",
    root: "/",
    sessionId: 8,
    connection: { id: "replacement", name: "Other", host: "other.invalid" },
  };
  finish("/fixture");
  await pending;
  expect(f.readFile).toHaveBeenCalledExactlyOnceWith("/fixture/VOKTTY.md", {
    kind: "ssh",
    root: "/fixture",
    sessionId: 7,
    connection: { id: "fixture", name: "Original", host: "fixture.invalid" },
  });
});

it.each([
  { root: "/", path: "/VOKTTY.md" },
  { root: "C:/fixture", path: "C:/fixture/VOKTTY.md" },
  {
    root: "\\\\server\\share\\fixture",
    path: "\\\\server\\share\\fixture\\VOKTTY.md",
  },
])("retains native root and UNC forms: $root", async ({ root, path }) => {
  const f = fixture();
  await f.reader.read({ root, workspace: { kind: "local" } }, current);
  expect(f.readFile).toHaveBeenCalledExactlyOnceWith(path, { kind: "local" });
});

it("does not reinterpret a remote Windows-looking root as this computer", async () => {
  const f = fixture();
  await f.reader.read(
    {
      root: "C:/fixture",
      workspace: {
        kind: "ssh",
        root: "/fixture",
        sessionId: 7,
        connection: {
          id: "fixture",
          name: "Original",
          host: "fixture.invalid",
        },
      },
    },
    current,
  );
  expect(f.canonicalize).not.toHaveBeenCalled();
  expect(f.readFile).not.toHaveBeenCalled();
});

it("preserves an empty primary memory and caches missing memory without extra reads", async () => {
  const f = fixture();
  f.readFile.mockResolvedValueOnce(text(""));
  expect(await f.reader.read(source, current)).toBe("");
  expect(f.readFile).toHaveBeenCalledTimes(1);
  f.readFile.mockResolvedValue({ kind: "binary", size: 8 });
  const absent = { ...source, root: "/absent" };
  expect(await f.reader.read(absent, current)).toBeNull();
  expect(await f.reader.read(absent, current)).toBeNull();
  expect(f.readFile).toHaveBeenCalledTimes(3);
});

it("clips Unicode without retaining an unpaired high surrogate", async () => {
  const f = fixture();
  f.readFile.mockResolvedValueOnce(
    text(`${"x".repeat(32767)}${String.fromCodePoint(0x20000)}tail`),
  );
  const result = await f.reader.read(source, current);
  expect(result).toBe("x".repeat(32767));
});

it("refuses oversized roots and descriptor keys before filesystem IO", async () => {
  const f = fixture();
  await f.reader.read({ ...source, root: `/${"x".repeat(32768)}` }, current);
  await f.reader.read(
    {
      root: "/fixture",
      workspace: {
        kind: "ssh",
        root: "/fixture",
        sessionId: 7,
        connection: {
          id: "fixture",
          name: "x".repeat(65536),
          host: "fixture.invalid",
        },
      },
    },
    current,
  );
  expect(f.canonicalize).not.toHaveBeenCalled();
});

it("keeps bounded TTL snapshots separate between native context owners at the same path", async () => {
  let now = 0;
  const f = fixture({ cacheSize: 2, now: () => now });
  const original = {},
    replacement = {},
    sibling = {};
  f.readFile.mockResolvedValueOnce(text("original rules"));
  expect(await f.reader.read(source, current, original)).toBe("original rules");
  f.readFile.mockResolvedValueOnce(text("replacement rules"));
  expect(await f.reader.read(source, current, replacement)).toBe(
    "replacement rules",
  );
  expect(await f.reader.read(source, current, original)).toBe("original rules");
  expect(f.readFile).toHaveBeenCalledTimes(2);
  await f.reader.read(source, current, sibling);
  await f.reader.read(source, current, replacement);
  expect(f.readFile).toHaveBeenCalledTimes(4);
  now = 30_000;
  await f.reader.read(source, current, original);
  expect(f.readFile).toHaveBeenCalledTimes(5);
});
it("does not let a previous context's late completion populate a replacement context's cache", async () => {
  const f = fixture();
  const original = {},
    replacement = {};
  let finish!: (result: ReadResult) => void;
  f.readFile.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const pending = f.reader.read(source, current, original);
  await vi.waitFor(() => expect(f.readFile).toHaveBeenCalledTimes(1));
  f.readFile.mockResolvedValueOnce(text("replacement rules"));
  expect(await f.reader.read(source, current, replacement)).toBe(
    "replacement rules",
  );
  finish(text("old rules"));
  expect(await pending).toBe("old rules");
  expect(await f.reader.read(source, current, replacement)).toBe(
    "replacement rules",
  );
  expect(f.readFile).toHaveBeenCalledTimes(2);
});
