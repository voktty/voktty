import { streamText, type ModelMessage } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { beforeEach, expect, it, vi } from "vitest";
import type { ToolContext } from "@/modules/ai/tools/context";
import { buildFsTools } from "@/modules/ai/tools/fs";
import { buildEditTools } from "@/modules/ai/tools/edit";
import {
  fileToolApprovalTransform,
  retireFileToolRun,
} from "@/modules/ai/lib/fileToolApprovals";
import { fileToolCallsFor } from "@/modules/ai/lib/fileToolCalls";
import type { WorkspaceEnv } from "@/modules/workspace";
import { usePlanStore } from "@/modules/ai/store/planStore";

const io = vi.hoisted(() => ({
  canonicalize: vi.fn(async (path: string) => path),
  writeFile: vi.fn(async (_path: string, _content: string) => undefined),
  readFile: vi.fn(async (_path: string) => ({
    kind: "text" as const,
    content: "original",
    size: 8,
  })),
}));
vi.mock("@/modules/ai/lib/native", () => ({ native: io }));
beforeEach(() => {
  vi.clearAllMocks();
  io.canonicalize.mockImplementation(async (path: string) => path);
  io.readFile.mockResolvedValue({ kind: "text", content: "original", size: 8 });
  io.writeFile.mockResolvedValue(undefined);
  usePlanStore.setState({ active: false, queue: [] });
});

function fixture(workspace: WorkspaceEnv = { kind: "local" }) {
  let directory = "/fixture/original";
  const context: ToolContext = {
    getFileContext: () => ({ directory, workspace }),
    getFileRootContext: () => ({ root: directory, workspace }),
    getCwd: () => directory,
    getWorkspaceRoot: () => directory,
    getTerminalContext: () => null,
    isActiveTerminalPrivate: () => false,
    injectIntoActivePty: () => false,
    openPreview: () => false,
    spawnAgent: () => null,
    readAgentOutput: () => null,
    readCache: new Map(),
    getSessionId: () => "fixture-chat",
    getModelId: () => "original-model",
  };
  return {
    context,
    move: () => {
      directory = "/fixture/replacement";
    },
  };
}

async function request(
  context: ToolContext,
  toolName = "write_file",
  value: Record<string, unknown> = { path: "file.ts", content: "fixture" },
) {
  const tools = { ...buildFsTools(context), ...buildEditTools(context) };
  const messages: ModelMessage[] = [
    { role: "user", content: "Write the fixture." },
  ];
  const stream = streamText({
    model: model(true, toolName, value),
    tools,
    messages,
    experimental_transform: fileToolApprovalTransform(tools),
  });
  await stream.consumeStream();
  const response = await stream.response;
  const approval = response.messages
    .flatMap((message) =>
      message.role === "assistant" && Array.isArray(message.content)
        ? message.content
        : [],
    )
    .find((part) => part.type === "tool-approval-request");
  if (approval?.type !== "tool-approval-request")
    throw new Error("Missing approval");
  return {
    tools,
    messages: [...messages, ...response.messages],
    approvalId: approval.approvalId,
  };
}

async function respond(
  context: ToolContext,
  pending: Awaited<ReturnType<typeof request>>,
  approved: boolean,
  outputs: unknown[] = [],
  abortSignal?: AbortSignal,
) {
  const tools = { ...buildFsTools(context), ...buildEditTools(context) };
  const messages: ModelMessage[] = [
    ...pending.messages,
    {
      role: "tool",
      content: [
        {
          type: "tool-approval-response",
          approvalId: pending.approvalId,
          approved,
        },
      ],
    },
  ];
  const stream = streamText({
    model: model(false),
    tools,
    experimental_transform: fileToolApprovalTransform(tools, messages),
    messages,
    abortSignal,
  });
  const events: string[] = [];
  for await (const part of stream.fullStream) {
    events.push(part.type);
    if (part.type === "tool-result") outputs.push(part.output);
  }
  return events;
}

