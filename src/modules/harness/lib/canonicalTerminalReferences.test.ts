import { expect, it } from "vitest";
import {
  newTab,
  newTerminalFile,
  newTerminalWorkspaceTab,
  newEditorPane,
  newFileTab,
  splitPane,
} from "@/modules/harness/lib/layout";
import {
  createProjectTerminal,
  addTerminalToDock,
} from "@/modules/harness/lib/projectTerminal";
import { asTabKey } from "@/modules/tabs/lib/tabIdentity";
import {
  canonicalPruneSelection,
  pruneCanonicalTerminalDocks,
  pruneCanonicalTerminalTabs,
} from "@/modules/harness/lib/canonicalTerminalReferences";

const reference = {
  tabKey: asTabKey("tab-shell"),
  projectCwd: "remote://voktty-ssh-build/srv/app",
};
const file = {
  ...newTerminalFile(reference.projectCwd),
  canonicalTerminal: reference,
};
const closed = new Map([[file.id, reference]]);

it("removes a terminal-only tab without allocating a replacement session", () => {
  expect(
    pruneCanonicalTerminalTabs([newTerminalWorkspaceTab(file)], closed),
  ).toEqual([]);
});
it("collapses the emptied terminal pane while preserving physical files and conversation leaves", () => {
  const pane = newEditorPane(newFileTab("/srv/app/unsaved.txt", "/srv/app"));
  const original = newTerminalWorkspaceTab(file);
  const layout = splitPane(
    splitPane(original.layout, original.focusedId, "right", pane.id),
    pane.id,
    "down",
    "chat",
  );
  const mixed = { ...original, layout, editorPanes: [pane], diffOpen: true };
  const [result] = pruneCanonicalTerminalTabs([mixed], closed);
  expect(result.terminalPanes).toEqual([]);
  expect(result.editorPanes[0]).toBe(pane);
  expect(result.focusedId).toBe(pane.id);
  expect(result.diffOpen).toBe(true);
  expect(result.layout).toMatchObject({
    type: "split",
    children: [
      { type: "leaf", id: pane.id },
      { type: "leaf", id: "chat" },
    ],
  });
});
it("preserves another focused pane when a background terminal disappears", () => {
  const original = newTerminalWorkspaceTab(file);
  const tab = {
    ...original,
    focusedId: "chat",
    layout: splitPane(original.layout, original.focusedId, "right", "chat"),
  };
  expect(pruneCanonicalTerminalTabs([tab], closed)[0].focusedId).toBe("chat");
});
it("selects the nearest remaining file and preserves the pane when its active reference closes", () => {
  const tab = newTerminalWorkspaceTab(file);
  const before = newTerminalFile("/srv/legacy");
  const after = {
    ...newTerminalFile(reference.projectCwd),
    canonicalTerminal: { ...reference, tabKey: asTabKey("tab-other") },
  };
  const pane = { ...tab.terminalPanes[0], files: [before, file, after] };
  const [next] = pruneCanonicalTerminalTabs(
    [{ ...tab, terminalPanes: [pane] }],
    closed,
  );
  expect(next.terminalPanes[0]).toEqual({
    ...pane,
    files: [before, after],
    activeFileId: after.id,
  });
  expect(next.layout).toBe(tab.layout);
});
it("does not delete a replacement reference with the same file id", () => {
  const original = newTerminalWorkspaceTab(file);
  for (const canonicalTerminal of [
    { ...reference, projectCwd: "/srv/other" },
    { ...reference, tabKey: asTabKey("tab-new") },
  ]) {
    const tabs = [
      {
        ...original,
        terminalPanes: [
          {
            ...original.terminalPanes[0],
            files: [{ ...file, canonicalTerminal }],
          },
        ],
      },
    ];
    expect(pruneCanonicalTerminalTabs(tabs, closed)).toBe(tabs);
  }
});
it("prunes all observed aliases in one pass and retains unrelated tab objects", () => {
  const alias = { ...file, id: "alias" };
  const chat = newTab("chat");
  const tabs = [
    newTerminalWorkspaceTab(file),
    chat,
    newTerminalWorkspaceTab(alias),
  ];
  expect(
    pruneCanonicalTerminalTabs(
      tabs,
      new Map([
        [file.id, reference],
        [alias.id, reference],
      ]),
    ),
  ).toEqual([chat]);
});
it("preserves unseen, legacy and physical files even when their ids are listed", () => {
  const legacy = newTerminalFile("C:/Work/App");
  const physical = newFileTab("C:/Work/App/file.txt", "C:/Work/App");
  const tabs = [
    newTerminalWorkspaceTab(legacy),
    {
      ...newTab("pane"),
      editorPanes: [
        { id: "pane", files: [physical], activeFileId: physical.id },
      ],
    },
  ];
  expect(
    pruneCanonicalTerminalTabs(
      tabs,
      new Map([
        [legacy.id, reference],
        [physical.id, reference],
      ]),
    ),
  ).toBe(tabs);
});
it("prunes dock aliases without changing side, visibility or surviving legacy terminals", () => {
  const legacy = newTerminalFile("/srv/legacy");
  const dock = {
    ...addTerminalToDock(
      createProjectTerminal(reference.projectCwd, file, "left"),
      legacy,
    ),
    open: false,
  };
  const [next] = pruneCanonicalTerminalDocks([dock], closed);
  expect(next).toEqual({ ...dock, pane: { ...dock.pane, files: [legacy] } });
  expect(
    pruneCanonicalTerminalDocks(
      [createProjectTerminal(reference.projectCwd, file)],
      closed,
    ),
  ).toEqual([]);
});
it("retains identities for an empty or irrelevant closure set", () => {
  const tabs = [newTab("chat")];
  const docks = [createProjectTerminal(reference.projectCwd, file)];
  expect(pruneCanonicalTerminalTabs(tabs, closed)).toBe(tabs);
  expect(pruneCanonicalTerminalTabs(tabs, new Map())).toBe(tabs);
  expect(pruneCanonicalTerminalDocks(docks, new Map())).toBe(docks);
});
it("keeps current selection, chooses a surviving neighbor and supports an empty view", () => {
  const tabs = [newTab("one"), newTab("two"), newTab("three")];
  expect(canonicalPruneSelection(tabs, [tabs[0], tabs[2]], tabs[0].id)).toBe(
    tabs[0].id,
  );
  expect(canonicalPruneSelection(tabs, [tabs[0], tabs[2]], tabs[1].id)).toBe(
    tabs[2].id,
  );
  expect(canonicalPruneSelection(tabs, [tabs[0]], tabs[2].id)).toBe(tabs[0].id);
  expect(canonicalPruneSelection(tabs, [], tabs[1].id)).toBe("");
});
