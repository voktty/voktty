// @vitest-environment happy-dom
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { UIMessage } from "ai";
import type { ToolContext } from "@/modules/ai/tools/context";
import { fileToolCallsFor } from "@/modules/ai/lib/fileToolCalls";
import { registerChatFileTools } from "@/modules/ai/lib/chatFileTools";
import { AgentRunBridge } from "@/modules/ai/components/AgentRunBridge";

const fixture = vi.hoisted(() => ({
  chat: {},
  messages: [] as UIMessage[],
  canonicalize: vi.fn(async (path: string) => path),
  readFile: vi.fn(),
  store: {
    activeSessionId: "fixture-chat",
    patchAgentMeta: vi.fn(),
    presentChat: vi.fn(),
    noteUnreadMessage: vi.fn(),
    persistMessages: vi.fn(),
    setApprovalResponder: vi.fn(),
    live: { getCwd: () => "/replacement" },
  },
}));
vi.mock("@ai-sdk/react", () => ({
  useChat: () => ({
    status: "ready",
    messages: fixture.messages,
    addToolApprovalResponse: vi.fn(),
  }),
}));
vi.mock("@/modules/ai/store/chatRuntime", () => ({
  getOrCreateChat: () => fixture.chat,
}));
vi.mock("@/modules/ai/store/chatStore", () => ({
  useChatStore: Object.assign(
    (selector: (value: typeof fixture.store) => unknown) =>
      selector(fixture.store),
    { getState: () => fixture.store },
  ),
  flushPersist: vi.fn(),
}));
vi.mock("@/modules/ai/lib/native", () => ({
  native: { canonicalize: fixture.canonicalize, readFile: fixture.readFile },
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));

const input = { path: "file.ts", content: "proposed" };
const workspace = { kind: "wsl" as const, distro: "original" };
let root: Root | null;
let node: HTMLDivElement;
let finish: () => void;
const open = vi.fn(() => 42);
const close = vi.fn();

function context(): ToolContext {
  return {
    getCwd: () => "/replacement",
    getWorkspaceRoot: () => "/replacement",
    getSessionId: () => "fixture-chat",
    getTerminalContext: () => null,
    isActiveTerminalPrivate: () => false,
    injectIntoActivePty: () => false,
    openPreview: () => false,
    spawnAgent: () => null,
    readAgentOutput: () => null,
    readCache: new Map(),
  };
}

function pending(): UIMessage {
  return {
    id: "assistant",
    role: "assistant",
    parts: [
      {
        type: "tool-write_file",
        toolCallId: "call",
        state: "approval-requested",
        input,
        approval: { id: "approval" },
      },
    ],
  };
}

async function render(strict = false) {
  await act(async () => {
    const bridge = createElement(AgentRunBridge, {
      openAiDiffTab: open,
      closeAiDiffTab: close,
    });
    root?.render(strict ? createElement(StrictMode, null, bridge) : bridge);
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  node = document.createElement("div");
  root = createRoot(node);
  fixture.messages = [pending()];
  const result = new Promise<{ kind: "text"; content: string; size: number }>(
    (resolve) => {
      finish = () => resolve({ kind: "text", content: "original", size: 8 });
    },
  );
  fixture.readFile.mockReturnValue(result);
});
afterEach(async () => {
  await act(async () => {
    root?.unmount();
    root = null;
    finish();
  });
  node.remove();
  vi.unstubAllGlobals();
});

function capture() {
  const owner = context();
  registerChatFileTools(fixture.chat, owner);
  fileToolCallsFor(owner)
    .capture("call", "write_file", input, {
      directory: "/original",
      root: "/original",
      workspace,
    })
    .bindApproval("approval");
  return owner;
}

it("reads and opens the captured destination after unrelated tokens and ambient selection changes", async () => {
  capture();
  await render();
  expect(fixture.readFile).toHaveBeenCalledExactlyOnceWith(
    "/original/file.ts",
    workspace,
  );
  fixture.messages = [
    {
      ...pending(),
      parts: [...pending().parts, { type: "text", text: "streaming" }],
    },
  ];
  await render();
  expect(fixture.readFile).toHaveBeenCalledTimes(1);
  await act(async () => finish());
  expect(open).toHaveBeenCalledExactlyOnceWith({
    approvalSessionId: "fixture-chat",
    path: "/original/file.ts",
    workspaceEnv: workspace,
    originalContent: "original",
    proposedContent: "proposed",
    approvalId: "approval",
    isNewFile: false,
  });
});

it.each(["denied", "unmount"])(
  "does not open a late preview after %s",
  async (mode) => {
    capture();
    await render();
    expect(fixture.readFile).toHaveBeenCalledTimes(1);
    if (mode === "unmount")
      await act(async () => {
        root?.unmount();
        root = null;
      });
    else {
      fixture.messages = [
        {
          id: "assistant",
          role: "assistant",
          parts: [
            {
              type: "tool-write_file",
              toolCallId: "call",
              state: "approval-responded",
              input,
              approval: { id: "approval", approved: false },
            },
          ],
        },
      ];
      await render();
    }
    await act(async () => finish());
    expect(open).not.toHaveBeenCalled();
  },
);

it("retires the discarded StrictMode reader without suppressing the new presentation", async () => {
  capture();
  await render(true);
  expect(fixture.canonicalize).toHaveBeenCalledTimes(3);
  expect(fixture.readFile).toHaveBeenCalledTimes(1);
  await act(async () => finish());
  expect(open).toHaveBeenCalledTimes(1);
});

it("never reads an ambient file for an approval without its original runtime capture", async () => {
  registerChatFileTools(fixture.chat, context());
  await render();
  expect(fixture.canonicalize).not.toHaveBeenCalled();
  expect(fixture.readFile).not.toHaveBeenCalled();
  expect(open).not.toHaveBeenCalled();
});
