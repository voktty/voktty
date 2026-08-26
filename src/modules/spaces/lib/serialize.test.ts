import type { Tab } from "@/modules/tabs/lib/useTabs";
import {
  asTabKey,
  asWorkspaceScopeId,
} from "@/modules/tabs/lib/tabIdentity";
import type { PaneNode } from "@/modules/terminal/lib/panes";
import { describe, expect, it } from "vitest";
import { hydrateTabs, type SerializedTab, serializeTabs } from "./serialize";

function counter(start = 100): () => number {
  let n = start;
  return () => n++;
}

function leafIdsOf(node: PaneNode): number[] {
  return node.kind === "leaf" ? [node.id] : node.children.flatMap(leafIdsOf);
}

function term(over: Partial<Extract<Tab, { kind: "terminal" }>>): Tab {
  return {
    id: 1,
    tabKey: asTabKey(`tab-fixture-${over.id ?? 1}`),
    workspaceScopeId: asWorkspaceScopeId("s1"),
    kind: "terminal",
    spaceId: "s1",
    title: "shell",
    paneTree: { kind: "leaf", id: 2, cwd: "/a" },
    activeLeafId: 2,
    ...over,
  } as Tab;
}

describe("serializeTabs", () => {
  it("preserves the dev-server link on preview tabs", () => {
    const preview: Tab = {
      id: 8,
      tabKey: asTabKey("tab-preview"),
      workspaceScopeId: asWorkspaceScopeId("s1"),
      kind: "preview",
      spaceId: "s1",
      title: "localhost:5173",
      url: "http://localhost:5173",
      devServerScope: "local\0c:/repo\0http://localhost:5173",
    };

    const [serialized] = serializeTabs([preview]);
    const [restored] = hydrateTabs([serialized], "s1", counter());

    expect(serialized).toMatchObject({
      kind: "preview",
      devServerScope: preview.devServerScope,
    });
    expect(restored).toMatchObject({
      kind: "preview",
      devServerScope: preview.devServerScope,
    });
  });

  it("persists stable tab and workspace identities", () => {
    const original = term({ id: 41 });

    const [serialized] = serializeTabs([original]);
    const [restored] = hydrateTabs([serialized], "legacy-space", counter());

    expect(serialized).toMatchObject({
      tabKey: original.tabKey,
      workspaceScopeId: original.workspaceScopeId,
    });
    expect(restored.id).not.toBe(original.id);
    expect(restored.tabKey).toBe(original.tabKey);
    expect(restored.workspaceScopeId).toBe(original.workspaceScopeId);
  });

  it("drops private terminals and transient kinds", () => {
    const tabs: Tab[] = [
      term({ id: 1 }),
      term({ id: 3, private: true }),
      {
        id: 5,
        tabKey: asTabKey("tab-fixture-5"),
        workspaceScopeId: asWorkspaceScopeId("s1"),
        kind: "git-diff",
        spaceId: "s1",
        title: "d",
        path: "/a/x",
        repoRoot: "/a",
        mode: "+",
        originalPath: null,
        preview: true,
      },
      {
        id: 7,
        tabKey: asTabKey("tab-fixture-7"),
        workspaceScopeId: asWorkspaceScopeId("s1"),
        kind: "editor",
        spaceId: "s1",
        title: "x",
        path: "/a/x.ts",
        dirty: false,
        preview: false,
      },
    ];
    const out = serializeTabs(tabs);
    expect(out.map((t) => t.kind)).toEqual(["terminal", "editor"]);
  });

  it("never persists shared terminal connection metadata", () => {
    const shared = term({
      collaboration: { mode: "guest" },
    });

    expect(serializeTabs([shared])).toEqual([]);
  });

  it("marks the active leaf in a split tree", () => {
    const tree: PaneNode = {
      kind: "split",
      id: 10,
      dir: "row",
      children: [
        { kind: "leaf", id: 11, cwd: "/a" },
        { kind: "leaf", id: 12, cwd: "/b" },
      ],
    };
    const [s] = serializeTabs([term({ paneTree: tree, activeLeafId: 12 })]);
    const node = s as Extract<SerializedTab, { kind: "terminal" }>;
    expect(node.tree.kind).toBe("split");
    if (node.tree.kind === "split") {
      expect(node.tree.children[1]).toMatchObject({ cwd: "/b", active: true });
      expect(node.tree.children[0]).not.toHaveProperty("active");
    }
  });

  it("serializes and restores an eight-pane terminal layout", () => {
    const tree: PaneNode = {
      kind: "split",
      id: 20,
      dir: "row",
      children: Array.from({ length: 8 }, (_, index) => ({
        kind: "leaf" as const,
        id: 21 + index,
        cwd: `/pane-${index + 1}`,
      })),
    };
    const [serialized] = serializeTabs([
      term({ paneTree: tree, activeLeafId: 28 }),
    ]);
    const [restored] = hydrateTabs([serialized], "s2", counter());

    expect(restored.kind).toBe("terminal");
    if (restored.kind !== "terminal") return;
    expect(leafIdsOf(restored.paneTree)).toHaveLength(8);
    expect(restored.cwd).toBe("/pane-8");
  });

  it("persists a terminal environment without a live SSH session id", () => {
    const ssh = {
      kind: "ssh" as const,
      connection: {
        id: "srv-1",
        name: "Build server",
        host: "build.example.com",
        user: "deploy",
      },
      root: "/srv/app",
      sessionId: 42,
    };
    const [serialized] = serializeTabs([term({ workspaceEnv: ssh })]);
    expect(serialized).toMatchObject({
      workspaceEnv: {
        kind: "ssh",
        connection: ssh.connection,
        root: ssh.root,
      },
    });
    expect(serialized).toEqual(
      expect.objectContaining({
        workspaceEnv: expect.not.objectContaining({ sessionId: 42 }),
      }),
    );

    const [restored] = hydrateTabs([serialized], "s1", counter());
    expect(restored.kind).toBe("terminal");
    if (restored.kind === "terminal") {
      expect(restored.workspaceEnv).toEqual({
        kind: "ssh",
        connection: ssh.connection,
        root: ssh.root,
      });
    }
  });

  it("persists an editor filesystem identity without a live SSH session id", () => {
    const ssh = {
      kind: "ssh" as const,
      connection: {
        id: "srv-editor",
        name: "Editor server",
        host: "editor.example.com",
      },
      root: "/srv/project",
      sessionId: 77,
    };
    const editor: Tab = {
      id: 9,
      tabKey: asTabKey("tab-editor-ssh"),
      workspaceScopeId: asWorkspaceScopeId("scope-editor-ssh"),
      kind: "editor",
      spaceId: "s1",
      title: "main.ts",
      path: "/srv/project/main.ts",
      dirty: false,
      preview: false,
      workspaceEnv: ssh,
    };

    const [serialized] = serializeTabs([editor]);
    expect(serialized).toMatchObject({
      kind: "editor",
      workspaceEnv: {
        kind: "ssh",
        connection: ssh.connection,
        root: ssh.root,
      },
    });
    expect(serialized).toEqual(
      expect.objectContaining({
        workspaceEnv: expect.not.objectContaining({ sessionId: 77 }),
      }),
    );

    const [restored] = hydrateTabs([serialized], "s1", counter());
    expect(restored).toMatchObject({
      kind: "editor",
      workspaceEnv: {
        kind: "ssh",
        connection: ssh.connection,
        root: ssh.root,
      },
    });
  });
});

