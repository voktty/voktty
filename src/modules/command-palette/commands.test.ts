import type { Tab } from "@/modules/tabs";
import { describe, expect, it } from "vitest";
import {
  type CommandPaletteActionContext,
  createCommandItems,
} from "./commands";

function terminalTab(id: number): Tab {
  return {
    id,
    kind: "terminal",
    spaceId: "s",
    title: "shell",
    paneTree: { kind: "leaf", id: id * 10 },
    activeLeafId: id * 10,
  } as unknown as Tab;
}

function terminalTabWithPanes(id: number, count: number): Tab {
  const tab = terminalTab(id);
  return {
    ...tab,
    paneTree: {
      kind: "split",
      id: id * 100,
      dir: "row",
      children: Array.from({ length: count }, (_, index) => ({
        kind: "leaf" as const,
        id: id * 1000 + index,
      })),
    },
  } as Tab;
}

function baseContext(
  over: Partial<CommandPaletteActionContext> = {},
): CommandPaletteActionContext {
  const noop = () => {};
  return {
    tabs: [terminalTab(1)],
    activeId: 1,
    searchTarget: "content" as never,
    explorerRoot: "/workspace",
    home: "/home/me",
    spaces: [],
    activeSpaceId: null,
    openNewTab: noop,
    openNewBlock: noop,
    openNewPrivate: noop,
    openNewEditor: noop,
    openQuickOpen: noop,
    openWorkspaceSearch: noop,
    openOutline: noop,
    openProblems: noop,
    navigateBack: noop,
    navigateForward: noop,
    canNavigateBack: false,
    canNavigateForward: false,
    openNewPreview: noop,
    openActiveTabs: noop,
    openGitGraph: noop,
    toggleSourceControl: noop,
    closeActiveTabOrPane: noop,
    reopenClosedEditor: () => null,
    splitPaneRight: noop,
    splitPaneDown: noop,
    focusSearch: noop,
    focusExplorerSearch: noop,
    toggleSidebar: noop,
    toggleHiddenFiles: noop,
    toggleAi: noop,
    askAiSelection: noop,
    openSettings: noop,
    openKeyboardShortcuts: noop,
    openSpacesOverview: noop,
    newSpace: noop,
    switchSpace: noop,
    editorActions: null,
    ...over,
  };
}

function reasonById(over: Partial<CommandPaletteActionContext>, id: string) {
  const item = createCommandItems(baseContext(over)).find((i) => i.id === id);
  if (!item) throw new Error(`no command item ${id}`);
  return item.disabledReason;
}

