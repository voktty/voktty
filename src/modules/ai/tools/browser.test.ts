import { beforeEach, describe, expect, it } from "vitest";
import { useLiveComponentStore } from "@/modules/preview";
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

describe("browser AI tools", () => {
  beforeEach(() => {
    useLiveComponentStore.setState({
      selectedComponent: null,
      isInspectorActive: false,
      history: [],
    });
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
});
