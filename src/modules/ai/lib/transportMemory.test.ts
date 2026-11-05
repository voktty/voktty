import { beforeEach, expect, it, vi } from "vitest";
import type { ToolContext } from "@/modules/ai/tools/context";
import type { WorkspaceEnv } from "@/modules/workspace";
import { fileToolCallsFor } from "@/modules/ai/lib/fileToolCalls";
import { createContextAwareTransport } from "@/modules/ai/lib/transport";
import { EMPTY_PROVIDER_KEYS } from "@/modules/ai/lib/keyring";

const io = vi.hoisted(() => ({
  readFile: vi.fn(),
  canonicalize: vi.fn(),
  run: vi.fn(),
}));
vi.mock("@/modules/ai/lib/native", () => ({ native: io }));
vi.mock("@/modules/ai/lib/agent", () => ({ runAgentStream: io.run }));
let sequence = 0;
beforeEach(() => {
  vi.resetAllMocks();
  io.canonicalize.mockImplementation(async (path: string) => {
    if (path.endsWith("/.voktty/INIT.md")) throw new Error("missing guide");
    return path;
  });
  io.readFile.mockResolvedValue({ kind: "text", content: "original", size: 8 });
  io.run.mockResolvedValue({
    toUIMessageStream: () =>
      new ReadableStream({ start: (controller) => controller.close() }),
  });
});
function fixture() {
  let root = `/fixture/memory-${++sequence}`;
  let workspace: WorkspaceEnv = { kind: "local" };
  let model = "original-model";
  const ctx: ToolContext = {
    getCwd: () => root,
    getWorkspaceRoot: () => root,
    getFileRootContext: () => ({ root, workspace }),
    getTerminalContext: () => null,
    isActiveTerminalPrivate: () => false,
    injectIntoActivePty: () => false,
    openPreview: () => false,
    spawnAgent: () => null,
    readAgentOutput: () => null,
    readCache: new Map(),
    getSessionId: () => "fixture",
  };
  const transport = createContextAwareTransport({
    getKeys: () => ({ ...EMPTY_PROVIDER_KEYS }),
    toolContext: ctx,
    getModelId: () => model,
    getCustomInstructions: () => "",
    getAgentPersona: () => null,
    getLive: () => ({
      cwd: root,
      workspaceRoot: root,
      activeFile: null,
      terminalPrivate: false,
    }),
  });
  return {
    ctx,
    root,
    send: (abortSignal?: AbortSignal) =>
      transport.sendMessages({ messages: [], abortSignal }),
    changeFilesystem: (next: WorkspaceEnv) => {
      workspace = next;
    },
    move: () => {
      root = "/fixture/replacement";
      workspace = { kind: "wsl", distro: "replacement" };
      model = "replacement-model";
    },
  };
}

it.each([true, false])(
  "loads the project guide with root instructions available=%s",
  async (hasRoot) => {
    const f = fixture();
    io.canonicalize.mockImplementation(async (path: string) => path);
    io.readFile.mockImplementation(async (path: string) => {
      if (path.endsWith("/.voktty/INIT.md"))
        return {
          kind: "text",
          content: "Read CONTEXT.md and leave a handoff.",
          size: 34,
        };
      if (hasRoot) return { kind: "text", content: "Project rules", size: 13 };
      throw new Error("missing root instructions");
    });
    await f.send();
    const run = io.run.mock.calls[0][0];
    expect(run.projectMemory).toContain("## .voktty/INIT.md");
    expect(run.projectMemory).toContain("Read CONTEXT.md and leave a handoff.");
    expect(run.projectMemory).toContain("respecting read-only requests");
    expect(run.projectMemory.includes("Project rules")).toBe(hasRoot);
    expect(io.readFile).toHaveBeenCalledWith(`${f.root}/.voktty/INIT.md`, {
      kind: "local",
    });
  },
);

it("cancels a request while the project guide is pending", async () => {
  const f = fixture();
  const abort = new AbortController();
  let finish!: (value: unknown) => void;
  io.canonicalize.mockImplementation(async (path: string) => path);
  io.readFile.mockImplementation(async (path: string) => {
    if (path.endsWith("/.voktty/INIT.md"))
      return new Promise((resolve) => {
        finish = resolve;
      });
    return { kind: "text", content: "root rules", size: 10 };
  });
  const pending = f.send(abort.signal);
  const outcome = expect(pending).rejects.toThrow("retired");
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  abort.abort();
  finish({ kind: "text", content: "late guide", size: 10 });
  await outcome;
  expect(io.run).not.toHaveBeenCalled();
});