describe("createCommandItems", () => {
  it("removes built-in AI actions when AI is unavailable", () => {
    const ids = createCommandItems(baseContext({ aiAvailable: false })).map(
      (item) => item.id,
    );
    expect(ids).not.toContain("ai.toggle");
    expect(ids).not.toContain("ai.askSelection");
    expect(ids).not.toContain("editor.inlineAi");
    expect(ids).not.toContain("editor.aiComplete");
    expect(ids).toContain("editor.codeComplete");
  });

  it("enables split on a terminal tab below the pane limit", () => {
    expect(reasonById({}, "pane.splitRight")).toBeUndefined();
    expect(reasonById({}, "pane.splitDown")).toBeUndefined();
  });

  it("exposes composed-space focus and lifecycle commands", () => {
    const calls: string[] = [];
    const items = createCommandItems(
      baseContext({
        activeViewSpacePresentation: "composite",
        focusNextSpaceSlot: () => calls.push("next"),
        focusPreviousSpaceSlot: () => calls.push("previous"),
        toggleFocusedSpaceView: () => calls.push("toggle"),
        extractFocusedSpaceMember: () => calls.push("extract"),
        moveFocusedSpaceMember: () => calls.push("move"),
        closeFocusedSpaceMember: () => calls.push("close"),
      }),
    );

    for (const id of [
      "spaces.focusNextSlot",
      "spaces.focusPreviousSlot",
      "spaces.toggleView",
      "spaces.extractFocusedMember",
      "spaces.moveFocusedMember",
      "spaces.closeFocusedMember",
    ]) {
      const item = items.find((candidate) => candidate.id === id);
      expect(item?.disabledReason).toBeUndefined();
      item?.run();
    }
    expect(calls).toEqual([
      "next",
      "previous",
      "toggle",
      "extract",
      "move",
      "close",
    ]);
  });

  it("disables split after eight panes", () => {
    expect(
      reasonById({ tabs: [terminalTabWithPanes(1, 8)] }, "pane.splitRight"),
    ).toBe("Pane limit");
  });

  it("disables split when there is no terminal tab", () => {
    const editorTab = { ...terminalTab(1), kind: "editor" } as unknown as Tab;
    expect(reasonById({ tabs: [editorTab] }, "pane.splitRight")).toBe(
      "No terminal tab",
    );
  });

  it("disables close on the last tab with a single pane", () => {
    expect(reasonById({}, "tab.close")).toBe("Last tab");
  });

  it("disables close when active tab is locked", () => {
    const lockedTab = { ...terminalTab(1), locked: true } as unknown as Tab;
    expect(
      reasonById(
        { tabs: [lockedTab, terminalTab(2)], activeId: 1 },
        "tab.close",
      ),
    ).toBe("Tab is locked");
  });

  it("enables close when more than one tab is open", () => {
    expect(
      reasonById({ tabs: [terminalTab(1), terminalTab(2)] }, "tab.close"),
    ).toBeUndefined();
  });

  it("disables content search when there is no searchable view", () => {
    expect(reasonById({ searchTarget: null as never }, "search.focus")).toBe(
      "No searchable view",
    );
  });

  it("disables explorer search when there is no workspace root", () => {
    expect(reasonById({ explorerRoot: null }, "explorer.search")).toBe(
      "No workspace root",
    );
  });

  it("opens Quick Open through its independent palette command", () => {
    let opened = false;
    const item = createCommandItems(
      baseContext({ openQuickOpen: () => (opened = true) }),
    ).find((candidate) => candidate.id === "editor.quickOpen");

    expect(item?.shortcutId).toBe("file.quickOpen");
    item?.run();
    expect(opened).toBe(true);
  });

  it("opens persistent workspace search through its palette command", () => {
    let opened = false;
    const item = createCommandItems(
      baseContext({ openWorkspaceSearch: () => (opened = true) }),
    ).find((candidate) => candidate.id === "search.content");

    expect(item?.shortcutId).toBe("commandPalette.content");
    item?.run();
    expect(opened).toBe(true);
  });

  it("marks the active space as the current one", () => {
    const reason = reasonById(
      { spaces: [{ id: "sp1", name: "One" }], activeSpaceId: "sp1" },
      "spaces.switch.sp1",
    );
    expect(reason).toBe("Current space");
  });

  it("disables editor commands without an active editor", () => {
    expect(reasonById({}, "editor.gotoLine")).toBe("No active editor");
    expect(reasonById({}, "editor.formatDocument")).toBe("No active editor");
    expect(reasonById({}, "editor.quickFix")).toBe("No active editor");
    expect(reasonById({}, "editor.signatureHelp")).toBe("No active editor");
    expect(reasonById({}, "editor.goToImplementation")).toBe(
      "No active editor",
    );
  });

  it("runs editor commands through the active editor contract", () => {
    let calls = "";
    const noop = () => {};
    const editorActions = {
      openSearch: noop,
      openGotoLine: () => {
        calls = "goto";
      },
      formatDocument: noop,
      triggerInlineAi: noop,
      triggerQuickFix: noop,
      triggerSignatureHelp: () => {
        calls = "signature";
      },
      triggerLspNavigation: (
        kind: "definition" | "typeDefinition" | "implementation" | "references",
      ) => {
        calls = kind;
      },
      triggerLspPeek: (kind: "definition" | "references") => {
        calls = `peek:${kind}`;
      },
      triggerAiComplete: noop,
      triggerCodeComplete: noop,
      runEditCommand: (command: string) => {
        calls = command;
      },
      runInlineSuggestionCommand: (command: string) => {
        calls = `inline:${command}`;
      },
      splitGroup: (direction: string) => {
        calls = `split:${direction}`;
      },
      closeGroup: () => {
        calls = "closeGroup";
      },
      focusGroup: () => {
        calls = "focusGroup";
      },
    };
    const item = createCommandItems(baseContext({ editorActions })).find(
      (candidate) => candidate.id === "editor.gotoLine",
    );

    expect(item?.disabledReason).toBeUndefined();
    item?.run();
    expect(calls).toBe("goto");

    const signature = createCommandItems(baseContext({ editorActions })).find(
      (candidate) => candidate.id === "editor.signatureHelp",
    );
    signature?.run();
    expect(calls).toBe("signature");

    const implementation = createCommandItems(
      baseContext({ editorActions }),
    ).find((candidate) => candidate.id === "editor.goToImplementation");
    implementation?.run();
    expect(calls).toBe("implementation");

    const peekDefinition = createCommandItems(
      baseContext({ editorActions }),
    ).find((candidate) => candidate.id === "editor.peekDefinition");
    peekDefinition?.run();
    expect(calls).toBe("peek:definition");

    const references = createCommandItems(baseContext({ editorActions })).find(
      (candidate) => candidate.id === "editor.findReferences",
    );
    references?.run();
    expect(calls).toBe("peek:references");

    const moveLine = createCommandItems(baseContext({ editorActions })).find(
      (candidate) => candidate.id === "editor.moveLineUp",
    );
    moveLine?.run();
    expect(calls).toBe("moveLineUp");

    const acceptLine = createCommandItems(baseContext({ editorActions })).find(
      (candidate) => candidate.id === "editor.acceptAiLine",
    );
    acceptLine?.run();
    expect(calls).toBe("inline:acceptLine");
  });

  it("enables navigation only when the corresponding history entry exists", () => {
    expect(reasonById({}, "editor.navigateBack")).toBe(
      "No previous editor location",
    );
    expect(
      reasonById({ canNavigateBack: true }, "editor.navigateBack"),
    ).toBeUndefined();
    expect(reasonById({}, "editor.navigateForward")).toBe(
      "No next editor location",
    );
  });

  it("opens Outline through the palette for an active editor", () => {
    let opened = false;
    const noop = () => {};
    const editorActions = {
      openSearch: noop,
      openGotoLine: noop,
      formatDocument: noop,
      triggerInlineAi: noop,
      triggerQuickFix: noop,
      triggerSignatureHelp: noop,
      triggerLspNavigation: noop,
      triggerLspPeek: noop,
      triggerAiComplete: noop,
      triggerCodeComplete: noop,
      runEditCommand: noop,
      runInlineSuggestionCommand: noop,
      splitGroup: noop,
      closeGroup: noop,
      focusGroup: noop,
    };
    const item = createCommandItems(
      baseContext({
        editorActions,
        openOutline: () => {
          opened = true;
        },
      }),
    ).find((candidate) => candidate.id === "editor.outline");

    expect(item?.disabledReason).toBeUndefined();
    item?.run();
    expect(opened).toBe(true);
  });

  it("opens workspace Problems through the palette", () => {
    let opened = false;
    const item = createCommandItems(
      baseContext({
        openProblems: () => {
          opened = true;
        },
      }),
    ).find((candidate) => candidate.id === "editor.problems");

    expect(item?.disabledReason).toBeUndefined();
    item?.run();
    expect(opened).toBe(true);
  });

  it("triggers zoom actions through the palette", () => {
    let zoomedIn = false;
    let zoomedOut = false;
    let zoomedReset = false;

    const items = createCommandItems(
      baseContext({
        zoomIn: () => {
          zoomedIn = true;
        },
        zoomOut: () => {
          zoomedOut = true;
        },
        zoomReset: () => {
          zoomedReset = true;
        },
      }),
    );

    items.find((i) => i.id === "view.zoomIn")?.run();
    items.find((i) => i.id === "view.zoomOut")?.run();
    items.find((i) => i.id === "view.zoomReset")?.run();

    expect(zoomedIn).toBe(true);
    expect(zoomedOut).toBe(true);
    expect(zoomedReset).toBe(true);
  });

  it("includes agent operational history and terminal command history commands", () => {
    const items = createCommandItems(baseContext());
    const agentHist = items.find((i) => i.id === "agentHistory.open");
    const termHist = items.find((i) => i.id === "terminal.history");

    expect(agentHist).toBeDefined();
    expect(agentHist?.shortcutId).toBe("agentHistory.open");
    expect(termHist).toBeDefined();
    expect(termHist?.shortcutId).toBe("terminal.history");
  });
});
