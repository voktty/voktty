import { MockLanguageModelV4 } from "ai/test";
import { beforeEach, expect, it, vi } from "vitest";
import { runSubagent } from "@/modules/ai/agents/runSubagent";
import { DEFAULT_MODEL_ID } from "@/modules/ai/config";
import type { ToolContext } from "@/modules/ai/tools/context";
import { fileToolCallsFor } from "@/modules/ai/lib/fileToolCalls";
import { EMPTY_PROVIDER_KEYS } from "@/modules/ai/lib/keyring";

const fixture = vi.hoisted(() => ({
  model: vi.fn(),
  canonicalize: vi.fn(async (path: string) => path),
  readFile: vi.fn(),
}));
vi.mock("@/modules/ai/lib/agent", () => ({
  buildLanguageModel: fixture.model,
}));
vi.mock("@/modules/ai/lib/native", () => ({ native: fixture }));
vi.mock("@/modules/ai/tools/search", () => ({ buildSearchTools: () => ({}) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));

function context(): ToolContext {
  return {
    getCwd: () => "/fixture",
    getWorkspaceRoot: () => "/fixture",
    getFileContext: () => ({
      directory: "/fixture",
      workspace: { kind: "local" },
    }),
    getFileRootContext: () => ({
      root: "/fixture",
      workspace: { kind: "local" },
    }),
    getTerminalContext: () => null,
    isActiveTerminalPrivate: () => false,
    injectIntoActivePty: () => false,
    openPreview: () => false,
    spawnAgent: () => null,
    readAgentOutput: () => null,
    readCache: new Map(),
    getSessionId: () => "fixture",
  };
}
const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};
function model() {
  let first = true;
  return new MockLanguageModelV4({
    doGenerate: async () => {
      const call = first;
      first = false;
      return {
        content: call
          ? [
              {
                type: "tool-call",
                toolCallId: "call",
                toolName: "read_file",
                input: JSON.stringify({ path: "file.ts" }),
              },
            ]
          : [{ type: "text", text: "finished" }],
        usage,
        warnings: [],
        finishReason: { unified: call ? "tool-calls" : "stop", raw: undefined },
      };
    },
  });
}
function start(owner: ToolContext, abortSignal: AbortSignal, onStep = vi.fn()) {
  return runSubagent({
    type: "explore",
    prompt: "Read the fixture.",
    modelId: DEFAULT_MODEL_ID,
    keys: { ...EMPTY_PROVIDER_KEYS },
    toolContext: owner,
    abortSignal,
    onStep,
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  fixture.model.mockResolvedValue(model());
  fixture.readFile.mockResolvedValue({
    kind: "text",
    content: "fixture",
    size: 7,
  });
});

it("does not set up a model for an already cancelled child", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(start(context(), controller.signal)).rejects.toThrow();
  expect(fixture.model).not.toHaveBeenCalled();
  expect(fixture.readFile).not.toHaveBeenCalled();
});

it("does not start generation after cancellation during model setup", async () => {
  let resolve!: (value: ReturnType<typeof model>) => void;
  fixture.model.mockReturnValue(
    new Promise((yes) => {
      resolve = yes;
    }),
  );
  const owner = context();
  const controller = new AbortController();
  const pending = start(owner, controller.signal).then(
    () => "completed",
    () => "cancelled",
  );
  controller.abort();
  resolve(model());
  expect(await pending).toBe("cancelled");
  expect(fixture.canonicalize).not.toHaveBeenCalled();
});

it("retains an aborted SDK child's pending read against its parent's budget until IO settles", async () => {
  let finish!: () => void;
  fixture.readFile.mockReturnValue(
    new Promise((resolve) => {
      finish = () => resolve({ kind: "text", content: "late", size: 4 });
    }),
  );
  const owner = context();
  const controller = new AbortController();
  const step = vi.fn();
  const pending = start(owner, controller.signal, step).then(
    () => "completed",
    () => "cancelled",
  );
  await vi.waitFor(() => expect(fixture.readFile).toHaveBeenCalledTimes(1));
  controller.abort();
  const calls = fileToolCallsFor(owner);
  const target = {
    directory: "/fixture",
    root: "/fixture",
    workspace: { kind: "local" as const },
  };
  for (let index = 0; index < 255; index++)
    calls.capture(String(index), "read_file", {}, target);
  expect(() => calls.capture("extra", "read_file", {}, target)).toThrow(
    "Too many",
  );
  finish();
  expect(await pending).toBe("cancelled");
  await vi.waitFor(() => calls.capture("extra", "read_file", {}, target));
  expect(owner.readCache.size).toBe(0);
  expect(step).not.toHaveBeenCalled();
  calls.retireAll();
});

it("keeps a concurrent sibling with the same provider call ID alive after cancelling one child", async () => {
  fixture.model.mockImplementation(async () => model());
  const finish: (() => void)[] = [];
  fixture.readFile.mockImplementation(
    () =>
      new Promise((resolve) => {
        const content = String(finish.length);
        finish.push(() =>
          resolve({ kind: "text", content, size: content.length }),
        );
      }),
  );
  const owner = context();
  const first = new AbortController();
  const second = new AbortController();
  const firstRun = start(owner, first.signal).then(
    () => "completed",
    () => "cancelled",
  );
  const secondRun = start(owner, second.signal);
  await vi.waitFor(() => expect(fixture.readFile).toHaveBeenCalledTimes(2));
  first.abort();
  finish[1]();
  expect(await secondRun).toMatchObject({ summary: "finished", stepCount: 2 });
  const cache = [...owner.readCache];
  expect(cache).toHaveLength(1);
  finish[0]();
  expect(await firstRun).toBe("cancelled");
  expect([...owner.readCache]).toEqual(cache);
});

it("drops its abort listener after successful completion", async () => {
  const controller = new AbortController();
  const add = vi.spyOn(controller.signal, "addEventListener");
  const remove = vi.spyOn(controller.signal, "removeEventListener");
  expect(await start(context(), controller.signal)).toMatchObject({
    summary: "finished",
    stepCount: 2,
  });
  const owned = add.mock.calls.find(([event]) => event === "abort")?.[1];
  expect(owned).toBeDefined();
  expect(remove).toHaveBeenCalledWith("abort", owned);
});