it.each(["input", "tool"])(
  "refuses changed %s after approval without consuming the original receipt",
  async (changed) => {
    const { context } = fixture();
    const original = await request(context);
    const altered = {
      ...original,
      messages: structuredClone(original.messages),
    };
    for (const message of altered.messages) {
      if (message.role !== "assistant" || !Array.isArray(message.content))
        continue;
      for (const part of message.content) {
        if (part.type !== "tool-call") continue;
        if (changed === "input")
          part.input = { path: "file.ts", content: "changed" };
        else {
          part.toolName = "create_directory";
          part.input = { path: "file.ts" };
        }
      }
    }
    expect(await respond(context, altered, true)).toContain("tool-error");
    expect(io.writeFile).not.toHaveBeenCalled();
    expect(await respond(context, original, true)).not.toContain("tool-error");
    expect(io.writeFile).toHaveBeenCalledExactlyOnceWith(
      "/fixture/original/file.ts",
      "fixture",
      { kind: "local" },
    );
  },
);

it("queues the captured plan and provenance even when mode, model and filesystem change during approval", async () => {
  usePlanStore.setState({ active: true });
  const workspace: WorkspaceEnv = { kind: "wsl", distro: "original" };
  const { context, move } = fixture(workspace);
  const pending = await request(context);
  usePlanStore.setState({ active: false });
  move();
  workspace.distro = "replacement";
  context.getModelId = () => "replacement-model";
  expect(await respond(context, pending, true)).not.toContain("tool-error");
  expect(io.writeFile).not.toHaveBeenCalled();
  expect(usePlanStore.getState().queue).toEqual([
    expect.objectContaining({
      path: "/fixture/original/file.ts",
      workspaceEnv: { kind: "wsl", distro: "original" },
      originalContent: "original",
      proposedContent: "fixture",
      modelId: "original-model",
      sessionId: "fixture-chat",
    }),
  ]);
  expect(io.readFile).toHaveBeenCalledExactlyOnceWith(
    "/fixture/original/file.ts",
    { kind: "wsl", distro: "original" },
  );
});

async function read(context: ToolContext) {
  const tools = buildFsTools(context);
  const stream = streamText({
    model: model(true, "read_file", { path: "file.ts" }),
    tools,
    messages: [{ role: "user", content: "Read the fixture." }],
    experimental_transform: fileToolApprovalTransform(tools),
  });
  await stream.consumeStream();
  return (await stream.toolResults).find(
    (result) => result.toolName === "read_file",
  )?.output;
}

it("never treats an equal path and content on another filesystem as an unchanged read", async () => {
  const workspace: WorkspaceEnv = { kind: "wsl", distro: "original" };
  const { context } = fixture(workspace);
  expect(await read(context)).toMatchObject({ content: "original" });
  workspace.distro = "replacement";
  expect(await read(context)).toMatchObject({ content: "original" });
  expect(await read(context)).toMatchObject({ unchanged: true });
  expect(context.readCache.size).toBe(2);
});

it("requires a read on the exact filesystem before an approved edit", async () => {
  const workspace: WorkspaceEnv = { kind: "wsl", distro: "original" };
  const { context } = fixture(workspace);
  await read(context);
  workspace.distro = "replacement";
  const pending = await request(context, "edit", {
    path: "file.ts",
    old_string: "original",
    new_string: "changed",
  });
  const outputs: unknown[] = [];
  await respond(context, pending, true, outputs);
  expect(outputs).toEqual([
    expect.objectContaining({ error: expect.stringContaining("read_file") }),
  ]);
  expect(io.writeFile).not.toHaveBeenCalled();
});

