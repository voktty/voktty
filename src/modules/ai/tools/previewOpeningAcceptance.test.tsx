// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useAiLiveBridge } from "@/modules/ai/lib/useAiLiveBridge";
import type { Live } from "@/modules/ai/store/chatStore";
import type { ToolContext } from "@/modules/ai/tools/context";
import { buildTerminalTools } from "@/modules/ai/tools/terminal";
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));
afterEach(() => vi.unstubAllGlobals());
const url = "http://localhost:4000/page";
const context = (openPreview: ToolContext["openPreview"]): ToolContext => ({
  getCwd: () => null,
  getWorkspaceRoot: () => null,
  getTerminalContext: () => null,
  isActiveTerminalPrivate: () => false,
  injectIntoActivePty: () => false,
  openPreview,
  spawnAgent: () => null,
  readAgentOutput: () => null,
  readCache: new Map(),
  getSessionId: () => null,
});
const options = { toolCallId: "preview", messages: [], context: {} };
it.each([true, false])(
  "awaits the opening outcome before reporting %s",
  async (accepted) => {
    let finish!: (value: boolean) => void;
    const pending = new Promise<boolean>((resolve) => {
      finish = resolve;
    });
    const open = vi.fn(() => pending);
    const tools = buildTerminalTools(context(open));
    const execute = tools.open_preview.execute;
    if (!execute) throw new Error("Preview tool execution absent");
    const result = execute({ url }, options);
    let settled = false;
    void Promise.resolve(result).then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    finish(accepted);
    expect(await result).toEqual(
      accepted
        ? { url, ok: true }
        : { url, error: "preview surface unavailable" },
    );
  },
);
it("preserves the loopback restriction before invoking an asynchronous opener", async () => {
  const open = vi.fn(async () => true);
  const execute = buildTerminalTools(context(open)).open_preview.execute;
  if (!execute) throw new Error("Preview tool execution absent");
  const result = await execute({ url: "https://example.test" }, options);
  expect(result).toHaveProperty("error");
  expect(open).not.toHaveBeenCalled();
});
it.each([42, undefined])(
  "the live bridge reports only an actual accepted tab id (%s)",
  async (id) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    let finish!: (value: number | undefined) => void;
    const open = vi.fn(
      () =>
        new Promise<number | undefined>((resolve) => {
          finish = resolve;
        }),
    );
    let captured!: Live;
    const root = createRoot(document.createElement("div"));
    function Window() {
      useAiLiveBridge({
        setLive: (live) => {
          captured = live;
        },
        activeId: -1,
        tabs: [],
        explorerRoot: null,
        launchCwd: null,
        home: null,
        openPreviewTab: open,
        newAgentTab: () => ({ tabId: 1, leafId: 2 }),
        terminalRefs: { current: new Map() },
        editorRefs: { current: new Map() },
      });
      return null;
    }
    try {
      await act(async () => root.render(<Window />));
      const result = captured.openPreview(url);
      finish(id);
      expect(await result).toBe(id !== undefined);
      expect(open).toHaveBeenCalledExactlyOnceWith(url);
    } finally {
      await act(async () => root.unmount());
    }
  },
);
