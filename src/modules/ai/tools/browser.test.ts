import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  useLiveComponentStore,
  usePreviewDevtoolsStore,
  usePreviewHandleStore,
} from "@/modules/preview";
import type { PreviewPaneHandle } from "@/modules/preview";
import { buildBrowserTools } from "./browser";
import type { ToolContext } from "./context";

const mockContext: ToolContext = {
  getCwd: () => "C:\\project",
  getWorkspaceRoot: () => "C:\\project",
  getTerminalContext: () => null,
  isActiveTerminalPrivate: () => false,
  injectIntoActivePty: () => false,
  openPreview: () => false,
  spawnAgent: () => null,
  readAgentOutput: () => null,
  readCache: new Map(),
  getSessionId: () => "test-session",
};

function fakeHandle(
  send: (command: string, args?: unknown) => Promise<unknown>,
): PreviewPaneHandle {
  return {
    reload: () => {},
    focusAddressBar: () => {},
    getUrl: () => "http://localhost:3000",
    navigate: vi.fn(),
    sendBrowserCommand: <T>(command: string, args?: unknown) =>
      send(command, args) as Promise<T>,
  };
}

describe("browser AI tools", () => {
  beforeEach(() => {
    useLiveComponentStore.setState({
      selectedComponent: null,
      isInspectorActive: false,
      history: [],
    });
    usePreviewHandleStore.setState({ handles: new Map(), activeTabId: null });
  });

  it("reports no selected component when store is empty", async () => {
    const tools = buildBrowserTools(mockContext);
    const result = await tools.browser_get_selected_component.execute!(
      {},
      { toolCallId: "test", messages: [] },
    );
    expect(result).toEqual({
      selected: false,
      message:
        "No live component is currently selected in the browser. Toggle inspection with Ctrl+G and click an element.",
    });
  });

  it("returns full component context when component is selected", async () => {
    useLiveComponentStore.getState().setSelectedComponent({
      id: "comp-123",
      timestamp: 1234567,
      url: "http://localhost:3000",
      componentName: "HeaderNav",
      filePath: "src/HeaderNav.tsx",
      lineNumber: 15,
      framework: "react",
      selector: "nav.header",
      tagName: "nav",
      classList: ["header"],
      htmlSnippet: "<nav class=\"header\">Nav</nav>",
      innerText: "Nav",
      attributes: {},
      hierarchy: ["App", "HeaderNav"],
    });

    const tools = buildBrowserTools(mockContext);
    const result = (await tools.browser_get_selected_component.execute!(
      {},
      { toolCallId: "test", messages: [] },
    )) as {
      selected: boolean;
      component: { componentName: string };
      directive: string;
      candidateGrepQueries: string[];
    };

    expect(result.selected).toBe(true);
    expect(result.component.componentName).toBe("HeaderNav");
    expect(result.directive).toContain("Component: <HeaderNav>");
    expect(result.directive).toContain("Source File: src/HeaderNav.tsx:15");
    expect(result.candidateGrepQueries).toContain("<HeaderNav");
  });

  it("activates and deactivates inspector", async () => {
    const tools = buildBrowserTools(mockContext);

    const res1 = (await tools.browser_inspect.execute!(
      { active: true },
      { toolCallId: "test", messages: [] },
    )) as { ok: boolean; active: boolean; message: string };
    expect(res1.active).toBe(true);
    expect(useLiveComponentStore.getState().isInspectorActive).toBe(true);

    const res2 = (await tools.browser_inspect.execute!(
      { active: false },
      { toolCallId: "test", messages: [] },
    )) as { ok: boolean; active: boolean; message: string };
    expect(res2.active).toBe(false);
    expect(useLiveComponentStore.getState().isInspectorActive).toBe(false);
  });

  it("clears selection via browser_clear_selection tool", async () => {
    useLiveComponentStore.getState().setSelectedComponent({
      id: "comp-1",
      timestamp: 1,
      url: "http://localhost:3000",
      framework: "dom-generic",
      selector: "button",
      tagName: "button",
      classList: [],
      htmlSnippet: "<button>Click</button>",
      innerText: "Click",
      attributes: {},
      hierarchy: ["button"],
    });

    const tools = buildBrowserTools(mockContext);
    const res = (await tools.browser_clear_selection.execute!(
      {},
      { toolCallId: "test", messages: [] },
    )) as { ok: boolean; message: string };

    expect(res.ok).toBe(true);
    expect(useLiveComponentStore.getState().selectedComponent).toBeNull();
  });

  it("reports no active preview for snapshot and click", async () => {
    const tools = buildBrowserTools(mockContext);
    const snapshot = (await tools.browser_snapshot.execute!(
      {},
      { toolCallId: "test", messages: [] },
    )) as { error: string };
    expect(snapshot.error).toBe("no_active_preview");

    const click = (await tools.browser_click.execute!(
      { selector: "button" },
      { toolCallId: "test", messages: [] },
    )) as { error: string };
    expect(click.error).toBe("no_active_preview");
  });

  it("runs snapshot, click, type, eval and navigate against the active handle", async () => {
    const send = vi.fn(async (command: string) => {
      if (command === "snapshot") return { nodes: [{ ref: 1, tag: "button" }] };
      if (command === "eval") return { result: 4 };
      return { ok: true };
    });
    const handle = fakeHandle(send);
    usePreviewHandleStore.getState().registerHandle(7, handle);
    const tools = buildBrowserTools(mockContext);

    const snapshot = (await tools.browser_snapshot.execute!(
      {},
      { toolCallId: "test", messages: [] },
    )) as { ok: boolean; result: { nodes: unknown[] } };
    expect(snapshot.ok).toBe(true);
    expect(snapshot.result.nodes).toHaveLength(1);

    const missing = (await tools.browser_click.execute!(
      { ref: 99 },
      { toolCallId: "test", messages: [] },
    )) as { ok: boolean };
    expect(send).toHaveBeenCalledWith("click", { ref: 99, selector: undefined });
    expect(missing.ok).toBe(true);

    send.mockRejectedValueOnce(new Error("element_not_found"));
    const notFound = (await tools.browser_click.execute!(
      { selector: "#gone" },
      { toolCallId: "test", messages: [] },
    )) as { error: string };
    expect(notFound.error).toBe("element_not_found");

    await tools.browser_type.execute!(
      { selector: "input", text: "hi", submit: true },
      { toolCallId: "test", messages: [] },
    );
    expect(send).toHaveBeenCalledWith("type", {
      ref: undefined,
      selector: "input",
      text: "hi",
      submit: true,
    });

    const evaluated = (await tools.browser_eval.execute!(
      { script: "2+2" },
      { toolCallId: "test", messages: [] },
    )) as { ok: boolean; result: { result: number } };
    expect(evaluated.result.result).toBe(4);

    const nav = (await tools.browser_navigate.execute!(
      { url: "http://localhost:5173" },
      { toolCallId: "test", messages: [] },
    )) as { ok: boolean };
    expect(nav.ok).toBe(true);
    expect(handle.navigate).toHaveBeenCalledWith("http://localhost:5173");

    const blocked = (await tools.browser_navigate.execute!(
      { url: "https://example.com" },
      { toolCallId: "test", messages: [] },
    )) as { error: string };
    expect(blocked.error).toBe("url_not_local");
  });

  it("returns the captured network log", async () => {
    usePreviewDevtoolsStore.getState().clearNetwork();
    usePreviewDevtoolsStore.getState().addNetworkEntry({
      id: "n1",
      method: "GET",
      url: "/health",
      status: 200,
      durationMs: 3,
      size: 2,
      timestamp: 1,
    });
    const tools = buildBrowserTools(mockContext);
    const log = (await tools.browser_get_network_log.execute!(
      {},
      { toolCallId: "test", messages: [] },
    )) as { entries: Array<{ url: string }> };
    expect(log.entries[0].url).toBe("/health");
  });
});
