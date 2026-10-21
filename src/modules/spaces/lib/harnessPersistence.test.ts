import { asTabKey, asWorkspaceScopeId } from "@/modules/tabs/lib/tabIdentity";
import type { HarnessTab } from "@/modules/tabs/lib/useTabs";
import { describe, expect, it } from "vitest";
import { freshHarnessTab, hydrateTabs, serializeTabs } from "./serialize";
import { snapshotFromRuntime, repairSessionSnapshot } from "./sessionSnapshot";
import { asSlotId, asViewSpaceId } from "./spaceLayout";

const context = {
  id: "project",
  name: "Project",
  root: "C:/repo",
  env: { kind: "local" as const },
  createdAt: 1,
  updatedAt: 1,
};
function harness(cwd = "C:/repo"): HarnessTab {
  return {
    id: 15,
    kind: "harness",
    tabKey: asTabKey("tab-harness"),
    workspaceScopeId: asWorkspaceScopeId("project"),
    spaceId: "project",
    title: "Agent Development",
    cwd,
    sessionId: "saved-conversation",
  };
}

function parseTabs(tabs: unknown[]) {
  return repairSessionSnapshot({
    schemaVersion: 2,
    workspaceContexts: [context],
    activeWorkspaceContextId: context.id,
    tabs,
    activeTabKey: null,
    viewSpaces: [],
    stripEntries: [],
    activeStripItem: null,
  } as unknown as Parameters<typeof repairSessionSnapshot>[0]);
}

