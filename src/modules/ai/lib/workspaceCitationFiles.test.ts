import { expect, it, vi } from "vitest";
import {
  createCitationFileIndex,
  isCitationRelativePath,
} from "@/modules/ai/lib/workspaceCitationFiles";
import type { WorkspaceEnv } from "@/modules/workspace";

const target = (root: string, workspace: WorkspaceEnv = { kind: "local" }) => ({
  root,
  workspace,
});
const ssh = (host: string, sessionId = 1): WorkspaceEnv => ({
  kind: "ssh",
  root: "/repo",
  sessionId,
  connection: { id: "profile", name: "Fixture", host },
});

it("isolates identical roots across full SSH binding, session and local filesystems", async () => {
  const read = vi.fn(async () => ({
    files: [`file-${read.mock.calls.length}.ts`],
    truncated: false,
  }));
  const index = createCitationFileIndex(read);
  const a = await index.load(target("/repo", ssh("a.test")));
  const b = await index.load(target("/repo", ssh("b.test")));
  const c = await index.load(target("/repo", ssh("a.test", 2)));
  const local = await index.load(target("/repo"));
  expect(new Set([a, b, c, local]).size).toBe(4);
  expect(await index.load(target("/repo", ssh("a.test")))).toBe(a);
  expect(read).toHaveBeenCalledTimes(4);
});

it("publishes admission before a reentrant reader and snapshots its original workspace", async () => {
  const original = target("/repo", ssh("a.test"));
  let joined: Promise<unknown> | undefined;
  const read = vi.fn(async () => {
    joined = index.load(target("/repo", ssh("a.test")));
    return { files: ["current.ts"], truncated: false };
  });
  const index = createCitationFileIndex(read);
  const pending = index.load(original);
  if (original.workspace.kind === "ssh")
    original.workspace.connection.host = "changed.test";
  const value = await pending;
  expect(await joined).toBe(value);
  expect(read).toHaveBeenCalledExactlyOnceWith(target("/repo", ssh("a.test")));
});

it("retains sixteen native reads and 256 joined callers until actual settlement", async () => {
  let finish!: (value: { files: string[]; truncated: boolean }) => void;
  const read = vi.fn(
    () =>
      new Promise<{ files: string[]; truncated: boolean }>((resolve) => {
        finish = resolve;
      }),
  );
  const index = createCitationFileIndex(read);
  const joined = Array.from({ length: 256 }, () =>
    index.load(target("/joined")),
  );
  await expect(index.load(target("/joined"))).rejects.toThrow("busy");
  await Promise.resolve();
  expect(read).toHaveBeenCalledTimes(1);
  finish({ files: ["done.ts"], truncated: false });
  await Promise.all(joined);
  const releases: Array<() => void> = [];
  read.mockImplementation(
    () =>
      new Promise((resolve) =>
        releases.push(() => resolve({ files: [], truncated: false })),
      ),
  );
  const pending = Array.from({ length: 16 }, (_, i) =>
    index.load(target(`/pending-${i}`)),
  );
  await expect(index.load(target("/over-capacity"))).rejects.toThrow("busy");
  for (const release of releases) release();
  await Promise.all(pending);
  read.mockResolvedValue({ files: ["fresh.ts"], truncated: false });
  expect((await index.load(target("/fresh"))).files).toEqual(["fresh.ts"]);
});

it("rejects unbounded or invalid results and releases failed cache entries for retry", async () => {
  const read = vi.fn(async () => ({
    files: ["../private.txt"],
    truncated: false,
  }));
  const index = createCitationFileIndex(read);
  await expect(index.load(target("/repo"))).rejects.toThrow("Invalid");
  read.mockResolvedValue({
    files: Array<string>(10_001).fill("file.ts"),
    truncated: false,
  });
  await expect(index.load(target("/repo"))).rejects.toThrow("limit");
  read.mockResolvedValue({ files: ["valid.ts", "valid.ts"], truncated: false });
  expect((await index.load(target("/repo"))).files).toEqual(["valid.ts"]);
});

it("evicts old scopes after sixteen cached indexes", async () => {
  const read = vi.fn(async () => ({ files: [], truncated: false }));
  const index = createCitationFileIndex(read);
  for (let i = 0; i < 17; i++) await index.load(target(`/root-${i}`));
  await index.load(target("/root-0"));
  expect(read).toHaveBeenCalledTimes(18);
});

it.each([
  "../file",
  "/absolute",
  "C:/native",
  "dir/../file",
  "dir\\file",
  "dir//file",
  "file\u0000.ts",
])("refuses unsafe relative picker path %s", (path) =>
  expect(isCitationRelativePath(path)).toBe(false),
);
