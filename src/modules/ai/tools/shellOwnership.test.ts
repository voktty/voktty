import { streamText, type ModelMessage } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { beforeEach, expect, it, vi } from "vitest";
import { buildShellTools } from "@/modules/ai/tools/shell";
import type { ToolContext } from "@/modules/ai/tools/context";
import type { WorkspaceEnv } from "@/modules/workspace";
import {
  fileToolApprovalTransform,
  retireFileToolRun,
} from "@/modules/ai/lib/fileToolApprovals";
import { fileToolCallsFor } from "@/modules/ai/lib/fileToolCalls";

const io = vi.hoisted(() => ({
  shellSessionOpen:
    vi.fn<(cwd?: string | null, workspace?: WorkspaceEnv) => Promise<number>>(),
  shellSessionRun: vi.fn(),
  shellBgSpawn: vi.fn(),
}));
vi.mock("@/modules/ai/lib/native", () => ({ native: io }));
beforeEach(() => {
  vi.resetAllMocks();
  io.shellSessionOpen.mockResolvedValue(1);
  io.shellSessionRun.mockResolvedValue({
    stdout: "fixture",
    stderr: "",
    exit_code: 0,
    timed_out: false,
    truncated: false,
    cwd_after: "/fixture/original",
  });
  io.shellBgSpawn.mockResolvedValue(2);
});

function fixture() {
  let directory = "/fixture/original";
  let workspace: WorkspaceEnv = { kind: "wsl", distro: "original" };
  let sessionId = crypto.randomUUID();
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
    getSessionId: () => sessionId,
  };
  return {
    ctx,
    move() {
      directory = "/fixture/replacement";
      workspace = { kind: "local" };
      sessionId = crypto.randomUUID();
    },
  };
}

function model(name: string, input?: Record<string, unknown>, id = "shell") {
  return new MockLanguageModelV4({
    doStream: {
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: "stream-start", warnings: [] });
          if (input) {
            controller.enqueue({
              type: "tool-input-start",
              id,
              toolName: name,
            });
            controller.enqueue({
              type: "tool-call",
              toolCallId: id,
              toolName: name,
              input: JSON.stringify(input),
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
              unified: input ? "tool-calls" : "stop",
              raw: undefined,
            },
          });
          controller.close();
        },
      }),
    },
  });
}

async function request(
  ctx: ToolContext,
  name: "bash_run" | "bash_background",
  input: Record<string, unknown> = { command: "fixture" },
  id = "shell",
) {
  const tools = buildShellTools(ctx);
  const messages: ModelMessage[] = [
    { role: "user", content: "Run the fixture." },
  ];
  const stream = streamText({
    model: model(name, input, id),
    tools,
    messages,
    experimental_transform: fileToolApprovalTransform(tools),
  });
  await stream.consumeStream();
  const response = await stream.response;
  const approval = response.messages
    .flatMap((m) =>
      m.role === "assistant" && Array.isArray(m.content) ? m.content : [],
    )
    .find((p) => p.type === "tool-approval-request");
  if (approval?.type !== "tool-approval-request")
    throw new Error("Missing SDK approval");
  return {
    tools,
    messages: [...messages, ...response.messages],
    approvalId: approval.approvalId,
  };
}

async function respond(
  ctx: ToolContext,
  pending: Awaited<ReturnType<typeof request>>,
  approved = true,
  abortSignal?: AbortSignal,
) {
  const tools = buildShellTools(ctx);
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
    model: model("bash_run"),
    tools,
    messages,
    abortSignal,
    experimental_transform: fileToolApprovalTransform(tools, messages),
  });
  const outputs: unknown[] = [];
  const events: string[] = [];
  for await (const part of stream.fullStream) {
    events.push(part.type);
    if (part.type === "tool-result") outputs.push(part.output);
  }
  return { outputs, events };
}

it.each(["bash_run", "bash_background"] as const)(
  "keeps %s on the original destination across approval and tool reconstruction",
  async (name) => {
    const owner = fixture();
    const pending = await request(owner.ctx, name);
    owner.move();
    expect((await respond(owner.ctx, pending)).events).not.toContain(
      "tool-error",
    );
    const original = { kind: "wsl", distro: "original" };
    if (name === "bash_run") {
      expect(io.shellSessionOpen).toHaveBeenCalledExactlyOnceWith(
        "/fixture/original",
        original,
      );
      expect(io.shellSessionRun).toHaveBeenCalledExactlyOnceWith(
        1,
        "fixture",
        "/fixture/original",
        undefined,
        original,
      );
    } else
      expect(io.shellBgSpawn).toHaveBeenCalledExactlyOnceWith(
        "fixture",
        "/fixture/original",
        original,
      );
  },
);

