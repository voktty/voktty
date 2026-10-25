import type { Tab } from "@/modules/tabs";
import { createLauncherItems, type LauncherActionContext } from "@/modules/launcher/catalog";
import { SHORTCUTS } from "@/modules/shortcuts/shortcuts";
import { declaredCommandSurfaceRule, commandSurfaceUnavailableReason } from "@/modules/shortcuts/lib/commandSurface";
import { resolveActiveSurface } from "@/modules/surfaces/lib/activeSurface";
import { describe, expect, it, vi } from "vitest";
import { t } from "@/modules/i18n";
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
    tabs: over.editorActions ? [{ ...terminalTab(1), kind: "editor" } as unknown as Tab] : [terminalTab(1)],
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

it.each(["/project", "remote://machine/project"])("declares every catalog command and resolves its complete surface matrix at %s", (cwd) => {
  const noop = () => {};
  const ctx: LauncherActionContext = {
    ...baseContext({ spaces: [{ id: "one", name: "One" }, { id: "two", name: "Two" }],
      activeViewSpacePresentation: "composite", explorerRoot: cwd, aiAvailable: true }),
    openConnections: noop, openSshConnect: noop, openRdpConnect: noop, openGuestConnect: noop,
    openSerialConnect: noop, openFileFromDisk: noop, openNewApiClient: noop,
    openRunDebug: noop, openGitClone: noop, openNewHarness: noop, openOnboarding: noop,
  };
  const catalog = [...createCommandItems(ctx), ...createLauncherItems(ctx)];
  const ids = [...new Set([...catalog.map((item) => item.id), ...SHORTCUTS.map((item) => item.id)])];
  expect(ids.filter((id) => !declaredCommandSurfaceRule(id))).toEqual([]);
  const globalEditorCommands = new Set(["editor.openFile", "editor.openFolder", "editor.quickOpen", "editor.reopenClosed", "editor.problems"]);
  const terminalCommands = new Set(["pane.focusNext", "pane.focusPrev", "pane.swapLeft", "pane.swapRight", "pane.swapUp", "pane.swapDown", "terminal.toggleInput", "blocks.prev", "blocks.next"]);
  for (const kind of ["harness", "terminal", "editor", "other"] as const) {
    const surface = resolveActiveSurface({ kind, ownerId: 1, cwd, projectCwd: cwd, folder: cwd });
    for (const id of ids) {
      const editorOnly = (id.startsWith("editor.") && !globalEditorCommands.has(id)) || id === "launch.outline";
      const split = id === "pane.splitRight" || id === "pane.splitDown";
      const allowed = editorOnly ? kind === "editor" : terminalCommands.has(id) ? kind === "terminal" : split ? kind === "editor" || kind === "terminal" : true;
      const reason = editorOnly ? "editor-required" : "terminal-required";
      expect(commandSurfaceUnavailableReason(id, surface), `${id} on ${kind} at ${cwd}`).toBe(id === "editor.formatDocument" && kind === "editor" && cwd.startsWith("remote://") ? "format-filesystem-unsupported" : allowed ? null : reason);
      const item = catalog.find((candidate) => candidate.id === id);
      if (item) expect(item.appliesTo?.includes(kind), `${id} catalog on ${kind}`).toBe(allowed);
    }
  }
});

describe("createCommandItems", () => {
  it.each(["/workspace/file.ts", "remote://machine/project/file.ts"])("keeps format discoverable and constrains delivery to the document filesystem at %s", (path) => {
    const noop = () => {};
    const format = vi.fn();
    const editorActions: NonNullable<CommandPaletteActionContext["editorActions"]> = {
      openSearch: noop, openGotoLine: noop, formatDocument: format,
      triggerInlineAi: noop, triggerQuickFix: noop, triggerSignatureHelp: noop,
      triggerLspNavigation: noop, triggerLspPeek: noop, triggerAiComplete: noop,
      triggerCodeComplete: noop, runEditCommand: noop, runInlineSuggestionCommand: noop,
      splitGroup: noop, closeGroup: noop, focusGroup: noop,
    };
    const tab = { id: 1, kind: "editor", path, spaceId: "s", title: "file" } as Tab;
    const items = createCommandItems(baseContext({ tabs: [tab], editorActions }));
    const item = items.find((candidate) => candidate.id === "editor.formatDocument");
    expect(item).toBeDefined();
    expect(item?.appliesTo).toEqual(["editor"]);
    expect(item?.disabledReason).toBe(path.startsWith("remote://") ? t("git.unsupportedFilesystem") : undefined);
    item?.run();
    expect(format).toHaveBeenCalledTimes(path.startsWith("remote://") ? 0 : 1);
    expect(items.find((candidate) => candidate.id === "editor.find")?.disabledReason).toBeUndefined();
  });
  it("removes built-in AI actions when AI is unavailable", () => {
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
    const ids = createCommandItems(
      baseContext({ aiAvailable: false, editorActions }),
    ).map((item) => item.id);
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

  it.each(["/workspace/file.ts", "remote://machine/project/file.ts"])("admits both editor splits for the saved document at %s", (path) => {
    const calls: string[] = [];
    const editor = { id: 1, kind: "editor", path, spaceId: "s", title: "file" } as Tab;
    const items = createCommandItems(baseContext({ tabs: [editor],
      splitPaneRight: () => calls.push("right"), splitPaneDown: () => calls.push("down") }));
    for (const id of ["pane.splitRight", "pane.splitDown"]) {
      const item = items.find((candidate) => candidate.id === id);
      expect(item?.disabledReason).toBeUndefined();
      expect(item?.appliesTo).toEqual(["terminal", "editor"]);
      item?.run();
    }
    expect(calls).toEqual(["right", "down"]);
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

  it("keeps split disabled for an editor without a document path", () => {
    const editorTab = { ...terminalTab(1), kind: "editor" } as unknown as Tab;
    const item = createCommandItems(baseContext({ tabs: [editorTab] })).find(
      (i) => i.id === "pane.splitRight",
    );
    expect(item?.disabledReason).toBe("No terminal tab");
    expect(item?.appliesTo).toEqual(["terminal", "editor"]);
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

  it("keeps specific editor commands disabled without an active editor", () => {
    const items = createCommandItems(baseContext({ editorActions: null }));
    for (const id of ["editor.gotoLine", "editor.formatDocument", "editor.quickFix", "editor.signatureHelp", "editor.goToImplementation"]) {
      const item = items.find((candidate) => candidate.id === id);
      expect(item?.disabledReason).toBe("No active editor");
      expect(item?.appliesTo).toEqual(["editor"]);
    }
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

  it("enables navigation only when the corresponding history entry exists in an editor", () => {
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
    const withoutNav = createCommandItems(baseContext({ editorActions }));
    expect(withoutNav.find((item) => item.id === "editor.navigateBack")?.disabledReason).toBe("No previous editor location");
    expect(withoutNav.find((item) => item.id === "editor.navigateForward")?.disabledReason).toBe("No next editor location");

    const withNav = createCommandItems(
      baseContext({
        editorActions,
        canNavigateBack: true,
        canNavigateForward: true,
      }),
    ).map((i) => i.id);
    expect(withNav).toContain("editor.navigateBack");
    expect(withNav).toContain("editor.navigateForward");
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
