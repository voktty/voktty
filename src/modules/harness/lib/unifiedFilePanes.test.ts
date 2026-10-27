import { describe, expect, it } from "vitest";
import { asTabKey } from "@/modules/tabs/lib/tabIdentity";
import {
  focusedFileTab,
  layoutLeaves,
  newFileTab,
  newTab,
  newTerminalFile,
  openEditorTab,
  openTerminalTab,
  surfacePanes,
  withSurfacePanes,
} from "@/modules/harness/lib/layout";
import { collectWorkspaceSnapshot, hydrateWorkspaceSnapshot, parseWorkspaceSnapshot } from "@/modules/harness/lib/workspaceSnapshot";

const document = { id: "document", path: "/project/file.ts", cwd: "/project" };
const terminal = {
  id: "terminal", path: "Project shell", cwd: "/project", terminal: true,
  canonicalTerminal: { tabKey: asTabKey("tab-shell"), projectCwd: "/project" },
};
const editorPane = { id: "editor-pane", files: [document], activeFileId: document.id };
const terminalPane = { id: "terminal-pane", files: [terminal], activeFileId: terminal.id };
const layout = { type: "split", id: "split", dir: "right", children: [
  { type: "leaf", id: editorPane.id }, { type: "leaf", id: terminalPane.id },
], sizes: [0.3, 0.7] };
const envelope = (tab: object) => ({
  tabs: [{ kind: "session", id: "workbench", layout, focusedId: terminalPane.id, ...tab }],
  sessions: [], activeTabId: "workbench", projectCwd: "/project", projectTerminals: [],
});

describe("unified file panes", () => {
  it("rejects malformed or ambiguous unified collections instead of dropping saved panes", () => {
    for (const panes of [
      { filePanes: null },
      { filePanes: {}, terminalPanes: [terminalPane] },
      { filePanes: [editorPane], terminalPanes: [terminalPane] },
      { filePanes: [], editorPanes: [editorPane] },
    ]) {
      expect(parseWorkspaceSnapshot(envelope(panes))).toBeNull();
    }
  });

  it("reads both legacy collections without losing layout, focus or stable terminal identity", () => {
    const parsed = parseWorkspaceSnapshot(envelope({ editorPanes: [editorPane], terminalPanes: [terminalPane] }));
    expect(parsed?.tabs[0]).toMatchObject({ layout, focusedId: terminalPane.id, filePanes: [editorPane, terminalPane] });
    expect(parsed?.tabs[0]).not.toHaveProperty("editorPanes");
    expect(parsed?.tabs[0]).not.toHaveProperty("terminalPanes");
    const restored = parsed && hydrateWorkspaceSnapshot(parsed, new Map());
    expect(restored?.sessions).toEqual([]);
    expect(restored?.tabs[0]).toEqual(parsed?.tabs[0]);
  });

  it("round-trips the unified collection without synthesizing conversation leaves", () => {
    const parsed = parseWorkspaceSnapshot(envelope({ filePanes: [editorPane, terminalPane] }));
    expect(parsed?.tabs[0]).toHaveProperty("filePanes", [editorPane, terminalPane]);
    if (!parsed) throw new Error("Missing workspace");
    const saved = collectWorkspaceSnapshot(parsed.tabs, [], parsed.activeTabId, parsed.projectCwd, new Map());
    expect(JSON.parse(JSON.stringify(saved)).tabs[0]).toHaveProperty("filePanes", [editorPane, terminalPane]);
    expect(saved.tabs[0]).not.toHaveProperty("terminalPanes");
    expect(saved.tabs[0]).not.toHaveProperty("editorPanes");
    expect(hydrateWorkspaceSnapshot(saved, new Map())?.sessions).toEqual([]);
  });

  it("creates terminal and document strips in one collection while preserving sibling panes", () => {
    const first = openEditorTab(newTab("conversation"), newFileTab(document.path, document.cwd));
    const editor = surfacePanes(first, "editor")[0];
    const shell = newTerminalFile("/project");
    const withShell = openTerminalTab(first, shell);
    const next = openEditorTab(withShell, newFileTab("/project/second.ts", "/project"));
    const terminals = surfacePanes(next, "terminal");
    const editors = surfacePanes(next, "editor");
    expect(next).toHaveProperty("filePanes", [...editors, ...terminals]);
    expect(next).not.toHaveProperty("terminalPanes");
    expect(editors[0].id).toBe(editor.id);
    expect(editors[0].files.map((file) => file.path)).toEqual([document.path, "/project/second.ts"]);
    expect(terminals[0].files).toEqual([shell]);
    const selected = withSurfacePanes(next, "terminal", terminals.map((pane) => ({ ...pane, activeFileId: shell.id })));
    expect(surfacePanes(selected, "editor")[0]).toBe(editors[0]);
    expect(layoutLeaves(selected.layout)).toHaveLength(3);
    expect(focusedFileTab(selected)?.path).toBe("/project/second.ts");
  });

  it("removes only the selected surface collection when it becomes empty", () => {
    const first = openEditorTab(newTab("conversation"), newFileTab(document.path, document.cwd));
    const both = openTerminalTab(first, newTerminalFile("/project"));
    const editor = surfacePanes(both, "editor")[0];
    const next = withSurfacePanes(both, "terminal", []);
    expect(next).toHaveProperty("filePanes", [editor]);
    expect(surfacePanes(next, "editor")[0]).toBe(editor);
    expect(surfacePanes(next, "terminal")).toEqual([]);
  });
});