it("keeps aborted native work charged until its actual promise settles", async () => {
  const { context } = fixture();
  const pending = await request(context);
  let settle = (_value: string) => {};
  const native = new Promise<string>((resolve) => {
    settle = resolve;
  });
  io.canonicalize.mockImplementation(() => native);
  const controller = new AbortController();
  const response = respond(context, pending, true, [], controller.signal);
  await vi.waitFor(() => expect(io.canonicalize).toHaveBeenCalled());
  controller.abort();
  const calls = fileToolCallsFor(context);
  const target = {
    directory: "/fixture",
    root: "/fixture",
    workspace: { kind: "local" as const },
  };
  for (let index = 0; index < 255; index++)
    calls.capture(String(index), "read_file", {}, target);
  expect(() => calls.capture("overflow", "read_file", {}, target)).toThrow(
    "Too many",
  );
  settle("/fixture/original/file.ts");
  await response;
  await vi.waitFor(() =>
    expect(() => calls.capture("after", "read_file", {}, target)).not.toThrow(),
  );
  expect(io.writeFile).not.toHaveBeenCalled();
  calls.retireAll();
});

it("never executes a denied call and releases its original capture through the SDK stream", async () => {
  const { context, move } = fixture();
  const pending = await request(context);
  move();
  expect(await respond(context, pending, false)).toContain(
    "tool-output-denied",
  );
  expect(io.writeFile).not.toHaveBeenCalled();
  expect(() =>
    fileToolCallsFor(context).preview("write", "write_file", {
      path: "file.ts",
      content: "fixture",
    }),
  ).toThrow("unavailable");
});

it("refuses a historical approval after the runtime owner is lost", async () => {
  const { context, move } = fixture();
  const pending = await request(context);
  move();
  const restored = { ...context, readCache: new Map() };
  expect(await respond(restored, pending, true)).toContain("tool-error");
  expect(io.writeFile).not.toHaveBeenCalled();
  retireFileToolRun(pending.tools);
});

it("uses the document's own SSH helper when Explorer has widened its root on the same connection", async () => {
  const workspace: WorkspaceEnv = {
    kind: "ssh",
    root: "/fixture",
    sessionId: 7,
    connection: {
      id: "fixture",
      name: "Original",
      host: "fixture.invalid",
      user: "fixture",
    },
  };
  const { context } = fixture(workspace);
  context.getFileRootContext = () => ({
    root: "/fixture/original",
    workspace: {
      ...workspace,
      root: "/",
      sessionId: 8,
      connection: { ...workspace.connection, name: "Explorer" },
    },
  });
  const pending = await request(context);
  await respond(context, pending, true);
  expect(io.writeFile).toHaveBeenCalledExactlyOnceWith(
    "/fixture/original/file.ts",
    "fixture",
    workspace,
  );
  expect(io.canonicalize).toHaveBeenCalledWith("/fixture/original", workspace);
});

it("does not combine an original document with another SSH identity's workspace boundary", () => {
  const workspace: WorkspaceEnv = {
    kind: "ssh",
    root: "/fixture",
    sessionId: 7,
    connection: {
      id: "fixture",
      name: "Original",
      host: "fixture.invalid",
      user: "original",
    },
  };
  const { context } = fixture(workspace);
  context.getFileRootContext = () => ({
    root: "/fixture/original",
    workspace: {
      ...workspace,
      connection: { ...workspace.connection, user: "another" },
    },
  });
  const tools = buildFsTools(context);
  expect(() =>
    tools.read_file.onInputAvailable?.({
      input: { path: "file.ts" },
      toolCallId: "read",
      messages: [],
      context: {},
    }),
  ).toThrow("different filesystems");
  expect(io.canonicalize).not.toHaveBeenCalled();
});

it("cannot use an old approval to execute a later same-ID same-input call", async () => {
  const { context, move } = fixture();
  const old = await request(context);
  retireFileToolRun(old.tools);
  move();
  const current = await request(context);
  expect(current.approvalId).not.toBe(old.approvalId);
  expect(await respond(context, old, true)).toContain("tool-error");
  expect(io.writeFile).not.toHaveBeenCalled();
  expect(await respond(context, current, true)).not.toContain("tool-error");
  expect(io.writeFile).toHaveBeenCalledExactlyOnceWith(
    "/fixture/replacement/file.ts",
    "fixture",
    { kind: "local" },
  );
});