describe("Harness persistence", () => {
  it("roundtrips the Harness lock, color and validated icon instead of silently unlocking", () => {
    const original: HarnessTab = {
      ...harness(),
      color: "#123456",
      icon: "folder",
      locked: true,
    };
    const serialized = serializeTabs([original]);
    expect(serialized[0]).toMatchObject({
      color: original.color,
      icon: original.icon,
      locked: true,
    });
    const repaired = parseTabs(serialized);
    expect(repaired.tabs[0]).toMatchObject({
      color: original.color,
      icon: original.icon,
      locked: true,
    });
    expect(hydrateTabs(repaired.tabs, "project", () => 100)[0]).toMatchObject({
      color: original.color,
      icon: original.icon,
      locked: true,
    });
  });

  it("keeps only validated common metadata in the Harness parser whitelist", () => {
    const repaired = parseTabs([
      {
        kind: "harness",
        tabKey: "tab-harness",
        workspaceScopeId: "project",
        color: "#123456",
        icon: "folder",
        locked: true,
        token: "unapproved",
        nativeSessionId: 7,
        cwd: "C:/repo",
        sessionId: "conversation",
      },
    ]);
    expect(repaired.tabs).toEqual([
      {
        kind: "harness",
        tabKey: "tab-harness",
        workspaceScopeId: "project",
        color: "#123456",
        icon: "folder",
        locked: true,
        cwd: "C:/repo",
        sessionId: "conversation",
      },
    ]);
    const invalid = parseTabs([
      {
        kind: "harness",
        tabKey: "tab-invalid",
        workspaceScopeId: "project",
        color: { value: "invalid" },
        icon: "not-an-icon",
        locked: "true",
      },
    ]);
    expect(invalid.tabs).toEqual([
      { kind: "harness", tabKey: "tab-invalid", workspaceScopeId: "project" },
    ]);
  });

  it("preserves validated common metadata in direct legacy hydration", () => {
    const persisted = {
      kind: "harness" as const,
      tabKey: "tab-harness",
      workspaceScopeId: "project",
      color: "#123456",
      icon: "folder" as const,
      locked: true,
    };
    expect(hydrateTabs([persisted], "project", () => 100)[0]).toMatchObject(
      persisted,
    );
  });

  it.each(["", " \t\n", "s".repeat(257)])(
    "rejects malformed saved Session IDs before allocation %#",
    (sessionId) => {
      const persisted = {
        kind: "harness" as const,
        tabKey: "tab-invalid",
        workspaceScopeId: "project",
        sessionId,
      };
      expect(parseTabs([persisted]).tabs).toEqual([]);
      let allocations = 0;
      expect(hydrateTabs([persisted], "project", () => ++allocations)).toEqual(
        [],
      );
      expect(allocations).toBe(0);
    },
  );

  it.each([" sid ", "É/e\u0301/😀", "s".repeat(256)])(
    "keeps opaque Session IDs verbatim at the bounded edge %#",
    (sessionId) => {
      const original = { ...harness(), sessionId };
      const serialized = serializeTabs([original]);
      expect(parseTabs(serialized).tabs[0]).toMatchObject({ sessionId });
      expect(hydrateTabs(serialized, "project", () => 100)[0]).toMatchObject({
        sessionId,
      });
    },
  );

  it("retains legacy Harness entries with omitted optional fields", () => {
    const persisted = {
      kind: "harness" as const,
      tabKey: "tab-legacy",
      workspaceScopeId: "project",
    };
    const repaired = parseTabs([persisted]);
    const hydrated = hydrateTabs(repaired.tabs, "project", () => 100);
    expect(serializeTabs(hydrated)).toEqual([persisted]);
    expect(hydrated[0]).not.toHaveProperty("cwd");
    expect(hydrated[0]).not.toHaveProperty("sessionId");
  });

  it("preserves long UNC path metadata without introducing path authority or a new limit", () => {
    const cwd = `//synthetic/share/${"segment/".repeat(600)}`;
    const serialized = serializeTabs([harness(cwd)]);
    expect(parseTabs(serialized).tabs[0]).toMatchObject({ cwd });
    expect(hydrateTabs(serialized, "project", () => 100)[0]).toMatchObject({
      cwd,
    });
  });

  it("keeps the existing SSH transport exclusion for a forged Harness environment", () => {
    const persisted = {
      kind: "harness",
      tabKey: "tab-ssh",
      workspaceScopeId: "project",
      cwd: "remote://opaque/project",
      workspaceEnv: {
        kind: "ssh",
        sessionId: "native-session",
        root: "/project",
        connection: { host: "synthetic.invalid" },
      },
    };
    expect(parseTabs([persisted]).tabs).toEqual([]);
    expect(
      hydrateTabs(
        [persisted] as unknown as Parameters<typeof hydrateTabs>[0],
        "project",
        () => 100,
      ),
    ).toEqual([]);
  });
  it("creates a cold Harness with one runtime id and no PTY panes", () => {
    const allocId = () => 42;
    const tab = freshHarnessTab("project", "C:/repo", allocId);
    expect(tab).toMatchObject({
      id: 42,
      kind: "harness",
      spaceId: "project",
      cwd: "C:/repo",
      cold: true,
      title: "Agent Development",
    });
    expect(tab).not.toHaveProperty("paneTree");
    expect(tab).not.toHaveProperty("workspaceEnv");
  });

  it.each([
    "C:/repo",
    "//server/share/repo",
    "/home/me/repo",
    "remote://ssh-project/home/me/repo",
  ])(
    "roundtrips stable Harness identity at %s without native resources",
    (cwd) => {
      const original = harness(cwd);
      const serialized = serializeTabs([original]);
      expect(serialized).toEqual([
        {
          kind: "harness",
          tabKey: original.tabKey,
          workspaceScopeId: original.workspaceScopeId,
          cwd,
          sessionId: original.sessionId,
        },
      ]);
      let n = 100;
      const tabs = hydrateTabs(serialized, "project", () => ++n, {
        kind: "wsl",
        distro: "Unrelated",
      });
      expect(n).toBe(101);
      expect(tabs[0]).toMatchObject({ ...original, id: 101, cold: true });
      expect(serializeTabs(tabs)).toEqual(serialized);
      expect(tabs[0]).not.toHaveProperty("workspaceEnv");
    },
  );

  it("keeps Harness composite membership, active slot and strip selection through parser and restart", () => {
    const tab = harness();
    const slotId = asSlotId("slot-harness");
    const viewId = asViewSpaceId("view-project");
    const snapshot = snapshotFromRuntime({
      workspaceContexts: [context],
      activeWorkspaceContextId: "project",
      tabs: [tab],
      activeTabId: tab.id,
      viewSpaces: [
        {
          id: viewId,
          name: "Work",
          presentation: "composite",
          layout: { kind: "slot", id: slotId, memberTabKey: tab.tabKey },
          focusedSlotId: slotId,
          memberOrder: [tab.tabKey],
        },
      ],
      stripEntries: [{ kind: "space", spaceId: viewId }],
      activeStripItem: {
        kind: "space",
        spaceId: viewId,
        focusedSlotId: slotId,
      },
    });
    const repaired = repairSessionSnapshot(
      JSON.parse(JSON.stringify(snapshot)),
    );
    expect(repaired).toEqual(snapshot);
    expect(repaired.activeTabKey).toBe(tab.tabKey);
    expect(repaired.activeStripItem).toEqual({
      kind: "space",
      spaceId: viewId,
      focusedSlotId: slotId,
    });
    expect(hydrateTabs(repaired.tabs, "project", () => 100)[0]).toMatchObject({
      kind: "harness",
      tabKey: tab.tabKey,
    });
  });

  it("rejects corrupt Harness values and strips unapproved payload properties", () => {
    const base = {
      schemaVersion: 2 as const,
      workspaceContexts: [context],
      activeWorkspaceContextId: "project",
      tabs: [],
      activeTabKey: null,
      viewSpaces: [],
      stripEntries: [],
      activeStripItem: null,
    };
    const input = {
      ...base,
      tabs: [
        {
          kind: "harness",
          tabKey: "tab-valid",
          workspaceScopeId: "project",
          cwd: "C:/repo",
          sessionId: "conversation",
          token: "secret",
          nativeSessionId: 7,
        },
        {
          kind: "harness",
          tabKey: "tab-invalid",
          workspaceScopeId: "project",
          cwd: 7,
        },
        {
          kind: "harness",
          tabKey: "tab-invalid-session",
          workspaceScopeId: "project",
          sessionId: 7,
        },
      ],
    };
    const result = repairSessionSnapshot(
      input as unknown as Parameters<typeof repairSessionSnapshot>[0],
    );
    expect(result.tabs).toEqual([
      {
        kind: "harness",
        tabKey: "tab-valid",
        workspaceScopeId: "project",
        cwd: "C:/repo",
        sessionId: "conversation",
      },
    ]);
  });
});
