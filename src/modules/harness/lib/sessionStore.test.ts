import { describe, expect, it } from "vitest";
import { newSession, type Block, type Session } from "./session";
import {
  cacheSession,
  clearSessionCache,
  evictCachedSession,
  getCachedSession,
  isPersistableId,
  persistFingerprint,
  recordToSession,
  sanitizeSessionForPersist,
} from "./sessionStore";

describe("isPersistableId", () => {
  it("accepts alphanumeric ids with hyphens and underscores", () => {
    expect(isPersistableId("acp-session-1")).toBe(true);
    expect(isPersistableId("abc_123")).toBe(true);
  });

  it("rejects filesystem paths", () => {
    expect(isPersistableId("/Users/me/.pi/agent/sessions/abc.jsonl")).toBe(
      false,
    );
  });
});

describe("sanitizeSessionForPersist", () => {
  it("persists model provenance recorded on a user turn", () => {
    const session = newSession("claude", "/tmp/project", "claude:opus-5");
    session.blocks = [
      {
        id: "u1",
        role: "user",
        text: "remember this",
        turnModel: {
          harness: "claude",
          id: "claude:opus-5",
          name: "Claude Opus 5",
        },
      },
    ];

    expect(sanitizeSessionForPersist(session).blocks[0]?.turnModel).toEqual({
      harness: "claude",
      id: "claude:opus-5",
      name: "Claude Opus 5",
    });
  });

  it("omits a path-like provider session id so upsert can still snapshot git", () => {
    const session = newSession("pi", "/tmp/project");
    session.providerSessionId = "/Users/me/.pi/agent/sessions/abc.jsonl";
    session.blocks = [{ id: "u1", role: "user", text: "hey" }];

    expect(
      sanitizeSessionForPersist(session).providerSessionId,
    ).toBeUndefined();
  });

  it("keeps a UUID provider session id", () => {
    const session = newSession("pi", "/tmp/project");
    session.providerSessionId = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
    session.blocks = [{ id: "u1", role: "user", text: "hey" }];

    expect(sanitizeSessionForPersist(session).providerSessionId).toBe(
      "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    );
  });

  it("keeps a handoff divider and settles a preparing one", () => {
    const session = newSession("cursor", "/tmp/project");
    session.blocks = [
      { id: "u1", role: "user", text: "hey" },
      {
        id: "h1",
        role: "handoff",
        text: "",
        handoff: { from: "cursor", to: "claude", status: "preparing" },
      },
    ];
    const persisted = sanitizeSessionForPersist(session);
    expect(persisted.blocks[1]).toMatchObject({
      role: "handoff",
      handoff: { from: "cursor", to: "claude", status: "ready", pending: true },
    });
  });

  it("keeps a second-opinion card on the user turn", () => {
    const session = newSession("codex", "/tmp/project");
    session.blocks = [
      {
        id: "u1",
        role: "user",
        text: "Second opinion",
        secondOpinion: {
          from: "claude",
          to: "codex",
          request: "fix the footer",
          files: 2,
        },
      },
    ];
    expect(sanitizeSessionForPersist(session).blocks[0]).toMatchObject({
      role: "user",
      text: "Second opinion",
      secondOpinion: {
        from: "claude",
        to: "codex",
        request: "fix the footer",
        files: 2,
      },
    });
  });

  it("keeps a handoff card kind on the user turn", () => {
    const session = newSession("codex", "/tmp/project");
    session.blocks = [
      {
        id: "u1",
        role: "user",
        text: "Handoff",
        secondOpinion: {
          from: "claude",
          to: "codex",
          kind: "handoff",
        },
      },
    ];
    expect(sanitizeSessionForPersist(session).blocks[0]).toMatchObject({
      role: "user",
      text: "Handoff",
      secondOpinion: { from: "claude", to: "codex", kind: "handoff" },
    });
  });

  it("keeps a note card on the user turn without the note body", () => {
    const session = newSession("codex", "/tmp/project");
    session.blocks = [
      {
        id: "u1",
        role: "user",
        text: "hi",
        noteCard: {
          id: "n1",
          slug: "overview",
          title: "agent-os project overview",
          sourceCwd: "/tmp/project",
        },
      },
    ];
    expect(sanitizeSessionForPersist(session).blocks[0]).toEqual({
      id: "u1",
      role: "user",
      text: "hi",
      noteCard: {
        id: "n1",
        slug: "overview",
        title: "agent-os project overview",
        sourceCwd: "/tmp/project",
      },
    });
  });

  it("keeps task list metadata on persistent blocks", () => {
    const session = newSession("codex", "/tmp/project");
    session.blocks = [
      {
        id: "t1",
        role: "tasks",
        text: "[x] Inspect\n[~] Implement",
        taskList: {
          key: "turn_1",
          explanation: "Inspection complete.",
          items: [
            { id: "1", text: "Inspect", status: "completed" },
            { id: "2", text: "Implement", status: "in_progress" },
          ],
        },
      },
    ];
    expect(sanitizeSessionForPersist(session).blocks[0]).toEqual({
      id: "t1",
      role: "tasks",
      text: "[x] Inspect\n[~] Implement",
      taskList: {
        key: "turn_1",
        explanation: "Inspection complete.",
        items: [
          { id: "1", text: "Inspect", status: "completed" },
          { id: "2", text: "Implement", status: "in_progress" },
        ],
      },
    });
  });
});

describe("persistFingerprint", () => {
  const user: Block = { id: "u1", role: "user", text: "hi" };
  const answer: Block = { id: "a1", role: "assistant", text: "done" };

  // One base session: `newSession` mints a fresh id, and the id is part of the
  // fingerprint, so variants have to be spread off a single session.
  const base = (blocks: Block[] = [user, answer]): Session => ({
    ...newSession("codex", "/tmp/project"),
    blocks,
  });

  it("is stable while nothing changes", () => {
    const session = base();
    expect(persistFingerprint(session)).toBe(persistFingerprint(session));
  });

  it("matches a copy holding the same blocks", () => {
    const session = base();
    expect(persistFingerprint({ ...session })).toBe(
      persistFingerprint(session),
    );
  });

  it("changes when a block in the middle is replaced", () => {
    const tool: Block = {
      id: "t1",
      role: "tool",
      text: "run",
      tool: { status: "running" },
    };
    const before = base([user, tool, answer]);
    const after = {
      ...before,
      blocks: [user, { ...tool, tool: { status: "completed" } }, answer],
    };
    expect(persistFingerprint(after)).not.toBe(persistFingerprint(before));
  });

  it("changes when an approval is decided", () => {
    const approval: Block = {
      id: "p1",
      role: "approval",
      text: "allow?",
      approval: { requestId: 1 },
    };
    const before = base([user, approval]);
    const after = {
      ...before,
      blocks: [
        user,
        { ...approval, approval: { requestId: 1, decided: "allow" as const } },
      ],
    };
    expect(persistFingerprint(after)).not.toBe(persistFingerprint(before));
  });

  it("changes when a block is appended", () => {
    const before = base([user]);
    expect(persistFingerprint({ ...before, blocks: [user, answer] })).not.toBe(
      persistFingerprint(before),
    );
  });

  it("changes when a persisted field changes", () => {
    const before = base();
    expect(persistFingerprint({ ...before, title: "Renamed" })).not.toBe(
      persistFingerprint(before),
    );
  });

  it("ignores state that is never written", () => {
    const before = base();
    expect(persistFingerprint({ ...before, busy: true })).toBe(
      persistFingerprint(before),
    );
  });

  it("treats a path-like provider session id as absent", () => {
    const session = base();
    expect(
      persistFingerprint({
        ...session,
        providerSessionId: "/Users/me/.pi/agent/sessions/abc.jsonl",
      }),
    ).toBe(persistFingerprint(session));
  });

  it("matches persist for a zero context window", () => {
    const session = base();
    expect(
      persistFingerprint({ ...session, context: { used: 10, window: 0 } }),
    ).toBe(persistFingerprint({ ...session, context: { used: 10 } }));
  });
});

describe("session memory cache", () => {
  it("caches and retrieves sessions in memory", () => {
    clearSessionCache();
    const session = newSession("cursor", "/tmp/project");
    session.id = "test-session-123";
    session.blocks = [{ id: "b1", role: "user", text: "hello" }];

    cacheSession(session);
    const retrieved = getCachedSession("test-session-123");
    expect(retrieved).not.toBeNull();
    expect(retrieved?.id).toBe("test-session-123");
    expect(retrieved?.blocks).toHaveLength(1);
  });

  it("evicts cached session on demand", () => {
    clearSessionCache();
    const session = newSession("cursor", "/tmp/project");
    session.id = "test-session-456";
    cacheSession(session);
    expect(getCachedSession("test-session-456")).not.toBeNull();

    evictCachedSession("test-session-456");
    expect(getCachedSession("test-session-456")).toBeNull();
  });

  it("clears all cached sessions", () => {
    clearSessionCache();
    const session1 = newSession("cursor", "/tmp/project");
    session1.id = "test-session-1";
    const session2 = newSession("cursor", "/tmp/project");
    session2.id = "test-session-2";
    cacheSession(session1);
    cacheSession(session2);

    clearSessionCache();
    expect(getCachedSession("test-session-1")).toBeNull();
    expect(getCachedSession("test-session-2")).toBeNull();
  });
});

describe("recordToSession", () => {
  // A session record is a database row: its declared types describe what was
  // meant to be written, not what a legacy or partially written row holds.
  const row = {
    id: "s1",
    cwd: "/repo",
    harness: "claude",
    model: "sonnet",
    modelSettings: {},
    runtimeMode: "agent",
    title: "Session",
    blocks: [],
    createdAt: 0,
    updatedAt: 0,
  };

  it("passes a well-formed row through", () => {
    const session = recordToSession(row as never);
    expect(session.cwd).toBe("/repo");
    expect(session.title).toBe("Session");
    expect(session.model).toBe("sonnet");
  });

  it("falls back to the no-project sentinel for a non-string cwd", () => {
    // The shape that crashed the status bar with cwd.replace is not a function.
    expect(
      recordToSession({ ...row, cwd: { path: "/repo" } } as never).cwd,
    ).toBe("~");
    expect(recordToSession({ ...row, cwd: 42 } as never).cwd).toBe("~");
    expect(recordToSession({ ...row, cwd: null } as never).cwd).toBe("~");
    expect(recordToSession({ ...row, cwd: "" } as never).cwd).toBe("~");
  });

  it("keeps other text fields usable rather than propagating a bad shape", () => {
    const session = recordToSession({
      ...row,
      title: { text: "x" },
      model: [],
    } as never);
    expect(session.title).toBe("");
    expect(session.model).toBe("");
  });

  it("omits optional paths entirely when the row holds a non-string", () => {
    // worktreeCwd reaches normalizeProjectPath, which calls trim on it.
    const session = recordToSession({
      ...row,
      worktreeCwd: { path: "/wt" },
      branch: 7,
      providerSessionId: {},
    } as never);
    expect(session.worktreeCwd).toBeUndefined();
    expect(session.branch).toBeUndefined();
    expect(session.providerSessionId).toBeUndefined();
  });

  it("keeps optional paths that are usable", () => {
    const session = recordToSession({
      ...row,
      worktreeCwd: "/wt",
      branch: "main",
    } as never);
    expect(session.worktreeCwd).toBe("/wt");
    expect(session.branch).toBe("main");
  });
});