it.each<WorkspaceEnv>([
  { kind: "wsl", distro: "fixture" },
  {
    kind: "ssh",
    root: "/fixture",
    sessionId: 7,
    connection: { id: "fixture", name: "Fixture", host: "fixture.invalid" },
  },
])(
  "retains the explicit %j filesystem through SDK approval",
  async (workspace) => {
    const original = structuredClone(workspace);
    const { context, move } = fixture(workspace);
    const pending = await request(context);
    move();
    if (workspace.kind === "ssh")
      workspace.connection.host = "replacement.invalid";
    expect(await respond(context, pending, true)).not.toContain("tool-error");
    expect(io.writeFile).toHaveBeenCalledExactlyOnceWith(
      "/fixture/original/file.ts",
      "fixture",
      original,
    );
    expect(io.canonicalize).toHaveBeenCalledWith("/fixture/original", original);
  },
);

function model(
  call: boolean,
  toolName = "write_file",
  value: Record<string, unknown> = { path: "file.ts", content: "fixture" },
) {
  return new MockLanguageModelV4({
    doStream: {
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: "stream-start", warnings: [] });
          if (call) {
            controller.enqueue({
              type: "tool-input-start",
              id: "write",
              toolName,
            });
            controller.enqueue({
              type: "tool-call",
              toolCallId: "write",
              toolName,
              input: JSON.stringify(value),
            });
          }
          controller.enqueue({
            type: "finish",
            usage: {
              inputTokens: {
                total: 1,
                noCache: 1,
                cacheRead: 0,
                cacheWrite: 0,
              },
              outputTokens: { total: 1, text: 0, reasoning: 0 },
            },
            finishReason: {
              unified: call ? "tool-calls" : "stop",
              raw: undefined,
            },
          });
          controller.close();
        },
      }),
    },
  });
}

it("keeps the original file destination across approval and tool reconstruction", async () => {
  let directory = "/fixture/original";
  const context: ToolContext = {
    getFileContext: () => ({ directory, workspace: { kind: "local" } }),
    getFileRootContext: () => ({
      root: directory,
      workspace: { kind: "local" },
    }),
    getCwd: () => directory,
    getWorkspaceRoot: () => directory,
    getTerminalContext: () => null,
    isActiveTerminalPrivate: () => false,
    injectIntoActivePty: () => false,
    openPreview: () => false,
    spawnAgent: () => null,
    readAgentOutput: () => null,
    readCache: new Map(),
    getSessionId: () => "fixture-chat",
  };
  const messages: ModelMessage[] = [
    { role: "user", content: "Write the fixture." },
  ];
  const firstTools = buildFsTools(context);
  const first = streamText({
    model: model(true),
    tools: firstTools,
    experimental_transform: fileToolApprovalTransform(firstTools),
    messages,
  });
  await first.consumeStream();
  const response = await first.response;
  const request = response.messages
    .flatMap((message) =>
      message.role === "assistant" && Array.isArray(message.content)
        ? message.content
        : [],
    )
    .find((part) => part.type === "tool-approval-request");
  if (request?.type !== "tool-approval-request")
    throw new Error("Missing approval");
  expect(io.writeFile).not.toHaveBeenCalled();
  directory = "/fixture/replacement";
  const resumed = streamText({
    model: model(false),
    tools: buildFsTools(context),
    messages: [
      ...messages,
      ...response.messages,
      {
        role: "tool",
        content: [
          {
            type: "tool-approval-response",
            approvalId: request.approvalId,
            approved: true,
          },
        ],
      },
    ],
  });
  await resumed.consumeStream();
  expect(io.writeFile.mock.calls).toHaveLength(1);
  expect(io.writeFile.mock.calls[0]?.[0]).toBe("/fixture/original/file.ts");
});
