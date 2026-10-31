import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { tool, type ModelMessage } from "ai";
import { z } from "zod";
import { guardToolRun } from "@/modules/ai/lib/toolRunGuard";
import { buildFsTools } from "@/modules/ai/tools/fs";
import type { ToolContext } from "@/modules/ai/tools/context";
import { fileToolCallsFor } from "@/modules/ai/lib/fileToolCalls";
import {
  captureFileApproval,
  retireFileToolRun,
} from "@/modules/ai/lib/fileToolApprovals";

const io = vi.hoisted(() => ({
  canonicalize: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
}));
vi.mock("@/modules/ai/lib/native", () => ({ native: io }));
const contexts: ToolContext[] = [];
beforeEach(() => {
  io.canonicalize.mockReset().mockImplementation(async (path: string) => path);
  io.readFile
    .mockReset()
    .mockResolvedValue({ kind: "text", content: "fixture", size: 7 });
  io.writeFile.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  for (const ctx of contexts.splice(0)) fileToolCallsFor(ctx).forget();
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
const options = {
  toolCallId: "call",
  messages: [] as ModelMessage[],
  context: {},
};
function context(): ToolContext {
  const ctx: ToolContext = {
    getCwd: () => "/project",
    getWorkspaceRoot: () => "/project",
    getFileContext: () => ({
      directory: "/project",
      workspace: { kind: "local" },
    }),
    getFileRootContext: () => ({
      root: "/project",
      workspace: { kind: "local" },
    }),
    getTerminalContext: () => null,
    isActiveTerminalPrivate: () => false,
    injectIntoActivePty: () => false,
    openPreview: () => false,
    spawnAgent: () => null,
    readAgentOutput: () => null,
    getSessionId: () => "fixture",
    readCache: new Map(),
  };
  contexts.push(ctx);
  return ctx;
}
it("preserves schemas and approval policy while guarding every callback", async () => {
  let current = true;
  const execute = vi.fn(async (input: { value: string }) => input);
  const available = vi.fn();
  const start = vi.fn();
  const delta = vi.fn();
  const approval = vi.fn(async () => true);
  const original = {
    check: tool({
      inputSchema: z.object({ value: z.string() }),
      needsApproval: approval,
      onInputAvailable: available,
      onInputStart: start,
      onInputDelta: delta,
      execute,
    }),
  };
  const guarded = guardToolRun(original, () => current);
  expect(guarded.check).not.toBe(original.check);
  expect(guarded.check.inputSchema).toBe(original.check.inputSchema);
  if (typeof guarded.check.needsApproval !== "function")
    throw new Error("Missing approval callback");
  expect(await guarded.check.needsApproval({ value: "fixture" }, options)).toBe(
    true,
  );
  await guarded.check.onInputAvailable?.({
    ...options,
    input: { value: "fixture" },
  });
  await guarded.check.onInputStart?.(options);
  await guarded.check.onInputDelta?.({ ...options, inputTextDelta: "fixture" });
  expect(await guarded.check.execute?.({ value: "fixture" }, options)).toEqual({
    value: "fixture",
  });
  current = false;
  expect(() => guarded.check.execute?.({ value: "retired" }, options)).toThrow(
    "retired",
  );
  expect(() =>
    guarded.check.onInputAvailable?.({
      ...options,
      input: { value: "retired" },
    }),
  ).toThrow("retired");
  expect(() => guarded.check.onInputStart?.(options)).toThrow("retired");
  expect(() =>
    guarded.check.onInputDelta?.({ ...options, inputTextDelta: "retired" }),
  ).toThrow("retired");
  expect(() => {
    if (typeof guarded.check.needsApproval === "function")
      guarded.check.needsApproval({ value: "retired" }, options);
  }).toThrow("retired");
  expect(execute).toHaveBeenCalledTimes(1);
  expect(available).toHaveBeenCalledTimes(1);
  expect(start).toHaveBeenCalledTimes(1);
  expect(delta).toHaveBeenCalledTimes(1);
  expect(approval).toHaveBeenCalledTimes(1);
});
it("suppresses a delayed tool result after retirement", async () => {
  let current = true;
  const held = deferred<string>();
  const original = {
    read: tool({ inputSchema: z.object({}), execute: () => held.promise }),
  };
  const guarded = guardToolRun(original, () => current);
  const result = guarded.read.execute?.({}, options);
  current = false;
  held.resolve("private result");
  await expect(result).rejects.toThrow("retired");
});
it("retains errors from a still-owned tool", async () => {
  const error = new Error("native failure");
  const guarded = guardToolRun(
    {
      read: tool({
        inputSchema: z.object({}),
        execute: async (): Promise<string> => {
          throw error;
        },
      }),
    },
    () => true,
  );
  await expect(guarded.read.execute?.({}, options)).rejects.toBe(error);
});
it("does not run a tool set already retired by SDK cleanup", () => {
  const execute = vi.fn(() => "fixture");
  const original = { read: tool({ inputSchema: z.object({}), execute }) };
  const guarded = guardToolRun(original, () => true);
  retireFileToolRun(original);
  expect(() => guarded.read.execute?.({}, options)).toThrow("retired");
  expect(execute).not.toHaveBeenCalled();
});
it("keeps reused non-file definitions isolated between provider runs", async () => {
  let current = true;
  const original = {
    extension: tool({
      inputSchema: z.object({}),
      execute: async () => "fixture",
    }),
  };
  const old = guardToolRun(original, () => current);
  const sibling = guardToolRun(original, () => true);
  current = false;
  expect(() => old.extension.execute?.({}, options)).toThrow("retired");
  expect(await sibling.extension.execute?.({}, options)).toBe("fixture");
});
it("guards each async-iterator advance and closes the original on retirement", async () => {
  let current = true;
  const next = vi.fn(async () => ({ done: false as const, value: "piece" }));
  const close = vi.fn(async () => ({ done: true as const, value: undefined }));
  const original = {
    read: tool({
      inputSchema: z.object({}),
      execute: () => ({
        [Symbol.asyncIterator]: () => ({ next, return: close }),
      }),
    }),
  };
  const guarded = guardToolRun(original, () => current);
  const result = guarded.read.execute?.({}, options);
  if (
    !result ||
    typeof result !== "object" ||
    !(Symbol.asyncIterator in result)
  )
    throw new Error("Missing iterable");
  const iterator = result[Symbol.asyncIterator]();
  expect(await iterator.next()).toMatchObject({ value: "piece" });
  current = false;
  await expect(iterator.next()).rejects.toThrow("retired");
  expect(next).toHaveBeenCalledTimes(1);
  expect(close).toHaveBeenCalledTimes(1);
});
it("never opens a lazy iterator after its owner retires", async () => {
  let current = true;
  const open = vi.fn(() => ({
    next: async () => ({ done: true as const, value: undefined }),
  }));
  const guarded = guardToolRun(
    {
      read: tool({
        inputSchema: z.object({}),
        execute: () => ({ [Symbol.asyncIterator]: open }),
      }),
    },
    () => current,
  );
  const result = guarded.read.execute?.({}, options);
  if (
    !result ||
    typeof result !== "object" ||
    !(Symbol.asyncIterator in result)
  )
    throw new Error("Missing iterable");
  current = false;
  await expect(result[Symbol.asyncIterator]().next()).rejects.toThrow(
    "retired",
  );
  expect(open).not.toHaveBeenCalled();
});
it("does not call return again after normal iterator completion", async () => {
  const close = vi.fn(async () => ({ done: true as const, value: undefined }));
  const guarded = guardToolRun(
    {
      read: tool({
        inputSchema: z.object({}),
        execute: () => ({
          [Symbol.asyncIterator]: () => ({
            next: async () => ({ done: true as const, value: undefined }),
            return: close,
          }),
        }),
      }),
    },
    () => true,
  );
  const result = guarded.read.execute?.({}, options);
  if (
    !result ||
    typeof result !== "object" ||
    !(Symbol.asyncIterator in result)
  )
    throw new Error("Missing iterable");
  expect(await result[Symbol.asyncIterator]().next()).toMatchObject({
    done: true,
  });
  expect(close).not.toHaveBeenCalled();
});
it("prevents later native read stages after an earlier native operation retires", async () => {
  let current = true;
  const held = deferred<string>();
  io.canonicalize.mockReturnValueOnce(held.promise);
  const original = buildFsTools(context());
  const guarded = guardToolRun(original, () => current);
  await guarded.read_file.onInputAvailable?.({
    ...options,
    input: { path: "file.txt" },
  });
  const result = guarded.read_file.execute?.({ path: "file.txt" }, options);
  const outcome = expect(result).rejects.toThrow("retired");
  await vi.waitFor(() => expect(io.canonicalize).toHaveBeenCalledTimes(1));
  current = false;
  held.resolve("/project/file.txt");
  await outcome;
  expect(io.readFile).not.toHaveBeenCalled();
  expect(io.canonicalize).toHaveBeenCalledTimes(1);
});
it.each([true, false])(
  "retains the original approval receipt with guarded SDK definitions (current=%s)",
  async (active) => {
    let current = true;
    const original = buildFsTools(context());
    const guarded = guardToolRun(original, () => current);
    const input = { path: "file.txt", content: "fixture" };
    await guarded.write_file.onInputAvailable?.({ ...options, input });
    captureFileApproval(original, {
      approvalId: "approval",
      toolCall: { toolName: "write_file", toolCallId: "call" },
    });
    const messages: ModelMessage[] = [
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "call",
            toolName: "write_file",
            input,
          },
          {
            type: "tool-approval-request",
            approvalId: "approval",
            toolCallId: "call",
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-approval-response",
            approvalId: "approval",
            approved: true,
          },
        ],
      },
    ];
    current = active;
    const result = Promise.resolve().then(() =>
      guarded.write_file.execute?.(input, { ...options, messages }),
    );
    if (!active) await expect(result).rejects.toThrow("retired");
    else await result;
    expect(io.writeFile).toHaveBeenCalledTimes(active ? 1 : 0);
    expect(guarded.write_file.needsApproval).toBe(true);
  },
);
it("refuses rebinding an existing captured file tool to another run", () => {
  const original = buildFsTools(context());
  guardToolRun(original, () => true);
  expect(() => guardToolRun(original, () => true)).toThrow(
    "already has an owner",
  );
});

it("withdraws a synchronous error when its callback retires the run", () => {
  let current = true;
  const guarded = guardToolRun(
    {
      read: tool({
        inputSchema: z.object({}),
        execute: (): string => {
          current = false;
          throw new Error("private old error");
        },
      }),
    },
    () => current,
  );
  expect(() => guarded.read.execute?.({}, options)).toThrow("retired");
});
