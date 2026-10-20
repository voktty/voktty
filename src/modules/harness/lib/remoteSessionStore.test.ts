import { describe, expect, it } from "vitest";
import {
  createRemoteSessionStore,
  fitBlocks,
  fromPortablePath,
  localizeRecord,
  localizeSummary,
  parseMeta,
  parseRecord,
  portablePayload,
  toPortablePath,
  type RemoteStoreIo,
} from "./remoteSessionStore";

function memoryIo(): RemoteStoreIo & { files: Map<string, string>; writes: string[] } {
  const files = new Map<string, string>();
  const writes: string[] = [];
  return {
    files,
    writes,
    read: async (path) => files.get(path) ?? null,
    write: async (path, content) => {
      writes.push(path);
      files.set(path, content);
    },
    list: async (path) =>
      [...files.keys()]
        .filter((key) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes("/"))
        .map((key) => key.slice(path.length + 1)),
    remove: async (path) => {
      files.delete(path);
    },
  };
}

const payload = (id: string, extra: Record<string, unknown> = {}) =>
  ({
    id,
    cwd: "/srv/app",
    harness: "codex",
    model: "gpt",
    modelSettings: {},
    runtimeMode: "supervised",
    title: `Chat ${id}`,
    blocks: [{ id: "b1", role: "user", text: "hola" }],
    ...extra,
  }) as never;

describe("remote session store", () => {
  it("writes the conversation, its summary and a self-ignoring folder", async () => {
    const io = memoryIo();
    let now = 1000;
    const store = createRemoteSessionStore(io, () => now);
    const summary = await store.upsert(payload("s1", { branch: "main" }));
    expect(summary).toMatchObject({ id: "s1", createdAt: 1000, updatedAt: 1000, branch: "main" });
    expect(io.files.get(".voktty/.gitignore")).toBe("*\n");
    expect([...io.files.keys()].sort()).toEqual([
      ".voktty/.gitignore",
      ".voktty/sessions/s1.json",
      ".voktty/sessions/s1.meta.json",
    ]);
    // The conversation lands before the summary that points at it.
    expect(io.writes.indexOf(".voktty/sessions/s1.json")).toBeLessThan(
      io.writes.indexOf(".voktty/sessions/s1.meta.json"),
    );

    now = 2000;
    const again = await store.upsert(payload("s1", { title: "Renamed" }));
    expect(again).toMatchObject({ createdAt: 1000, updatedAt: 2000, title: "Renamed" });
    expect(io.writes.filter((path) => path.endsWith(".gitignore"))).toHaveLength(1);
  });

  it("lists newest first, skipping damaged files, and reads a conversation back", async () => {
    const io = memoryIo();
    let now = 1;
    const store = createRemoteSessionStore(io, () => now++);
    await store.upsert(payload("old"));
    await store.upsert(payload("new"));
    io.files.set(".voktty/sessions/broken.meta.json", "{not json");
    io.files.set(".voktty/sessions/other.meta.json", JSON.stringify({ id: "wrong" }));
    io.files.set(".voktty/sessions/../escape.meta.json", "{}");

    expect((await store.list()).map((summary) => summary.id)).toEqual(["new", "old"]);
    const record = await store.get("new");
    expect(record).toMatchObject({ id: "new", title: "Chat new", cwd: "/srv/app" });
    expect(record).not.toHaveProperty("version");
    expect(await store.get("missing")).toBeNull();
    expect(await store.get("../etc/passwd")).toBeNull();
  });

  it("keeps archive and pin flags across saves and removes both files", async () => {
    const io = memoryIo();
    const store = createRemoteSessionStore(io, () => 5);
    await store.upsert(payload("s1"));
    await store.setFlag("s1", "archived", true);
    await store.setFlag("s1", "pinned", true);
    await store.upsert(payload("s1", { title: "Edited" }));
    expect((await store.list())[0]).toMatchObject({ archived: true, pinned: true, title: "Edited" });
    await store.setFlag("s1", "archived", false);
    expect((await store.list())[0].archived).toBeUndefined();

    await store.remove("s1");
    expect(await store.list()).toEqual([]);
    expect(io.files.has(".voktty/sessions/s1.json")).toBe(false);
  });

  it("refuses ids that could leave the sessions folder", async () => {
    const store = createRemoteSessionStore(memoryIo());
    await expect(store.upsert(payload("../x"))).rejects.toThrow("Invalid session id");
    await expect(store.upsert(payload("a/b"))).rejects.toThrow("Invalid session id");
  });

  it("drops the oldest blocks when a conversation would exceed the read limit", () => {
    const blocks = Array.from({ length: 10 }, (_, index) => ({ id: String(index), text: "x".repeat(100) }));
    const fitted = fitBlocks(blocks, 450);
    expect(fitted.dropped).toBe(10 - fitted.blocks.length);
    expect(fitted.blocks[fitted.blocks.length - 1]?.id).toBe("9");
    expect(fitBlocks(blocks, 10 ** 9)).toEqual({ blocks, dropped: 0 });
    expect(fitBlocks(blocks, 1).blocks).toHaveLength(1);
  });

  it("rejects files that do not match the expected id", () => {
    expect(parseMeta("[]", "s1")).toBeUndefined();
    expect(parseRecord(JSON.stringify({ id: "s2", blocks: [] }), "s1")).toBeUndefined();
    expect(parseRecord(JSON.stringify({ id: "s1", blocks: "x" }), "s1")).toBeUndefined();
    expect(parseRecord(null, "s1")).toBeUndefined();
  });
});

describe("portable folders", () => {
  it("stores host paths and rebuilds them for the connection in use", () => {
    expect(toPortablePath("remote://voktty-ssh-old/srv/app")).toBe("/srv/app");
    expect(toPortablePath("/already/plain")).toBe("/already/plain");
    expect(fromPortablePath("/srv/app", "voktty-ssh-new")).toBe("remote://voktty-ssh-new/srv/app");
    expect(fromPortablePath("remote://voktty-ssh-old/srv/app", "voktty-ssh-new")).toBe(
      "remote://voktty-ssh-new/srv/app",
    );
    expect(fromPortablePath("~", "voktty-ssh-new")).toBe("~");
  });

  it("converts payloads, summaries and records at the boundary", () => {
    const stored = portablePayload(
      payload("s1", {
        cwd: "remote://voktty-ssh-old/srv/app",
        worktreeCwd: "remote://voktty-ssh-old/srv/app-wt",
      }),
    );
    expect(stored).toMatchObject({ cwd: "/srv/app", worktreeCwd: "/srv/app-wt" });
    expect(
      localizeSummary({ id: "s1", cwd: "/srv/app" } as never, "voktty-ssh-new").cwd,
    ).toBe("remote://voktty-ssh-new/srv/app");
    expect(
      localizeRecord({ id: "s1", cwd: "/srv/app", worktreeCwd: "/srv/app-wt" } as never, "voktty-ssh-new"),
    ).toMatchObject({
      cwd: "remote://voktty-ssh-new/srv/app",
      worktreeCwd: "remote://voktty-ssh-new/srv/app-wt",
    });
  });
});