it.each(["bash_run", "bash_background"] as const)(
  "refuses a restored %s approval without the original runtime capture",
  async (name) => {
    const owner = fixture();
    const pending = await request(owner.ctx, name);
    const restored = { ...owner.ctx, readCache: new Map() };
    expect((await respond(restored, pending)).events).toContain("tool-error");
    expect(io.shellSessionOpen).not.toHaveBeenCalled();
    expect(io.shellBgSpawn).not.toHaveBeenCalled();
  },
);

it.each(["bash_run", "bash_background"] as const)(
  "retires %s with the original chat's call family",
  async (name) => {
    const owner = fixture();
    const pending = await request(owner.ctx, name);
    fileToolCallsFor(owner.ctx).retireAll();
    expect((await respond(owner.ctx, pending)).events).toContain("tool-error");
    expect(io.shellSessionOpen).not.toHaveBeenCalled();
    expect(io.shellBgSpawn).not.toHaveBeenCalled();
  },
);

it("does not execute after cancellation while the original shell is opening", async () => {
  const owner = fixture();
  const pending = await request(owner.ctx, "bash_run");
  let finish!: (id: number) => void;
  io.shellSessionOpen.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const controller = new AbortController();
  const response = respond(owner.ctx, pending, true, controller.signal);
  await vi.waitFor(() => expect(io.shellSessionOpen).toHaveBeenCalledTimes(1));
  controller.abort();
  finish(7);
  await response;
  await vi.waitFor(() => expect(io.shellSessionRun).not.toHaveBeenCalled());
});

it("resolves an explicit background directory relative to its captured source", async () => {
  const owner = fixture();
  const pending = await request(owner.ctx, "bash_background", {
    command: "fixture",
    cwd: "src",
  });
  owner.move();
  await respond(owner.ctx, pending);
  expect(io.shellBgSpawn).toHaveBeenCalledExactlyOnceWith(
    "fixture",
    "/fixture/original/src",
    { kind: "wsl", distro: "original" },
  );
});

it("refuses a captured call after the original tool run retires", async () => {
  const owner = fixture();
  const pending = await request(owner.ctx, "bash_background");
  retireFileToolRun(pending.tools);
  expect((await respond(owner.ctx, pending)).events).toContain("tool-error");
  expect(io.shellBgSpawn).not.toHaveBeenCalled();
});

it.each(["input", "approval"])(
  "rejects changed %s without consuming the original shell receipt",
  async (changed) => {
    const owner = fixture();
    const pending = await request(owner.ctx, "bash_background");
    const altered = { ...pending, messages: structuredClone(pending.messages) };
    for (const message of altered.messages) {
      if (!Array.isArray(message.content)) continue;
      for (const part of message.content) {
        if (part.type === "tool-call" && changed === "input")
          part.input = { command: "replacement" };
        if (part.type === "tool-approval-request" && changed === "approval") {
          part.approvalId = "forged";
          altered.approvalId = "forged";
        }
      }
    }
    expect((await respond(owner.ctx, altered)).events).toContain("tool-error");
    expect(io.shellBgSpawn).not.toHaveBeenCalled();
    await respond(owner.ctx, pending);
    expect(io.shellBgSpawn).toHaveBeenCalledExactlyOnceWith(
      "fixture",
      "/fixture/original",
      { kind: "wsl", distro: "original" },
    );
  },
);

it("does not let an old same-ID approval consume a newer shell capture", async () => {
  const owner = fixture();
  const old = await request(owner.ctx, "bash_background");
  retireFileToolRun(old.tools);
  owner.move();
  const current = await request(owner.ctx, "bash_background");
  expect((await respond(owner.ctx, old)).events).toContain("tool-error");
  expect(io.shellBgSpawn).not.toHaveBeenCalled();
  await respond(owner.ctx, current);
  expect(io.shellBgSpawn).toHaveBeenCalledExactlyOnceWith(
    "fixture",
    "/fixture/replacement",
    { kind: "local" },
  );
});

it("denies shell approval without executing and releases the shared capture budget", async () => {
  const owner = fixture();
  const pending = await request(owner.ctx, "bash_background");
  expect((await respond(owner.ctx, pending, false)).events).toContain(
    "tool-output-denied",
  );
  expect(io.shellBgSpawn).not.toHaveBeenCalled();
  const calls = fileToolCallsFor(owner.ctx);
  const target = {
    directory: "/fixture",
    root: "/fixture",
    workspace: { kind: "local" as const },
  };
  for (let index = 0; index < 256; index++)
    calls.capture(String(index), "read_file", {}, target);
  expect(() => calls.capture("overflow", "read_file", {}, target)).toThrow(
    "Too many",
  );
  calls.retireAll();
});

