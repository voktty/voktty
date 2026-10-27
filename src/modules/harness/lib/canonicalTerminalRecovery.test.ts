import { assert, expect, it } from "vitest";
import { asTabKey } from "@/modules/tabs/lib/tabIdentity";
import {
  newTerminalFile,
  newTerminalWorkspaceTab,
} from "@/modules/harness/lib/layout";
import { createProjectTerminal } from "@/modules/harness/lib/projectTerminal";
import { normalizeProjectPath } from "@/modules/harness/lib/recents";
import {
  terminalRecoveryTarget,
  replaceRecoveredTerminalTabs,
  replaceRecoveredTerminalDocks,
} from "@/modules/harness/lib/canonicalTerminalRecovery";

it.each([
  "/srv/app",
  "C:/Work/App",
  "//server/share/app",
  "remote://voktty-ssh-build/srv/app",
])(
  "replaces only the selected missing dock reference in %s without losing its metadata or siblings",
  (projectCwd) => {
    const file = {
      ...newTerminalFile(projectCwd, "Build"),
      canonicalTerminal: { tabKey: asTabKey("missing"), projectCwd },
    };
    const dock = createProjectTerminal(projectCwd, file);
    const sibling = createProjectTerminal("/other", newTerminalFile("/other"));
    const state = {
      projectCwd,
      activeTabId: "",
      tabs: [],
      docks: [dock, sibling],
    };
    const target = terminalRecoveryTarget(
      state,
      file.id,
      `dock:${normalizeProjectPath(projectCwd)}`,
    );
    assert(target);
    const replacement = {
      ...file,
      canonicalTerminal: { tabKey: asTabKey("successor"), projectCwd },
    };
    const next = replaceRecoveredTerminalDocks(
      state.docks,
      target,
      replacement,
    );
    expect(next[0]).toEqual({
      ...dock,
      pane: { ...dock.pane, files: [replacement] },
    });
    expect(next[1]).toBe(sibling);
    expect(dock.pane.files).toEqual([file]);
    expect(replaceRecoveredTerminalDocks(next, target, replacement)).toBe(next);
  },
);
it("preserves the conversation layout and refuses to replace a changed file with the same id", () => {
  const projectCwd = "/srv/app";
  const file = {
    ...newTerminalFile(projectCwd),
    canonicalTerminal: { tabKey: asTabKey("missing"), projectCwd },
  };
  const tab = newTerminalWorkspaceTab(file);
  const state = { projectCwd, activeTabId: tab.id, tabs: [tab], docks: [] };
  const target = terminalRecoveryTarget(
    state,
    file.id,
    `pane:${tab.filePanes[0].id}`,
  );
  assert(target);
  const replacement = {
    ...file,
    canonicalTerminal: { tabKey: asTabKey("successor"), projectCwd },
  };
  const next = replaceRecoveredTerminalTabs(state.tabs, target, replacement);
  expect(next[0].layout).toBe(tab.layout);
  expect(next[0].focusedId).toBe(tab.focusedId);
  expect(next[0].filePanes[0].files).toEqual([replacement]);
  const changed = [
    {
      ...tab,
      filePanes: [
        { ...tab.filePanes[0], files: [{ ...file, cwd: "/another" }] },
      ],
    },
  ];
  expect(replaceRecoveredTerminalTabs(changed, target, replacement)).toBe(
    changed,
  );
});
it.each(["hidden", "unselected", "wrong project", "wrong slot", "legacy"])(
  "refuses a %s recovery target",
  (reason) => {
    const projectCwd = "/srv/app";
    const file = {
      ...newTerminalFile(projectCwd),
      canonicalTerminal: { tabKey: asTabKey("missing"), projectCwd },
    };
    const dock = createProjectTerminal(projectCwd, file);
    const state = { projectCwd, activeTabId: "", tabs: [], docks: [dock] };
    if (reason === "hidden") dock.open = false;
    if (reason === "unselected") dock.pane.activeFileId = "another";
    if (reason === "wrong project") state.projectCwd = "/other";
    if (reason === "legacy")
      delete (file as { canonicalTerminal?: unknown }).canonicalTerminal;
    expect(
      terminalRecoveryTarget(
        state,
        file.id,
        reason === "wrong slot" ? "pane:unknown" : `dock:${projectCwd}`,
      ),
    ).toBeUndefined();
  },
);
