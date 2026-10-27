import { describe, expect, it, vi } from "vitest";
import type { FilePaneTab, WorkspaceTab } from "@/modules/harness/lib/layout";
import type { ProjectTerminalDock } from "@/modules/harness/lib/projectTerminal";
import type { Session } from "@/modules/harness/lib/session";
import {
  collectWorkspaceSnapshot,
  type WorkspaceSnapshot,
} from "@/modules/harness/lib/workspaceSnapshot";
import {
  HarnessWorkspaceCollisionError,
  mergeHarnessWindowWorkspaces,
} from "@/modules/harness/lib/harnessWindowWorkspace";

function session(id = "s1"): Session {
  return {
    id,
    harness: "codex",
    model: "model",
    modelSettings: { effort: "high" },
    runtimeMode: "supervised",
    title: "Session",
    cwd: "C:\\synthetic\\project",
    blocks: [
      {
        id: "b1",
        role: "tool",
        text: "private content",
        tool: {
          preview: {
            kind: "read",
            lines: [{ kind: "context", text: "private line" }],
          },
        },
      },
    ],
    busy: true,
    providerAccountId: "account",
    queuedMessages: [{ id: "q1", text: "follow up", attachments: [] }],
    pendingQuestion: {
      requestId: 1,
      questions: [
        {
          id: "question",
          prompt: "Choose",
          multiSelect: false,
          allowCustom: true,
          options: [{ id: "a", label: "A" }],
        },
      ],
    },
    noteCard: { id: "n1", slug: "note", title: "Note", body: "private note" },
    networkSandbox: { enabled: true, allowlist: ["example.invalid"] },
  };
}

function tab(id = "t1", sessionId = "s1"): WorkspaceTab {
  return {
    kind: "session",
    id,
    layout: { type: "leaf", id: sessionId },
    focusedId: sessionId,
    filePanes: [],
  };
}

function capture(ownerId = 1, sessions = [session()]) {
  const tabs = sessions.map((s) => tab(`t-${s.id}`, s.id));
  const snapshot: WorkspaceSnapshot = {
    tabs,
    sessions: sessions.map(({ blocks: _blocks, ...s }) => ({
      id: s.id,
      cwd: s.cwd,
      harness: s.harness,
      model: s.model,
      modelSettings: s.modelSettings,
      runtimeMode: s.runtimeMode,
      title: s.title,
    })),
    activeTabId: tabs[0]?.id ?? "",
    projectCwd: sessions[0]?.cwd ?? "~",
    projectTerminals: [],
  };
  return { ownerId, sessions, snapshot };
}

function terminal(id = "terminal"): FilePaneTab {
  return { id, path: "shell", cwd: "remote://opaque/project", terminal: true };
}

function dock(file = terminal(), projectPath = file.cwd): ProjectTerminalDock {
  return {
    projectPath,
    pane: { id: "dock-pane", files: [file], activeFileId: file.id },
    side: "bottom",
    size: 220,
    open: true,
  };
}

function collision(run: () => unknown) {
  expect(run).toThrow(HarnessWorkspaceCollisionError);
  try {
    run();
  } catch (error) {
    expect(error).toMatchObject({
      code: "HARNESS_WORKSPACE_COLLISION",
      message: "Harness workspace collision",
    });
  }
}

