// @vitest-environment happy-dom
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Chat, type UIMessage } from "@ai-sdk/react";
import type { ToolUIPart } from "ai";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AiToolApproval } from "@/modules/ai/components/AiToolApproval";
import { ApprovalSessionContext } from "@/modules/ai/lib/useShellApprovalSource";
import { fileToolCallsFor } from "@/modules/ai/lib/fileToolCalls";
import { registerChatFileTools } from "@/modules/ai/lib/chatFileTools";
import { chats, useChatStore } from "@/modules/ai/store/chatStore";
import type { ToolContext } from "@/modules/ai/tools/context";

vi.mock("@/modules/i18n", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));

const input = { command: "fixture" };
const part: Extract<ToolUIPart, { state: "approval-requested" }> = {
  type: "tool-bash_run",
  toolCallId: "call",
  state: "approval-requested",
  input,
  approval: { id: "approval" },
};
let root: Root;
let node: HTMLDivElement;
const respond = vi.fn();

function fixture(id: string, directory = "/fixture/original") {
  const chat = new Chat<UIMessage>({
    id,
    transport: {
      sendMessages: async () =>
        new ReadableStream({ start: (controller) => controller.close() }),
      reconnectToStream: async () => null,
    },
  });
  chats.set(id, chat);
  const ctx: ToolContext = {
    getCwd: () => directory,
    getWorkspaceRoot: () => directory,
    getSessionId: () => id,
    getTerminalContext: () => null,
    isActiveTerminalPrivate: () => false,
    injectIntoActivePty: () => false,
    openPreview: () => false,
    spawnAgent: () => null,
    readAgentOutput: () => null,
    readCache: new Map(),
  };
  registerChatFileTools(chat, ctx);
  const calls = fileToolCallsFor(ctx);
  const target = {
    directory,
    root: directory,
    workspace: {
      kind: "ssh" as const,
      root: "/fixture",
      sessionId: 7,
      connection: {
        id,
        name: "Original host",
        host: "fixture.invalid",
        user: "fixture",
        identityFile: "PRIVATE_IDENTITY",
        extraArgs: "PRIVATE_ARGS",
      },
    },
  };
  calls.capture("call", "bash_run", input, target).bindApproval("approval");
  return { chat, ctx, calls, target };
}

async function render(
  sessionId: string | null = "original",
  value = part,
  toolName = "bash_run",
) {
  await act(async () => {
    root.render(
      createElement(
        StrictMode,
        null,
        createElement(
          ApprovalSessionContext.Provider,
          { value: sessionId },
          createElement(AiToolApproval, {
            part: value,
            toolName,
            onRespond: respond,
          }),
        ),
      ),
    );
  });
}

function allow(): HTMLButtonElement {
  const button = [...node.querySelectorAll("button")].find((item) =>
    item.textContent?.includes("ai.approvals.allow"),
  );
  if (!button) throw new Error("Missing Allow button");
  return button;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  respond.mockReset();
  node = document.createElement("div");
  root = createRoot(node);
});
afterEach(async () => {
  await act(async () => root.unmount());
  chats.clear();
  useChatStore.setState({ activeSessionId: null });
  vi.unstubAllGlobals();
});

it("shows the original chat's source and SSH identity while another chat is selected", async () => {
  fixture("original");
  fixture("other", "/fixture/replacement");
  useChatStore.setState({ activeSessionId: "other" });
  await render();
  expect(node.textContent).toContain("harness.chrome.source");
  expect(node.textContent).toContain("/fixture/original");
  expect(node.textContent).toContain(
    "SSH · Original host · fixture@fixture.invalid:22",
  );
  expect(node.textContent).not.toContain("/fixture/replacement");
  expect(node.textContent).not.toContain("PRIVATE_IDENTITY");
  expect(node.textContent).not.toContain("PRIVATE_ARGS");
  await act(async () => allow().click());
  expect(respond).toHaveBeenCalledExactlyOnceWith(true);
});

it.each(["restored", "missing", "mismatch", "ownerless"])(
  "disables restored or mismatched shell approval: %s",
  async (mode) => {
    if (mode !== "missing") {
      const original = fixture("original");
      if (mode === "restored") original.calls.retireAll();
    }
    await render(
      mode === "ownerless" ? null : "original",
      mode === "mismatch" ? { ...part, input: { command: "changed" } } : part,
    );
    expect(node.textContent).toContain("common.expired");
    expect(allow().disabled).toBe(true);
    await act(async () =>
      allow().dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
    expect(respond).not.toHaveBeenCalled();
    const deny = [...node.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("ai.approvals.deny"),
    );
    await act(async () => deny?.click());
    if (mode === "ownerless" || mode === "missing")
      expect(respond).not.toHaveBeenCalled();
    else expect(respond).toHaveBeenCalledExactlyOnceWith(false);
  },
);

it.each(["retired", "replacement"])(
  "rejects Allow after the original source becomes %s",
  async (mode) => {
    const original = fixture("original");
    await render();
    expect(allow().disabled).toBe(false);
    await act(async () => {
      if (mode === "retired") original.calls.retireAll();
      else fixture("original", "/fixture/replacement");
    });
    if (mode === "retired") expect(allow().disabled).toBe(true);
    await act(async () => allow().click());
    expect(respond).not.toHaveBeenCalled();
    expect(allow().disabled).toBe(true);
    expect(node.textContent).toContain("common.expired");
  },
);

it("keeps one bounded observation through StrictMode and releases it on unmount", async () => {
  const original = fixture("original");
  await render();
  await render();
  const readers = Array.from({ length: 255 }, () =>
    original.calls.observe("call", "bash_run", input, "approval"),
  );
  expect(() =>
    original.calls.observe("call", "bash_run", input, "approval"),
  ).toThrow("Too many");
  await act(async () => root.render(null));
  const last = original.calls.observe("call", "bash_run", input, "approval");
  last.release();
  for (const reader of readers) reader.release();
  original.calls.retireAll();
});

it("preserves approval behavior for tools without a shell source", async () => {
  await render(
    null,
    { ...part, type: "tool-browser_eval", input: { script: "fixture" } },
    "browser_eval",
  );
  expect(allow().disabled).toBe(false);
  await act(async () => allow().click());
  expect(respond).toHaveBeenCalledExactlyOnceWith(true);
});
