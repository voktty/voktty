import { assert, describe, expect, it } from "vitest";
import { asTabKey } from "@/modules/tabs/lib/tabIdentity";
import {
  newEditorPane,
  newTab,
  newTerminalFile,
} from "@/modules/harness/lib/layout";
import { createProjectTerminal } from "@/modules/harness/lib/projectTerminal";
import {
  collectWorkspaceSnapshot,
  hydrateWorkspaceSnapshot,
  parseWorkspaceSnapshot,
} from "@/modules/harness/lib/workspaceSnapshot";

function saved(projectCwd = "/srv/app") {
  const file = {
    ...newTerminalFile(`${projectCwd}/src`, "build"),
    canonicalTerminal: { tabKey: asTabKey("tab-shell"), projectCwd },
    foreground: "vite",
  };
  const pane = newEditorPane(file);
  const tab = { ...newTab(pane.id), terminalPanes: [pane] };
  return collectWorkspaceSnapshot([tab], [], tab.id, projectCwd, new Map(), [
    createProjectTerminal(projectCwd, file),
  ]);
}

describe("canonical terminal snapshot references", () => {
  it.each([
    "/srv/app",
    "C:/work/app",
    "//server/share/app",
    "remote://voktty-ssh-dev/srv/app",
  ])(
    "round-trips the stable reference for %s without runtime state",
    (projectCwd) => {
      const snapshot = saved(projectCwd);
      const restored = hydrateWorkspaceSnapshot(
        JSON.parse(JSON.stringify(snapshot)),
        new Map(),
      );
      const expected = { tabKey: "tab-shell", projectCwd };
      const file = restored?.tabs[0]?.terminalPanes[0]?.files[0];
      expect(file?.canonicalTerminal).toEqual(expected);
      expect(file?.cwd).toBe(`${projectCwd}/src`);
      expect(file?.path).toBe("build");
      expect(file?.foreground).toBeUndefined();
      expect(
        restored?.projectTerminals?.[0]?.pane.files[0]?.canonicalTerminal,
      ).toEqual(expected);
      expect(restored?.sessions).toEqual([]);
      assert(restored);
      expect(
        collectWorkspaceSnapshot(
          restored.tabs,
          [],
          restored.activeTabId,
          projectCwd,
          new Map(),
          restored.projectTerminals,
        ),
      ).toEqual(snapshot);
    },
  );

  it("keeps legacy terminals available for explicit migration", () => {
    const snapshot = saved();
    delete snapshot.tabs[0].terminalPanes[0].files[0].canonicalTerminal;
    const parsed = parseWorkspaceSnapshot(snapshot);
    expect(parsed?.tabs[0]?.terminalPanes[0]?.files[0]?.terminal).toBe(true);
    expect(
      parsed?.tabs[0]?.terminalPanes[0]?.files[0]?.canonicalTerminal,
    ).toBeUndefined();
  });

  it.each([
    null,
    {},
    { tabKey: 42, projectCwd: "/srv/app" },
    { tabKey: "native-42", projectCwd: "/srv/app" },
    { tabKey: `tab-${"a".repeat(256)}`, projectCwd: "/srv/app" },
    { tabKey: "tab-a\0", projectCwd: "/srv/app" },
    { tabKey: "tab-shell", projectCwd: "relative" },
    { tabKey: "tab-shell", projectCwd: "remote://user:secret@host/srv/app" },
  ])(
    "rejects malformed references instead of reopening a legacy PTY: %j",
    (reference) => {
      const snapshot = saved();
      const invalid = JSON.parse(JSON.stringify(snapshot));
      invalid.tabs[0].terminalPanes[0].files[0].canonicalTerminal = reference;
      invalid.projectTerminals[0].pane.files[0].canonicalTerminal = reference;
      const valid = newTab("conversation");
      invalid.tabs.push(valid);
      const parsed = parseWorkspaceSnapshot(invalid);
      expect(parsed?.tabs.map((tab) => tab.id)).toEqual([valid.id]);
      expect(parsed?.projectTerminals).toEqual([]);
    },
  );

  it.each([
    { terminal: false },
    { review: true },
    { changes: true },
    { plan: { sessionId: "s", blockId: "b", title: "plan" } },
    { releaseNotes: { version: "1" } },
    { sessionChanges: { sessionId: "s" } },
  ])("rejects conflicting surface roles: %j", (extra) => {
    const snapshot = saved();
    Object.assign(snapshot.tabs[0].terminalPanes[0].files[0], extra);
    expect(parseWorkspaceSnapshot(snapshot)).toBeNull();
  });

  it("copies only stable identity and project metadata from a reference", () => {
    const snapshot = saved();
    const reference =
      snapshot.tabs[0].terminalPanes[0].files[0].canonicalTerminal;
    assert(reference);
    Object.assign(reference, {
      sessionId: "native-secret",
      leafId: 42,
      password: "private",
      factory: "unknown",
    });
    const parsed = parseWorkspaceSnapshot(snapshot);
    expect(
      parsed?.tabs[0]?.terminalPanes[0]?.files[0]?.canonicalTerminal,
    ).toEqual({
      tabKey: "tab-shell",
      projectCwd: "/srv/app",
    });
  });
});
