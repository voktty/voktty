import type { ToolExecutionOptions } from "ai";
import { beforeEach, expect, it, vi } from "vitest";
import { buildSearchTools } from "@/modules/ai/tools/search";
import type { ToolContext } from "@/modules/ai/tools/context";
import type { WorkspaceEnv } from "@/modules/workspace";
import { fileToolCallsFor } from "@/modules/ai/lib/fileToolCalls";
import { generateText } from "ai";
import { MockLanguageModelV4 } from "ai/test";

const io = vi.hoisted(() => ({
  canonicalize: vi.fn(),
  grep: vi.fn(),
  glob: vi.fn(),
}));
vi.mock("@/modules/ai/lib/native", () => ({ native: io }));

function fixture() {
  let directory = "/fixture/original";
  let workspace: WorkspaceEnv = { kind: "wsl", distro: "original" };
  const ctx: ToolContext = {
    getCwd: () => directory,
    getWorkspaceRoot: () => directory,
    getFileContext: () => ({ directory, workspace }),
    getFileRootContext: () => ({ root: directory, workspace }),
    getTerminalContext: () => null,
    isActiveTerminalPrivate: () => false,
    injectIntoActivePty: () => false,
    openPreview: () => false,
    spawnAgent: () => null,
    readAgentOutput: () => null,
    readCache: new Map(),
    getSessionId: () => "fixture",
  };
  return {
    ctx,
    move: () => {
      directory = "/fixture/replacement";
      workspace = { kind: "local" };
    },
  };
}
const options: ToolExecutionOptions<Record<string, unknown>> = {
  toolCallId: "call",
  messages: [],
  context: {},
};
beforeEach(() => {
  vi.resetAllMocks();
  io.canonicalize.mockImplementation(async (path: string) => path);
  io.grep.mockResolvedValue({ hits: [], truncated: false, files_scanned: 0 });
  io.glob.mockResolvedValue({ hits: [], truncated: false });
});

it.each(["grep", "glob"] as const)(
  "keeps %s on the input's original root and filesystem",
  async (name) => {
    const owner = fixture();
    const tools = buildSearchTools(owner.ctx);
    const input = { pattern: "fixture" };
    await tools[name].onInputAvailable?.({ ...options, input });
    owner.move();
    const result = await tools[name].execute?.(input, options);
    expect(result).toMatchObject({ root: "/fixture/original", hits: [] });
    expect(io[name]).toHaveBeenCalledWith(
      expect.objectContaining({ root: "/fixture/original" }),
      { kind: "wsl", distro: "original" },
    );
    expect(
      io.canonicalize.mock.calls.every(
        ([, workspace]) => workspace?.kind === "wsl",
      ),
    ).toBe(true);
  },
);

it("does not borrow a replacement boundary while the root is being canonicalized", async () => {
  let finish!: (path: string) => void;
  io.canonicalize.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const owner = fixture();
  const tool = buildSearchTools(owner.ctx).grep;
  const input = { pattern: "fixture" };
  await tool.onInputAvailable?.({ ...options, input });
  const pending = tool.execute?.(input, options);
  owner.move();
  finish("/fixture/original");
  expect(await pending).toMatchObject({ root: "/fixture/original", hits: [] });
  expect(io.grep).toHaveBeenCalledWith(
    expect.objectContaining({ root: "/fixture/original" }),
    { kind: "wsl", distro: "original" },
  );
});

it.each(["grep", "glob"] as const)(
  "refuses %s without its original SDK capture",
  async (name) => {
    const tool = buildSearchTools(fixture().ctx)[name];
    await expect(
      tool.execute?.({ pattern: "fixture" }, options),
    ).rejects.toThrow("unavailable");
    expect(io.canonicalize).not.toHaveBeenCalled();
    expect(io[name]).not.toHaveBeenCalled();
  },
);

it.each(["missing", "mismatch"])(
  "does not borrow an ambient root when the explicit source is %s",
  async (mode) => {
    const { ctx } = fixture();
    if (mode === "missing") ctx.getFileRootContext = () => null;
    else
      ctx.getFileRootContext = () => ({
        root: "/fixture/original",
        workspace: { kind: "local" },
      });
    const tool = buildSearchTools(ctx).grep;
    await expect(
      Promise.resolve().then(() =>
        tool.onInputAvailable?.({ ...options, input: { pattern: "fixture" } }),
      ),
    ).rejects.toThrow();
    expect(io.canonicalize).not.toHaveBeenCalled();
  },
);

it.each(["grep", "glob"] as const)(
  "does not start %s after cancellation during canonicalization",
  async (name) => {
    let finish!: (path: string) => void;
    io.canonicalize.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const controller = new AbortController();
    const args = { ...options, abortSignal: controller.signal };
    const tool = buildSearchTools(fixture().ctx)[name];
    const input = { pattern: "fixture" };
    await tool.onInputAvailable?.({ ...args, input });
    const pending = tool.execute?.(input, args);
    controller.abort();
    finish("/fixture/original");
    expect(await pending).toHaveProperty("error");
    expect(io[name]).not.toHaveBeenCalled();
  },
);

it("counts an aborted native search against the shared file quota until it settles", async () => {
  let finish!: (value: {
    hits: [];
    truncated: false;
    files_scanned: 0;
  }) => void;
  io.grep.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const owner = fixture();
  const controller = new AbortController();
  const args = { ...options, abortSignal: controller.signal };
  const tool = buildSearchTools(owner.ctx).grep;
  const input = { pattern: "fixture" };
  await tool.onInputAvailable?.({ ...args, input });
  const pending = tool.execute?.(input, args);
  await vi.waitFor(() => expect(io.grep).toHaveBeenCalledTimes(1));
  controller.abort();
  const calls = fileToolCallsFor(owner.ctx);
  const target = {
    directory: "/fixture/original",
    root: "/fixture/original",
    workspace: { kind: "local" as const },
  };
  for (let index = 0; index < 255; index++)
    calls.capture(String(index), "read_file", {}, target);
  expect(() => calls.capture("extra", "read_file", {}, target)).toThrow(
    "Too many",
  );
  finish({ hits: [], truncated: false, files_scanned: 0 });
  expect(await pending).toHaveProperty("error");
  calls.capture("extra", "read_file", {}, target);
  calls.retireAll();
});

it("keeps the captured filesystem through real generateText input and execution hooks", async () => {
  let finish!: (path: string) => void;
  io.canonicalize.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const owner = fixture();
  const pending = generateText({
    model: new MockLanguageModelV4({
      doGenerate: async () => ({
        content: [
          {
            type: "tool-call",
            toolCallId: "call",
            toolName: "grep",
            input: JSON.stringify({ pattern: "fixture" }),
          },
        ],
        finishReason: { unified: "tool-calls", raw: undefined },
        usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 1, text: 0, reasoning: 0 },
        },
        warnings: [],
      }),
    }),
    prompt: "Search the fixture.",
    tools: buildSearchTools(owner.ctx),
  });
  await vi.waitFor(() => expect(io.canonicalize).toHaveBeenCalledTimes(1));
  owner.move();
  finish("/fixture/original");
  const result = await pending;
  expect(result.toolResults[0]?.output).toMatchObject({
    root: "/fixture/original",
    hits: [],
  });
  expect(io.grep).toHaveBeenCalledWith(
    expect.objectContaining({ root: "/fixture/original" }),
    { kind: "wsl", distro: "original" },
  );
});
