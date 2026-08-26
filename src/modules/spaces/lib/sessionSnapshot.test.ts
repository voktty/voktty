import { asTabKey } from "@/modules/tabs/lib/tabIdentity";
import { describe, expect, it } from "vitest";
import {
  createSessionEnvelope,
  migrateLegacySpaces,
  repairSessionSnapshot,
  selectRestorableSession,
  SESSION_SCHEMA_VERSION,
  type LegacySpacesStore,
  type SessionSnapshot,
} from "./sessionSnapshot";

const legacySpace = {
  id: "legacy",
  name: "Legacy",
  root: "/repo",
  env: { kind: "local" as const },
  createdAt: 1,
  updatedAt: 2,
};

function editor(path: string, tabKey: string) {
  return {
    kind: "editor" as const,
    path,
    tabKey,
    workspaceScopeId: "legacy",
  };
}

describe("session snapshot v2", () => {
  it("produces a valid empty snapshot for an empty legacy store", () => {
    expect(
      migrateLegacySpaces({ spaces: [], activeId: null, states: new Map() }),
    ).toMatchObject({
      workspaceContexts: [],
      tabs: [],
      viewSpaces: [],
      stripEntries: [],
      activeTabKey: null,
    });
  });

  it("migrates a legacy space with more than four tabs without hiding overflow", () => {
    const legacy: LegacySpacesStore = {
      spaces: [legacySpace],
      activeId: "legacy",
      states: new Map([
        [
          "legacy",
          {
            tabs: Array.from({ length: 6 }, (_, index) =>
              editor(`/repo/${index}.ts`, `tab-${index}`),
            ),
            activeTabIndex: 4,
          },
        ],
      ]),
    };

    const migrated = migrateLegacySpaces(legacy);
    const visual = migrated.viewSpaces[0];

    expect(visual.memberOrder).toHaveLength(4);
    expect(visual.memberOrder).toContain(asTabKey("tab-4"));
    expect(migrated.stripEntries).toHaveLength(3);
    expect(
      migrated.stripEntries.filter((entry) => entry.kind === "standalone"),
    ).toHaveLength(2);
    expect(new Set(migrated.tabs.map((tab) => tab.tabKey)).size).toBe(6);
  });

  it("repairs corrupt layouts and preserves empty slots for ephemeral members", () => {
    const snapshot: SessionSnapshot = {
      schemaVersion: SESSION_SCHEMA_VERSION,
      workspaceContexts: [legacySpace],
      activeWorkspaceContextId: "legacy",
      tabs: [editor("/repo/kept.ts", "tab-kept")],
      activeTabKey: asTabKey("tab-kept"),
      viewSpaces: [
        {
          id: "view-legacy" as never,
          name: "Legacy",
          presentation: "composite",
          memberOrder: [asTabKey("tab-kept"), asTabKey("tab-ephemeral")],
          focusedSlotId: "slot-ephemeral" as never,
          layout: {
            kind: "split",
            id: "split-root",
            direction: "row",
            ratio: Number.NaN,
            first: {
              kind: "slot",
              id: "slot-kept" as never,
              memberTabKey: asTabKey("tab-kept"),
            },
            second: {
              kind: "slot",
              id: "slot-ephemeral" as never,
              memberTabKey: asTabKey("tab-ephemeral"),
            },
          },
        },
      ],
      stripEntries: [{ kind: "space", spaceId: "view-legacy" as never }],
      activeStripItem: {
        kind: "space",
        spaceId: "view-legacy" as never,
        focusedSlotId: "slot-ephemeral" as never,
      },
    };

    const repaired = repairSessionSnapshot(snapshot);
    const visual = repaired.viewSpaces[0];

    expect(visual.layout).toMatchObject({ kind: "split", ratio: 0.5 });
    expect(visual.memberOrder).toEqual([asTabKey("tab-kept")]);
    expect(JSON.stringify(visual.layout)).not.toContain("tab-ephemeral");
  });

  it("separates working checkpoints from the last clean session", () => {
    const snapshot = migrateLegacySpaces({
      spaces: [legacySpace],
      activeId: "legacy",
      states: new Map(),
    });
    const working = createSessionEnvelope(snapshot, {
      ownerInstanceId: "instance-a",
      generation: 7,
      savedAt: 100,
      closedAt: null,
    });
    const clean = createSessionEnvelope(snapshot, {
      ownerInstanceId: "instance-a",
      generation: 8,
      savedAt: 110,
      closedAt: 111,
    });

    expect(working.closedAt).toBeNull();
    expect(clean.closedAt).toBe(111);
    expect(clean.generation).toBeGreaterThan(working.generation);
    expect(selectRestorableSession(clean, working)?.generation).toBe(8);
    expect(selectRestorableSession(null, working)).toBeNull();
  });

  it("rejects a corrupt v2 envelope instead of restoring its checkpoint", () => {
    expect(
      selectRestorableSession(
        {
          schemaVersion: SESSION_SCHEMA_VERSION,
          ownerInstanceId: "instance-a",
          generation: "invalid",
          savedAt: 1,
          closedAt: 2,
          snapshot: {},
        },
        null,
      ),
    ).toBeNull();
  });

  it("migrates legacy input idempotently even when tab identities are missing", () => {
    const legacy: LegacySpacesStore = {
      spaces: [legacySpace],
      activeId: "legacy",
      states: new Map([
        [
          "legacy",
          { tabs: [{ kind: "editor", path: "/repo/a.ts" }], activeTabIndex: 0 },
        ],
      ]),
    };

    expect(migrateLegacySpaces(legacy)).toEqual(migrateLegacySpaces(legacy));
  });

  it("round-trips ratios, empty slots, focus and strip order", () => {
    const snapshot = repairSessionSnapshot({
      schemaVersion: SESSION_SCHEMA_VERSION,
      workspaceContexts: [legacySpace],
      activeWorkspaceContextId: "legacy",
      tabs: [editor("/repo/a.ts", "tab-a")],
      activeTabKey: asTabKey("tab-a"),
      viewSpaces: [
        {
          id: "view-legacy" as never,
          name: "Legacy",
          presentation: "composite",
          memberOrder: [asTabKey("tab-a")],
          focusedSlotId: "slot-empty" as never,
          layout: {
            kind: "split",
            id: "split-root",
            direction: "column",
            ratio: 0.7,
            first: {
              kind: "slot",
              id: "slot-a" as never,
              memberTabKey: asTabKey("tab-a"),
            },
            second: {
              kind: "slot",
              id: "slot-empty" as never,
              memberTabKey: null,
            },
          },
        },
      ],
      stripEntries: [{ kind: "space", spaceId: "view-legacy" as never }],
      activeStripItem: {
        kind: "space",
        spaceId: "view-legacy" as never,
        focusedSlotId: "slot-empty" as never,
      },
    });

    const restored = repairSessionSnapshot(
      JSON.parse(JSON.stringify(snapshot)) as SessionSnapshot,
    );

    expect(restored.viewSpaces[0].layout).toEqual(
      snapshot.viewSpaces[0].layout,
    );
    expect(restored.viewSpaces[0].focusedSlotId).toBe("slot-empty");
    expect(restored.stripEntries).toEqual(snapshot.stripEntries);
  });
});