it("uses distinct native cwd state for different source directories in the same chat and filesystem", async () => {
  const owner = fixture();
  await respond(owner.ctx, await request(owner.ctx, "bash_run"));
  owner.ctx.getFileContext = () => ({
    directory: "/fixture/other",
    workspace: { kind: "wsl", distro: "original" },
  });
  await respond(owner.ctx, await request(owner.ctx, "bash_run"));
  expect(io.shellSessionOpen.mock.calls).toEqual([
    ["/fixture/original", { kind: "wsl", distro: "original" }],
    ["/fixture/other", { kind: "wsl", distro: "original" }],
  ]);
});

it("reuses an original shell's cwd state without reopening it for later commands", async () => {
  const owner = fixture();
  await respond(owner.ctx, await request(owner.ctx, "bash_run"));
  await respond(owner.ctx, await request(owner.ctx, "bash_run"));
  expect(io.shellSessionOpen).toHaveBeenCalledTimes(1);
  expect(io.shellSessionRun).toHaveBeenCalledTimes(2);
});

it("allows retry after a failed shell opening", async () => {
  const owner = fixture();
  io.shellSessionOpen.mockRejectedValueOnce(new Error("opening failed"));
  expect(
    (await respond(owner.ctx, await request(owner.ctx, "bash_run"))).outputs,
  ).toEqual([{ error: "Error: opening failed" }]);
  await respond(owner.ctx, await request(owner.ctx, "bash_run"));
  expect(io.shellSessionOpen).toHaveBeenCalledTimes(2);
  expect(io.shellSessionRun).toHaveBeenCalledTimes(1);
});

it("keeps an aborted native command charged until the actual run settles", async () => {
  const owner = fixture();
  const pending = await request(owner.ctx, "bash_run");
  let finish!: () => void;
  io.shellSessionRun.mockReturnValue(
    new Promise((resolve) => {
      finish = () => resolve({ stdout: "late" });
    }),
  );
  const controller = new AbortController();
  const response = respond(owner.ctx, pending, true, controller.signal);
  await vi.waitFor(() => expect(io.shellSessionRun).toHaveBeenCalledTimes(1));
  controller.abort();
  const calls = fileToolCallsFor(owner.ctx);
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
  finish();
  await response;
  await vi.waitFor(() =>
    expect(() => calls.capture("after", "read_file", {}, target)).not.toThrow(),
  );
  calls.retireAll();
});

it.each([false, true])(
  "serializes same-source commands and checks queued retirement (%s)",
  async (retired) => {
    const owner = fixture();
    const first = await request(
      owner.ctx,
      "bash_run",
      { command: "first" },
      "first",
    );
    const second = await request(
      owner.ctx,
      "bash_run",
      { command: "second" },
      "second",
    );
    let finish!: () => void;
    io.shellSessionRun.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ stdout: "first" });
        }),
    );
    const firstResult = respond(owner.ctx, first);
    await vi.waitFor(() => expect(io.shellSessionRun).toHaveBeenCalledTimes(1));
    const secondTool = buildShellTools(owner.ctx).bash_run;
    const secondResult = secondTool.execute?.(
      { command: "second" },
      {
        toolCallId: "second",
        context: {},
        messages: [
          ...second.messages,
          {
            role: "tool",
            content: [
              {
                type: "tool-approval-response",
                approvalId: second.approvalId,
                approved: true,
              },
            ],
          },
        ],
      },
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(io.shellSessionRun).toHaveBeenCalledTimes(1);
    if (retired) fileToolCallsFor(owner.ctx).retireAll();
    finish();
    await firstResult;
    const result = await secondResult;
    expect(io.shellSessionRun).toHaveBeenCalledTimes(retired ? 1 : 2);
    if (retired) expect(result).toHaveProperty("error");
    else
      expect(
        io.shellSessionRun.mock.calls.map(([, command]) => command),
      ).toEqual(["first", "second"]);
    expect(io.shellSessionOpen).toHaveBeenCalledTimes(1);
  },
);

it("refuses new shell metadata beyond the shared cache bound", async () => {
  const owner = fixture();
  let limited = false;
  for (let index = 0; index <= 256; index++) {
    owner.ctx.getFileContext = () => ({
      directory: `/fixture/cap-${index}`,
      workspace: { kind: "local" },
    });
    const result = await respond(
      owner.ctx,
      await request(owner.ctx, "bash_run"),
    );
    if (
      result.outputs.some(
        (value) =>
          typeof value === "object" && value !== null && "error" in value,
      )
    ) {
      expect(result.outputs).toEqual([
        { error: "Error: Too many cached agent shells." },
      ]);
      limited = true;
      break;
    }
  }
  expect(limited).toBe(true);
  expect(io.shellSessionOpen.mock.calls.length).toBeGreaterThan(0);
  expect(io.shellSessionOpen.mock.calls.length).toBeLessThanOrEqual(256);
});