describe("hydrateTabs", () => {
  it("creates identities for legacy serialized tabs", () => {
    const [restored] = hydrateTabs(
      [{ kind: "editor", path: "/a/legacy.ts" }],
      "legacy-space",
      counter(),
    );

    expect(restored.tabKey).toMatch(/^tab-/);
    expect(restored.workspaceScopeId).toBe("legacy-space");
  });

  it("repairs duplicate persisted tab identities", () => {
    const serialized: SerializedTab[] = [
      { kind: "editor", path: "/a/one.ts", tabKey: "tab-duplicate" },
      { kind: "editor", path: "/a/two.ts", tabKey: "tab-duplicate" },
    ];

    const restored = hydrateTabs(serialized, "legacy-space", counter());

    expect(restored[0].tabKey).toBe("tab-duplicate");
    expect(restored[1].tabKey).not.toBe("tab-duplicate");
    expect(new Set(restored.map((tab) => tab.tabKey)).size).toBe(2);
  });

  it("round-trips structure, cwd, blocks and active leaf", () => {
    const tree: PaneNode = {
      kind: "split",
      id: 10,
      dir: "col",
      children: [
        { kind: "leaf", id: 11, cwd: "/a" },
        { kind: "leaf", id: 12, cwd: "/b" },
      ],
    };
    const tabs: Tab[] = [
      term({
        paneTree: tree,
        activeLeafId: 12,
        blocks: true,
        customTitle: "x",
      }),
    ];
    const serialized = serializeTabs(tabs);
    const [restored] = hydrateTabs(serialized, "s2", counter());
    expect(restored.kind).toBe("terminal");
    if (restored.kind !== "terminal") return;

    expect(restored.spaceId).toBe("s2");
    expect(restored.cold).toBe(true);
    expect(restored.blocks).toBe(true);
    expect(restored.customTitle).toBe("x");
    expect(restored.paneTree.kind).toBe("split");

    const leaves = leafIdsOf(restored.paneTree);
    expect(new Set(leaves).size).toBe(2);
    expect(leaves).toContain(restored.activeLeafId);
    // active leaf was the second one, which carried /b
    expect(restored.cwd).toBe("/b");
  });

  it("allocates fresh, unique, monotonic ids across all tabs and leaves", () => {
    const tree: PaneNode = {
      kind: "split",
      id: 10,
      dir: "row",
      children: [
        { kind: "leaf", id: 11, cwd: "/a" },
        { kind: "leaf", id: 12, cwd: "/b" },
      ],
    };
    const serialized = serializeTabs([
      term({ id: 1, paneTree: tree, activeLeafId: 11 }),
      term({ id: 2 }),
    ]);
    const restored = hydrateTabs(serialized, "s1", counter(100));

    const ids: number[] = [];
    for (const t of restored) {
      ids.push(t.id);
      if (t.kind === "terminal") ids.push(...leafIdsOf(t.paneTree));
    }
    expect(new Set(ids).size).toBe(ids.length);
    expect(Math.min(...ids)).toBeGreaterThanOrEqual(100);
  });

  it("returns empty for corrupted input without throwing", () => {
    expect(hydrateTabs([] as SerializedTab[], "s1", counter())).toEqual([]);
    expect(
      hydrateTabs(null as unknown as SerializedTab[], "s1", counter()),
    ).toEqual([]);
  });

  it("hydrates editor/preview/markdown as cold with derived titles", () => {
    const serialized: SerializedTab[] = [
      { kind: "editor", path: "/a/foo.ts" },
      { kind: "preview", url: "http://localhost:5173/x" },
      { kind: "markdown", path: "/a/README.md" },
    ];
    const out = hydrateTabs(serialized, "s1", counter());
    expect(out.every((t) => t.cold === true)).toBe(true);
    expect(out.map((t) => t.title)).toEqual([
      "foo.ts",
      "localhost:5173",
      "README.md",
    ]);
  });
});
