import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  extractCodeToExecute,
  findTargetTerminalTab,
  sendActiveEditorCodeToTerminal,
} from "./terminalExecution";
import { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { Tab } from "@/modules/tabs/lib/useTabs";
import { createTabIdentity } from "@/modules/tabs/lib/tabIdentity";

const terminalMocks = vi.hoisted(() => ({
  getActiveTerminalLeafId: vi.fn<() => number | null>(),
  getAnyLiveTerminalLeafId: vi.fn<() => number | null>(),
  submitToLeaf: vi.fn(),
}));

vi.mock("@/modules/terminal/lib/useTerminalSession", () => terminalMocks);
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

describe("terminalExecution", () => {
  beforeEach(() => {
    terminalMocks.getActiveTerminalLeafId.mockReset();
    terminalMocks.getAnyLiveTerminalLeafId.mockReset();
    terminalMocks.submitToLeaf.mockReset();
  });

  it("finds the terminal tab matching current space", () => {
    const tabs: Tab[] = [
      {
        id: 1,
        ...createTabIdentity("sp1", () => "execution-editor"),
        kind: "editor",
        spaceId: "sp1",
        title: "file.ts",
        path: "/file.ts",
        dirty: false,
        preview: false,
      },
      {
        id: 2,
        ...createTabIdentity("sp2", () => "execution-terminal-2"),
        kind: "terminal",
        spaceId: "sp2",
        title: "term-2",
        paneTree: { kind: "leaf", id: 20 },
        activeLeafId: 20,
      },
      {
        id: 3,
        ...createTabIdentity("sp1", () => "execution-terminal-1"),
        kind: "terminal",
        spaceId: "sp1",
        title: "term-1",
        paneTree: { kind: "leaf", id: 10 },
        activeLeafId: 10,
      },
    ];

    const found = findTargetTerminalTab(tabs, "sp1");
    expect(found).toEqual({ activeLeafId: 10 });
  });

  it("extracts selected text if selection exists", () => {
    const state = EditorState.create({
      doc: "const a = 10;\nconst b = 20;\nconst c = 30;",
      selection: { anchor: 0, head: 13 },
    });
    const fakeView = { state } as unknown as EditorView;

    const result = extractCodeToExecute(fakeView);
    expect(result).toEqual({ text: "const a = 10;" });
  });

  it("extracts current line when cursor has no selection", () => {
    const state = EditorState.create({
      doc: "first line\nsecond line\nthird line",
      selection: { anchor: 14 }, // on "second line"
    });
    const fakeView = { state } as unknown as EditorView;

    const result = extractCodeToExecute(fakeView);
    expect(result?.text).toBe("second line");
    expect(result?.nextLineAnchor).toBe(23); // start of "third line"
  });

  it("sends the active editor selection to an available terminal", () => {
    terminalMocks.getActiveTerminalLeafId.mockReturnValue(42);
    terminalMocks.getAnyLiveTerminalLeafId.mockReturnValue(42);
    const state = EditorState.create({
      doc: "echo selected\necho ignored",
      selection: { anchor: 0, head: 13 },
    });
    const fakeView = { state } as unknown as EditorView;

    expect(sendActiveEditorCodeToTerminal(fakeView)).toBe(true);
    expect(terminalMocks.submitToLeaf).toHaveBeenCalledWith(
      42,
      "echo selected",
    );
  });

  it("does not claim success when no terminal is available", () => {
    terminalMocks.getActiveTerminalLeafId.mockReturnValue(null);
    terminalMocks.getAnyLiveTerminalLeafId.mockReturnValue(null);
    const state = EditorState.create({ doc: "echo missing" });
    const fakeView = { state } as unknown as EditorView;

    expect(sendActiveEditorCodeToTerminal(fakeView)).toBe(false);
    expect(terminalMocks.submitToLeaf).not.toHaveBeenCalled();
  });
});
