import { beforeEach, expect, it, vi } from "vitest";
import { buildShellTools } from "@/modules/ai/tools/shell";
import type { ToolContext } from "@/modules/ai/tools/context";
import { captureFileApproval } from "@/modules/ai/lib/fileToolApprovals";
import { fileToolCallsFor } from "@/modules/ai/lib/fileToolCalls";
import {
  forgetChatFileTools,
  previewChatFileTool,
  registerChatFileTools,
  retireChatFileTools,
} from "@/modules/ai/lib/chatFileTools";

const io = vi.hoisted(() => ({
  shellSessionOpen: vi.fn(),
  shellSessionRun: vi.fn(),
  shellSessionClose: vi.fn(),
}));
vi.mock("@/modules/ai/lib/native", () => ({ native: io }));
beforeEach(() => {
  vi.resetAllMocks();
  io.shellSessionOpen.mockResolvedValue(7);
  io.shellSessionRun.mockResolvedValue({
    stdout: "fixture",
    stderr: "",
    exit_code: 0,
    timed_out: false,
    truncated: false,
    cwd_after: "/fixture",
  });
  io.shellSessionClose.mockResolvedValue(undefined);
});

function fixture() {
  const chat = {};
  const ctx: ToolContext = {
    getFileContext: () => ({
      directory: "/fixture",
      workspace: { kind: "local" },
    }),
    getCwd: () => "/fixture",
    getWorkspaceRoot: () => "/fixture",
    getSessionId: () => "same-chat-id",
    getTerminalContext: () => null,
    isActiveTerminalPrivate: () => false,
    injectIntoActivePty: () => false,
    openPreview: () => false,
    spawnAgent: () => null,
    readAgentOutput: () => null,
    readCache: new Map(),
  };
  registerChatFileTools(chat, ctx);
  return { chat, ctx };
}
async function run(ctx: ToolContext, id = "call") {
  const tools = buildShellTools(ctx);
  const input = { command: "fixture" };
  const options = { toolCallId: id, messages: [], context: {} };
  await tools.bash_run.onInputAvailable?.({ ...options, input });
  captureFileApproval(tools, {
    approvalId: id,
    toolCall: { toolName: "bash_run", toolCallId: id },
  });
  return tools.bash_run.execute?.(input, {
    ...options,
    messages: [
      {
        role: "assistant",
        content: [
          { type: "tool-approval-request", toolCallId: id, approvalId: id },
        ],
      },
      {
        role: "tool",
        content: [
          { type: "tool-approval-response", approvalId: id, approved: true },
        ],
      },
    ],
  });
}

it("preserves cwd metadata on Stop and closes it when the exact chat is forgotten", async () => {
  const original = fixture();
  await run(original.ctx);
  retireChatFileTools(original.chat);
  expect(io.shellSessionClose).not.toHaveBeenCalled();
  await run(original.ctx, "second");
  expect(io.shellSessionOpen).toHaveBeenCalledTimes(1);
  forgetChatFileTools(original.chat);
  await vi.waitFor(() =>
    expect(io.shellSessionClose).toHaveBeenCalledExactlyOnceWith(7),
  );
  expect(() =>
    fileToolCallsFor(original.ctx).capture(
      "late",
      "bash_background",
      {},
      {
        directory: "/fixture",
        root: "/fixture",
        workspace: { kind: "local" },
      },
    ),
  ).toThrow("retired");
});

it("forgets only the original runtime, even when a replacement reuses its chat ID", async () => {
  const original = fixture();
  const replacement = fixture();
  io.shellSessionOpen.mockResolvedValueOnce(7).mockResolvedValueOnce(8);
  await run(original.ctx);
  await run(replacement.ctx);
  forgetChatFileTools(original.chat);
  await vi.waitFor(() =>
    expect(io.shellSessionClose).toHaveBeenCalledExactlyOnceWith(7),
  );
  await run(replacement.ctx, "fresh");
  expect(io.shellSessionRun).toHaveBeenLastCalledWith(
    8,
    "fixture",
    "/fixture",
    undefined,
    { kind: "local" },
  );
  forgetChatFileTools(replacement.chat);
  await vi.waitFor(() => expect(io.shellSessionClose).toHaveBeenCalledTimes(2));
});

it("defers metadata close until an admitted command physically settles", async () => {
  const original = fixture();
  let finish!: (value: unknown) => void;
  io.shellSessionRun.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const pending = run(original.ctx);
  await vi.waitFor(() => expect(io.shellSessionRun).toHaveBeenCalledTimes(1));
  forgetChatFileTools(original.chat);
  expect(io.shellSessionClose).not.toHaveBeenCalled();
  finish({ stdout: "late" });
  await pending;
  await vi.waitFor(() =>
    expect(io.shellSessionClose).toHaveBeenCalledExactlyOnceWith(7),
  );
});

it("preserves a reentrant replacement context registered while the old one is forgotten", async () => {
  const original = fixture();
  const replacement = fixture();
  io.shellSessionOpen.mockResolvedValueOnce(7).mockResolvedValueOnce(8);
  await run(original.ctx);
  await run(replacement.ctx);
  const target = {
    directory: "/fixture",
    root: "/fixture",
    workspace: { kind: "local" as const },
  };
  fileToolCallsFor(original.ctx).capture(
    "pending",
    "read_file",
    {},
    target,
    () => {
      registerChatFileTools(original.chat, replacement.ctx);
    },
  );
  fileToolCallsFor(replacement.ctx)
    .capture("replacement", "read_file", {}, target)
    .bindApproval("replacement");
  forgetChatFileTools(original.chat);
  const view = previewChatFileTool(
    original.chat,
    "replacement",
    "read_file",
    {},
    "replacement",
  );
  expect(view.isCurrent()).toBe(true);
  view.release();
  await vi.waitFor(() =>
    expect(io.shellSessionClose).toHaveBeenCalledExactlyOnceWith(7),
  );
  await run(replacement.ctx, "next");
  expect(io.shellSessionOpen).toHaveBeenCalledTimes(2);
  forgetChatFileTools(original.chat);
  await vi.waitFor(() => expect(io.shellSessionClose).toHaveBeenCalledTimes(2));
});