it("isolates equal project paths on different filesystems", async () => {
  const f = fixture();
  io.readFile
    .mockResolvedValueOnce({ kind: "text", content: "local memory", size: 12 })
    .mockResolvedValueOnce({ kind: "text", content: "other memory", size: 12 });
  await f.send();
  f.changeFilesystem({ kind: "wsl", distro: "other" });
  await f.send();
  expect(io.run.mock.calls.map(([options]) => options.projectMemory)).toEqual([
    "local memory",
    "other memory",
  ]);
  expect(io.readFile.mock.calls.map(([, workspace]) => workspace)).toEqual([
    { kind: "local" },
    { kind: "wsl", distro: "other" },
  ]);
});

it("retains the original filesystem through asynchronous legacy fallback", async () => {
  const f = fixture();
  let fail!: (error: Error) => void;
  io.readFile.mockReturnValueOnce(
    new Promise((_resolve, reject) => {
      fail = reject;
    }),
  );
  const pending = f.send();
  await vi.waitFor(() => expect(io.readFile).toHaveBeenCalledTimes(1));
  f.move();
  fail(new Error("missing primary memory"));
  await pending;
  expect(io.readFile.mock.calls).toEqual([
    [`${f.root}/VOKTTY.md`, { kind: "local" }],
    [`${f.root}/TERAX.md`, { kind: "local" }],
  ]);
  expect(io.run).toHaveBeenCalledWith(
    expect.objectContaining({
      modelId: "original-model",
      projectMemory: "original",
    }),
  );
});

it.each(["abort", "stop", "forget"])(
  "never starts the model after memory loading retires by %s",
  async (reason) => {
    const f = fixture();
    const controller = new AbortController();
    let finish!: (value: unknown) => void;
    io.readFile.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const pending = f.send(controller.signal);
    const outcome = expect(pending).rejects.toThrow();
    await vi.waitFor(() => expect(io.readFile).toHaveBeenCalledTimes(1));
    if (reason === "abort") controller.abort();
    else if (reason === "stop") fileToolCallsFor(f.ctx).retireAll();
    else fileToolCallsFor(f.ctx).forget();
    finish({ kind: "text", content: "late", size: 4 });
    await outcome;
    expect(io.run).not.toHaveBeenCalled();
  },
);

it("does not borrow an ambient root when explicit file context is missing", async () => {
  const f = fixture();
  f.ctx.getFileRootContext = () => null;
  await f.send();
  expect(io.readFile).not.toHaveBeenCalled();
  expect(io.run).toHaveBeenCalledWith(
    expect.objectContaining({ projectMemory: null }),
  );
});

it("admits a fresh request after Stop without reviving the previous memory read", async () => {
  const f = fixture();
  let finish!: (value: unknown) => void;
  io.readFile.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const old = f.send();
  const observed = expect(old).rejects.toThrow("retired");
  await vi.waitFor(() => expect(io.readFile).toHaveBeenCalledTimes(1));
  fileToolCallsFor(f.ctx).retireAll();
  finish({ kind: "text", content: "stale", size: 5 });
  await observed;
  io.readFile.mockResolvedValueOnce({
    kind: "text",
    content: "fresh",
    size: 5,
  });
  await f.send();
  expect(io.run).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ projectMemory: "fresh" }),
  );
});

it.each(["secret", "outside", "unverified"])(
  "does not read %s canonical memory targets",
  async (mode) => {
    const f = fixture();
    io.canonicalize.mockImplementation(async (path: string) => {
      if (path === f.root) return path;
      if (mode === "unverified")
        throw new Error("canonicalization unavailable");
      return mode === "secret" ? `${f.root}/.env` : "/other/VOKTTY.md";
    });
    await f.send();
    expect(io.readFile).not.toHaveBeenCalled();
    expect(io.run).toHaveBeenCalledWith(
      expect.objectContaining({ projectMemory: null }),
    );
  },
);