describe("mergeHarnessWindowWorkspaces", () => {
  it("keeps every owner and busy Session reference, choosing only presentation", () => {
    const a = capture(9, [session("local")]);
    const b = capture(2, [
      { ...session("remote"), cwd: "remote://opaque/project" },
    ]);
    const result = mergeHarnessWindowWorkspaces([a, b], 9);
    expect(result.sessions).toEqual([b.sessions[0], a.sessions[0]]);
    expect(result.sessions[0]).toBe(b.sessions[0]);
    expect(result.snapshot.tabs).toEqual([
      ...b.snapshot.tabs,
      ...a.snapshot.tabs,
    ]);
    expect(result.snapshot.sessions).toEqual([
      ...b.snapshot.sessions,
      ...a.snapshot.sessions,
    ]);
    expect(result.snapshot.activeTabId).toBe(a.snapshot.activeTabId);
    expect(result.snapshot.projectCwd).toBe(a.snapshot.projectCwd);
    expect(result.selectedOwnerId).toBe(9);
  });

  it.each([null, 99])(
    "falls back to the lowest owner for selection %s",
    (selected) => {
      const a = capture(9, [session("a")]);
      const b = capture(2, [session("b")]);
      expect(mergeHarnessWindowWorkspaces([a, b], selected)).toEqual(
        mergeHarnessWindowWorkspaces([b, a], 2),
      );
    },
  );

  it("returns the empty legacy snapshot without inventing view mapping", () => {
    expect(mergeHarnessWindowWorkspaces([], 3)).toEqual({
      sessions: [],
      selectedOwnerId: null,
      snapshot: {
        tabs: [],
        sessions: [],
        activeTabId: "",
        projectCwd: "~",
        projectTerminals: [],
      },
    });
  });

  it("deduplicates identical references and complete copies without serializing", () => {
    const a = capture();
    const b = structuredClone(a);
    b.ownerId = 2;
    const stringify = vi.spyOn(JSON, "stringify").mockImplementation(() => {
      throw new Error("serialization forbidden");
    });
    try {
      const result = mergeHarnessWindowWorkspaces([a, b], 2);
      expect(result.sessions).toEqual(a.sessions);
      expect(result.snapshot.tabs).toEqual(a.snapshot.tabs);
      expect(result.snapshot.sessions).toEqual(a.snapshot.sessions);
    } finally {
      stringify.mockRestore();
    }
  });

  it("compares object keys independently of insertion order", () => {
    const a = capture();
    const b = capture(2, [
      { ...a.sessions[0], modelSettings: { z: "1", a: "2" } },
    ]);
    a.sessions[0].modelSettings = { a: "2", z: "1" };
    a.snapshot.sessions[0].modelSettings = a.sessions[0].modelSettings;
    expect(mergeHarnessWindowWorkspaces([a, b], 1).sessions).toHaveLength(1);
  });

  it.each<Partial<Session>>([
    { busy: false },
    { providerAccountId: "different" },
    { harness: "claude" },
    { model: "different" },
    { modelSettings: { effort: "low" } },
    { worktreeCwd: "/synthetic/worktree" },
    { worktreeRemoved: true },
    { editingQueuedMessageId: "q1" },
    { queueStatus: "paused" },
    { context: { used: 1, window: 2 } },
    { composerSeed: "seed" },
    { handoffCard: { from: "codex", to: "claude", brief: "brief" } },
    {
      blocks: [
        {
          id: "b1",
          role: "tool",
          text: "private content",
          tool: {
            preview: {
              kind: "read",
              lines: [{ kind: "context", text: "different" }],
            },
          },
        },
      ],
    },
    {
      queuedMessages: [
        {
          id: "q1",
          text: "follow up",
          attachments: [
            {
              id: "a1",
              name: "a",
              kind: "file",
              size: 1,
              mimeType: "text/plain",
            },
          ],
        },
      ],
    },
    {
      pendingQuestion: {
        requestId: 1,
        questions: [
          {
            id: "question",
            prompt: "Choose",
            multiSelect: false,
            allowCustom: true,
            options: [{ id: "a", label: "Different" }],
          },
        ],
      },
    },
    { noteCard: { id: "n1", slug: "note", title: "Note", body: "different" } },
    { networkSandbox: { enabled: true, allowlist: ["different.invalid"] } },
    { busy: undefined },
  ])("rejects a complete Session mismatch %#", (change) => {
    const a = capture();
    const b = capture(2, [{ ...a.sessions[0], ...change }]);
    collision(() => mergeHarnessWindowWorkspaces([a, b], 2));
  });

  it("distinguishes an absent own field from explicit undefined", () => {
    const a = capture();
    const b = capture(2, [{ ...a.sessions[0], worktreeRemoved: undefined }]);
    collision(() => mergeHarnessWindowWorkspaces([a, b], 1));
  });

  it("rejects unequal snapshot stubs even when live Session identity matches", () => {
    const a = capture();
    const b = capture(2, a.sessions);
    b.snapshot.sessions[0].title = "different";
    collision(() => mergeHarnessWindowWorkspaces([a, b], 1));
  });

  it.each<Partial<WorkspaceTab>>([
    { focusedId: "different" },
    { diffOpen: true },
    {
      layout: {
        type: "split",
        id: "split",
        dir: "right",
        sizes: [0.5, 0.5],
        children: [
          { type: "leaf", id: "s1" },
          { type: "leaf", id: "s2" },
        ],
      },
    },
    {
      filePanes: [
        {
          id: "editor",
          activeFileId: "file",
          files: [{ id: "file", path: "/synthetic/file", cwd: "/synthetic" }],
        },
      ],
    },
  ])("rejects unequal same-ID tab layout/content %#", (change) => {
    const a = capture();
    const b = capture(2, a.sessions);
    b.snapshot.tabs[0] = { ...b.snapshot.tabs[0], ...change };
    collision(() => mergeHarnessWindowWorkspaces([a, b], 1));
  });

  it("deduplicates exact docks", () => {
    const a = capture();
    a.snapshot.projectTerminals = [dock()];
    const b = structuredClone(a);
    b.ownerId = 2;
    expect(
      mergeHarnessWindowWorkspaces([a, b], 1).snapshot.projectTerminals,
    ).toEqual([dock()]);
  });

  it.each<Partial<ProjectTerminalDock>>([
    { size: 230 },
    { side: "left" },
    { open: false },
    { projectPath: "/different" },
  ])("rejects unequal same-pane docks %#", (change) => {
    const a = capture();
    a.snapshot.projectTerminals = [dock()];
    const b = capture(2, a.sessions);
    b.snapshot.projectTerminals = [{ ...dock(), ...change }];
    collision(() => mergeHarnessWindowWorkspaces([a, b], 1));
  });

  it("rejects conflicting docks for the same exact project", () => {
    const a = capture();
    const b = capture(2, a.sessions);
    a.snapshot.projectTerminals = [dock()];
    b.snapshot.projectTerminals = [
      { ...dock(), pane: { ...dock().pane, id: "other-pane" } },
    ];
    collision(() => mergeHarnessWindowWorkspaces([a, b], 1));
  });

  it.each(["first", "after document"] as const)(
    "checks repeated terminal file descriptors %s and in docks",
    (position) => {
      const a = capture();
      a.snapshot.tabs[0].filePanes = [
        ...(position === "after document" ? [{
          id: "document-pane", activeFileId: "document",
          files: [{ id: "document", path: "/synthetic/file", cwd: "/synthetic" }],
        }] : []),
        { id: "pane", files: [terminal()], activeFileId: "terminal" },
      ];
      a.snapshot.projectTerminals = [
        dock({ ...terminal(), cwd: "/different" }),
      ];
      collision(() => mergeHarnessWindowWorkspaces([a], 1));
    },
  );

  it("allows equal terminal file descriptors in distinct containers", () => {
    const a = capture();
    a.snapshot.tabs[0].filePanes = [
      { id: "pane", files: [terminal()], activeFileId: "terminal" },
    ];
    a.snapshot.projectTerminals = [dock()];
    expect(
      mergeHarnessWindowWorkspaces([a], 1).snapshot.projectTerminals,
    ).toEqual([dock()]);
  });

  it("unions exact project return targets without selected-owner overrides", () => {
    const a = capture();
    const b = capture(2, a.sessions);
    a.snapshot.projectReturnTargets = [
      { projectPath: "/project", tabId: "s1" },
    ];
    b.snapshot.projectReturnTargets = [
      { projectPath: "/other", paneId: "s1" },
      { projectPath: "/project", tabId: "s1" },
    ];
    expect(
      mergeHarnessWindowWorkspaces([a, b], 2).snapshot.projectReturnTargets,
    ).toEqual([
      a.snapshot.projectReturnTargets[0],
      b.snapshot.projectReturnTargets[0],
    ]);
    b.snapshot.projectReturnTargets[1].tabId = "different";
    collision(() => mergeHarnessWindowWorkspaces([a, b], 2));
  });

  it("preserves opaque IDs and all root/project metadata verbatim", () => {
    const ids = [" s ", "S", "é", "e\u0301", "😀"];
    const a = capture(1, ids.map(session));
    a.snapshot.projectCwd = "  \\\\synthetic\\share\\root  ";
    a.snapshot.projectReturnTargets = [
      { projectPath: "C:\\Project\\", tabId: " s " },
      { projectPath: "c:/project", tabId: "S" },
    ];
    const result = mergeHarnessWindowWorkspaces([a], 1);
    expect(result.sessions.map((s) => s.id)).toEqual(ids);
    expect(result.snapshot.projectCwd).toBe(a.snapshot.projectCwd);
    expect(result.snapshot.projectReturnTargets).toEqual(
      a.snapshot.projectReturnTargets,
    );
  });

  it("never reintroduces dropped tabs/stubs or filters live Session membership", () => {
    const a = capture(1, [session("kept"), session("dropped")]);
    a.snapshot.tabs.pop();
    a.snapshot.sessions.pop();
    const result = mergeHarnessWindowWorkspaces([a], 1);
    expect(result.sessions).toHaveLength(2);
    expect(result.snapshot.tabs).toHaveLength(1);
    expect(result.snapshot.sessions).toHaveLength(1);
  });

  it("accepts snapshots sanitized separately by each view's keepTab", () => {
    const shared = session("shared");
    const a = capture(1, [shared, session("removed")]);
    const b = capture(2, [shared, session("other")]);
    a.snapshot = collectWorkspaceSnapshot(
      a.snapshot.tabs,
      a.sessions,
      a.snapshot.activeTabId,
      a.snapshot.projectCwd,
      new Map(),
      [],
      (value) => value.id !== "t-removed",
    );
    b.snapshot = collectWorkspaceSnapshot(
      b.snapshot.tabs,
      b.sessions,
      b.snapshot.activeTabId,
      b.snapshot.projectCwd,
      new Map(),
      [],
      (value) => value.id !== "t-shared",
    );
    const result = mergeHarnessWindowWorkspaces([a, b], 2);
    expect(result.snapshot.tabs.map((value) => value.id)).toEqual([
      "t-shared",
      "t-other",
    ]);
    expect(result.snapshot.sessions.map((value) => value.id)).toEqual([
      "shared",
      "other",
    ]);
    expect(result.sessions.map((value) => value.id)).toEqual([
      "shared",
      "removed",
      "other",
    ]);
  });

  it("does not mutate or freeze caller inputs and returns fresh arrays", () => {
    const a = capture();
    const before = structuredClone(a);
    const result = mergeHarnessWindowWorkspaces(Object.freeze([a]), 1);
    expect(a).toEqual(before);
    expect(Object.isFrozen(a.sessions[0])).toBe(false);
    expect(result.sessions).not.toBe(a.sessions);
    expect(result.snapshot.tabs).not.toBe(a.snapshot.tabs);
    expect(result.snapshot).not.toBe(a.snapshot);
  });

  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid owner ID %s",
    (ownerId) => {
      expect(() =>
        mergeHarnessWindowWorkspaces([capture(ownerId)], null),
      ).toThrow(TypeError);
    },
  );

  it("rejects duplicate owner IDs even with equal captures", () => {
    const a = capture();
    expect(() => mergeHarnessWindowWorkspaces([a, a], null)).toThrow(TypeError);
  });

  it.each(["", " \t\n", "s".repeat(257)])(
    "rejects invalid Session IDs %#",
    (id) => {
      expect(() =>
        mergeHarnessWindowWorkspaces([capture(1, [session(id)])], null),
      ).toThrow(TypeError);
    },
  );

  it("accepts the 256-character opaque Session ID boundary", () => {
    const a = capture(1, [session("s".repeat(256))]);
    a.snapshot.tabs[0].id = "tab";
    a.snapshot.activeTabId = "tab";
    expect(mergeHarnessWindowWorkspaces([a], 1).sessions[0].id).toHaveLength(
      256,
    );
  });

  it.each([-1, 0, 1.5, NaN, Infinity, 257])(
    "rejects invalid maximum %s",
    (maximum) => {
      expect(() => mergeHarnessWindowWorkspaces([], null, maximum)).toThrow(
        RangeError,
      );
    },
  );

  it("bounds raw views before duplicate owner processing", () => {
    expect(() =>
      mergeHarnessWindowWorkspaces(Array(257).fill(capture()), null),
    ).toThrow(RangeError);
  });

  it.each(["live", "tabs", "stubs", "docks"])(
    "bounds raw %s before dedupe",
    (kind) => {
      const a = capture();
      if (kind === "live") a.sessions = Array(257).fill(a.sessions[0]);
      if (kind === "tabs")
        a.snapshot.tabs = Array(257).fill(a.snapshot.tabs[0]);
      if (kind === "stubs")
        a.snapshot.sessions = Array(257).fill(a.snapshot.sessions[0]);
      if (kind === "docks")
        a.snapshot.projectTerminals = Array(257).fill(dock());
      expect(() => mergeHarnessWindowWorkspaces([a], null)).toThrow(RangeError);
    },
  );

  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "rejects malformed selected owner %s before reading captures",
    (selectedOwnerId) => {
      const a = capture();
      Object.defineProperty(a, "snapshot", {
        get: () => {
          throw new Error("unexpected read");
        },
      });
      expect(() => mergeHarnessWindowWorkspaces([a], selectedOwnerId)).toThrow(
        TypeError,
      );
    },
  );

  it.each(["stub", "tab", "leaf", "pane", "file"])(
    "rejects invalid %s reference IDs",
    (kind) => {
      const a = capture();
      if (kind === "stub") a.snapshot.sessions[0].id = " ";
      if (kind === "tab") a.snapshot.tabs[0].id = " ";
      if (kind === "leaf") a.snapshot.tabs[0].layout.id = " ";
      if (kind === "pane")
        a.snapshot.projectTerminals = [
          { ...dock(), pane: { ...dock().pane, id: " " } },
        ];
      if (kind === "file") a.snapshot.projectTerminals = [dock(terminal(" "))];
      expect(() => mergeHarnessWindowWorkspaces([a], null)).toThrow(TypeError);
    },
  );

  it("accepts exactly 256 unique reference IDs and rejects 257", () => {
    const a = capture(
      1,
      Array.from({ length: 128 }, (_, i) => session(`s${i}`)),
    );
    expect(mergeHarnessWindowWorkspaces([a], 1).sessions).toHaveLength(128);
    const b = capture(2, a.sessions);
    b.snapshot.tabs[0] = { ...b.snapshot.tabs[0], id: "extra-tab" };
    expect(() => mergeHarnessWindowWorkspaces([a, b], 1)).toThrow(RangeError);
  });

  it("checks all raw collection lengths before an earlier content collision", () => {
    const a = capture();
    const b = capture(2, [{ ...a.sessions[0], busy: false }]);
    const c = capture(3);
    c.snapshot.sessions = Array(257).fill(c.snapshot.sessions[0]);
    expect(() => mergeHarnessWindowWorkspaces([a, b, c], null)).toThrow(
      RangeError,
    );
  });

  it("bounds unique return mappings even when their reference IDs are shared", () => {
    const a = capture();
    const b = capture(2, a.sessions);
    a.snapshot.projectReturnTargets = [
      { projectPath: "/a", tabId: "s1" },
      { projectPath: "/b", tabId: "s1" },
    ];
    b.snapshot.projectReturnTargets = [
      { projectPath: "/c", tabId: "s1" },
      { projectPath: "/d", tabId: "s1" },
    ];
    expect(() => mergeHarnessWindowWorkspaces([a, b], 1, 2)).toThrow(
      RangeError,
    );
  });

  it.each([
    ["session", "tab"],
    ["session", "pane"],
    ["session", "file"],
    ["session", "split"],
    ["tab", "pane"],
    ["tab", "file"],
    ["tab", "split"],
    ["pane", "file"],
    ["pane", "split"],
    ["file", "split"],
  ])("rejects one defining ID reused for %s and %s", (first, second) => {
    const a = capture();
    const id = (role: string, unique: string) =>
      role === first || role === second ? "collision" : unique;
    a.sessions[0].id = id("session", "s1");
    a.snapshot.sessions[0].id = a.sessions[0].id;
    const workspace = a.snapshot.tabs[0];
    workspace.id = id("tab", "tab");
    workspace.focusedId = a.sessions[0].id;
    const paneId = id("pane", "pane");
    const file = terminal(id("file", "file"));
    workspace.filePanes = [
      { id: paneId, files: [file], activeFileId: file.id },
    ];
    workspace.layout = {
      type: "split",
      id: id("split", "split"),
      dir: "right",
      sizes: [0.5, 0.5],
      children: [
        { type: "leaf", id: a.sessions[0].id },
        { type: "leaf", id: paneId },
      ],
    };
    a.snapshot.activeTabId = workspace.id;
    collision(() => mergeHarnessWindowWorkspaces([a], 1));
  });

  it("allows leaves and selected/return IDs to reference defined resources", () => {
    const a = capture();
    const file = terminal();
    a.snapshot.tabs[0].filePanes = [
      { id: "pane", files: [file], activeFileId: file.id },
    ];
    a.snapshot.tabs[0].layout = {
      type: "split",
      id: "split",
      dir: "right",
      sizes: [0.5, 0.5],
      children: [
        { type: "leaf", id: "s1" },
        { type: "leaf", id: "pane" },
      ],
    };
    a.snapshot.tabs[0].focusedId = "pane";
    a.snapshot.projectReturnTargets = [
      {
        projectPath: a.snapshot.projectCwd,
        tabId: a.snapshot.tabs[0].id,
        paneId: "pane",
      },
    ];
    const b = structuredClone(a);
    b.ownerId = 2;
    expect(mergeHarnessWindowWorkspaces([a, b], 2).snapshot).toEqual(
      a.snapshot,
    );
  });

  it("rejects a cross-owner resource role collision with a stub-only Session", () => {
    const a = capture();
    a.sessions = [];
    a.snapshot.tabs = [];
    a.snapshot.activeTabId = "";
    const b = capture(2, [session("other")]);
    b.snapshot.projectTerminals = [
      { ...dock(), pane: { ...dock().pane, id: "s1" } },
    ];
    collision(() => mergeHarnessWindowWorkspaces([a, b], 2));
  });

  it("rejects a bounded per-view input whose union exceeds the limit", () => {
    const a = capture(1, [session("a")]);
    const b = capture(2, [session("b")]);
    expect(() => mergeHarnessWindowWorkspaces([a, b], null, 3)).toThrow(
      RangeError,
    );
  });
});
