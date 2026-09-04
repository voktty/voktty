import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newSession } from "../session";
import { appendUser, applyHarnessEvent, appendSteerUser, stopStreaming } from "./apply";

let now = 0;

beforeEach(() => {
  now = 0;
  vi.spyOn(Date, "now").mockImplementation(() => now);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("turn duration", () => {
  it("stamps how long the agent worked when the turn ends", () => {
    now = 1_000;
    let session = appendUser(newSession("cursor", "/tmp"), "hi");
    expect(session.busy).toBe(true);
    expect(session.blocks[0]?.startedAt).toBe(1_000);
    expect(session.blocks[0]?.durationMs).toBeUndefined();

    now = 26_000;
    session = stopStreaming(session);
    expect(session.busy).toBe(false);
    expect(session.blocks[0]?.durationMs).toBe(25_000);
  });

  it("does not overwrite a duration already recorded", () => {
    now = 1_000;
    let session = appendUser(newSession("cursor", "/tmp"), "hi");
    now = 5_000;
    session = stopStreaming(session);
    now = 90_000;
    session = stopStreaming(session);
    expect(session.blocks[0]?.durationMs).toBe(4_000);
  });

  it("records duration when the turn errors", () => {
    now = 1_000;
    let session = appendUser(newSession("cursor", "/tmp"), "hi");
    now = 8_000;
    session = applyHarnessEvent(session, {
      type: "session.error",
      message: "boom",
    });
    expect(session.busy).toBe(false);
    expect(session.blocks[0]?.durationMs).toBe(7_000);
  });
});

describe("streamed markdown", () => {
  it("keeps heading breaks, tables, and doubled letters", () => {
    const chunks = [
      "# Result",
      "\n",
      "\n",
      "book",
      "keeper..\n",
      "\n",
      "| a | b |\n",
      "| --- | --- |\n",
      "| 1 | 2 |",
    ];
    const session = chunks.reduce(
      (current, text) =>
        applyHarnessEvent(current, { type: "message.delta", text }),
      newSession("pi", "/tmp"),
    );
    expect(session.blocks[0]?.text).toBe(chunks.join(""));
  });

  it("does not double an assistant block when a completed snapshot repeats it", () => {
    let session = newSession("claude", "/tmp");
    session = applyHarnessEvent(session, {
      type: "message.delta",
      text: "I'll read the file",
    });
    session = applyHarnessEvent(session, {
      type: "message.delta",
      text: "I'll read the file",
    });
    expect(session.blocks).toHaveLength(1);
    expect(session.blocks[0]?.text).toBe("I'll read the file");
  });
});

describe("appendSteerUser", () => {
  it("appends a user message without sealing an in-flight assistant block", () => {
    let session = appendUser(newSession("cursor", "/tmp"), "build it");
    session = applyHarnessEvent(session, {
      type: "message.delta",
      text: "Working on it",
    });
    expect(session.blocks[1]?.streaming).toBe(true);

    session = appendSteerUser(session, "focus on tests");
    expect(session.blocks).toHaveLength(3);
    expect(session.blocks[1]?.streaming).toBe(true);
    expect(session.blocks[2]).toMatchObject({
      role: "user",
      text: "focus on tests",
    });
    expect(session.blocks[2]?.startedAt).toBeUndefined();
    expect(session.busy).toBe(true);
  });

  it("keeps a note card on a steered user turn", () => {
    let session = appendUser(newSession("cursor", "/tmp"), "build it");
    session = appendSteerUser(session, "hi", [], {
      noteCard: { id: "n1", slug: "overview", title: "Overview" },
    });
    expect(session.blocks[1]).toMatchObject({
      role: "user",
      text: "hi",
      noteCard: { id: "n1", slug: "overview", title: "Overview" },
    });
  });
});

describe("status blocks", () => {
  it("keeps one row when the same status repeats", () => {
    let session = appendUser(newSession("claude", "/tmp"), "go");
    session = applyHarnessEvent(session, {
      type: "status",
      text: "Retrying in 3s",
    });
    session = applyHarnessEvent(session, {
      type: "status",
      text: "Retrying in 3s",
    });
    const system = session.blocks.filter((block) => block.role === "system");
    expect(system).toHaveLength(1);
    expect(system[0]?.text).toBe("Retrying in 3s");
  });

  it("still appends a status that differs from the last one", () => {
    let session = appendUser(newSession("claude", "/tmp"), "go");
    session = applyHarnessEvent(session, { type: "status", text: "Retrying" });
    session = applyHarnessEvent(session, { type: "status", text: "Compacting" });
    expect(
      session.blocks.filter((block) => block.role === "system"),
    ).toHaveLength(2);
  });

  it("ignores blank status text", () => {
    let session = appendUser(newSession("claude", "/tmp"), "go");
    session = applyHarnessEvent(session, { type: "status", text: "  " });
    expect(session.blocks.some((block) => block.role === "system")).toBe(false);
  });
});

describe("task list updates", () => {
  it("updates one structured checklist instead of appending plan cards", () => {
    let session = appendUser(newSession("codex", "/tmp"), "fix it");
    session = applyHarnessEvent(session, {
      type: "tasks.updated",
      key: "turn_1",
      explanation: "Starting with the regression.",
      items: [
        { text: "Inspect", status: "in_progress" },
        { text: "Verify", status: "pending" },
      ],
    });
    const taskId = session.blocks.find((block) => block.role === "tasks")?.id;

    session = applyHarnessEvent(session, {
      type: "tool.started",
      callId: "call_1",
      title: "Read src/App.tsx",
    });
    session = applyHarnessEvent(session, {
      type: "tasks.updated",
      key: "turn_1",
      items: [
        { text: "Inspect", status: "completed" },
        { text: "Verify", status: "in_progress" },
      ],
    });

    const tasks = session.blocks.filter((block) => block.role === "tasks");
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      id: taskId,
      text: "[x] Inspect\n[~] Verify",
      taskList: {
        key: "turn_1",
        items: [
          { text: "Inspect", status: "completed" },
          { text: "Verify", status: "in_progress" },
        ],
      },
    });
    expect(tasks[0]?.taskList?.explanation).toBeUndefined();
    expect(session.blocks.some((block) => block.role === "plan")).toBe(false);
  });

  it("merges partial status updates without removing or renaming tasks", () => {
    let session = appendUser(newSession("cursor", "/tmp"), "fix it");
    session = applyHarnessEvent(session, {
      type: "tasks.updated",
      items: [
        { id: "1", text: "Inspect", status: "completed" },
        { id: "2", text: "Implement", status: "in_progress" },
        { id: "3", text: "Verify", status: "pending" },
      ],
    });
    session = applyHarnessEvent(session, {
      type: "tasks.updated",
      merge: true,
      items: [
        { id: "2", text: "Implementing the fix", status: "completed" },
      ],
    });

    expect(
      session.blocks.find((block) => block.role === "tasks")?.taskList?.items,
    ).toEqual([
      { id: "1", text: "Inspect", status: "completed" },
      { id: "2", text: "Implement", status: "completed" },
      { id: "3", text: "Verify", status: "pending" },
    ]);
  });

  it("keeps known labels stable when a full snapshot changes membership", () => {
    let session = appendUser(newSession("cursor", "/tmp"), "fix it");
    session = applyHarnessEvent(session, {
      type: "tasks.updated",
      items: [
        { id: "1", text: "Inspect", status: "completed" },
        { id: "2", text: "Implement", status: "in_progress" },
      ],
    });
    session = applyHarnessEvent(session, {
      type: "tasks.updated",
      items: [
        { id: "2", text: "Implementing the fix", status: "completed" },
        { id: "3", text: "Verify", status: "in_progress" },
      ],
    });

    expect(
      session.blocks.find((block) => block.role === "tasks")?.taskList?.items,
    ).toEqual([
      { id: "2", text: "Implement", status: "completed" },
      { id: "3", text: "Verify", status: "in_progress" },
    ]);
  });

  it("resets an in-progress task to pending when the turn stops", () => {
    let session = appendUser(newSession("cursor", "/tmp"), "fix it");
    session = applyHarnessEvent(session, {
      type: "tasks.updated",
      items: [
        { text: "Inspect", status: "completed" },
        { text: "Implement", status: "in_progress" },
      ],
    });
    session = stopStreaming(session);

    const tasks = session.blocks.find((block) => block.role === "tasks");
    expect(tasks?.text).toBe("[x] Inspect\n[ ] Implement");
    expect(tasks?.taskList?.items).toEqual([
      { text: "Inspect", status: "completed" },
      { text: "Implement", status: "pending" },
    ]);
  });

  it("keeps authored plans as separate document blocks", () => {
    let session = appendUser(newSession("codex", "/tmp"), "plan it");
    session = applyHarnessEvent(session, {
      type: "tasks.updated",
      items: [{ text: "Inspect", status: "pending" }],
    });
    session = applyHarnessEvent(session, {
      type: "plan",
      text: "# Proposed approach\n\nUse two layers.",
    });
    expect(session.blocks.map((block) => block.role)).toEqual([
      "user",
      "tasks",
      "plan",
    ]);
  });
});

describe("applyHarnessEvent context", () => {
  it("tracks the newest level instead of summing turns", () => {
    let session = newSession("claude", "/repo");
    session = applyHarnessEvent(session, {
      type: "context",
      used: 30_000,
      window: 200_000,
    });
    session = applyHarnessEvent(session, { type: "context", used: 55_000 });
    expect(session.context).toEqual({ used: 55_000, window: 200_000 });
  });

  it("keeps the level when only a window arrives", () => {
    let session = newSession("claude", "/repo");
    session = applyHarnessEvent(session, { type: "context", used: 12_000 });
    session = applyHarnessEvent(session, { type: "context", window: 400_000 });
    expect(session.context).toEqual({ used: 12_000, window: 400_000 });
  });

  it("leaves blocks alone", () => {
    const session = applyHarnessEvent(newSession("codex", "/repo"), {
      type: "context",
      used: 1_000,
      window: 200_000,
    });
    expect(session.blocks).toEqual([]);
  });
});

describe("tool enrichment", () => {
  it("fills in a bare Read row when approval carries the path", () => {
    let session = newSession("cursor", "/repo");
    session = applyHarnessEvent(session, {
      type: "tool.updated",
      callId: "call_1",
      title: "Read",
      kind: "read",
      status: "pending",
    });
    session = applyHarnessEvent(session, {
      type: "approval.requested",
      requestId: 1,
      title: "Read src/App.tsx",
      kind: "read",
      callId: "call_1",
      preview: { kind: "read", path: "src/App.tsx", fileName: "App.tsx" },
    });
    const tool = session.blocks.find((block) => block.tool?.callId === "call_1");
    expect(tool?.text).toBe("Read src/App.tsx");
    expect(tool?.tool?.preview?.path).toBe("src/App.tsx");
  });

  it("replaces a bare Bash label with the command once input arrives", () => {
    let session = newSession("claude", "/repo");
    session = applyHarnessEvent(session, {
      type: "tool.started",
      callId: "call_1",
      title: "Bash",
      kind: "execute",
      status: "pending",
    });
    session = applyHarnessEvent(session, {
      type: "tool.updated",
      callId: "call_1",
      title: "ls",
      kind: "execute",
      status: "pending",
    });
    const tool = session.blocks.find((block) => block.tool?.callId === "call_1");
    expect(tool?.text).toBe("ls");
  });
});

describe("clarifying questions", () => {
  const questions = [
    {
      id: "Which file?",
      prompt: "Which file?",
      multiSelect: false,
      allowCustom: true,
      options: [
        { id: "a.ts", label: "a.ts" },
        { id: "b.ts", label: "b.ts" },
      ],
    },
  ];

  it("parks the prompt on the session instead of an Allow/Deny row", () => {
    let session = newSession("claude", "/repo");
    session = applyHarnessEvent(session, {
      type: "question.asked",
      requestId: 3,
      title: "Which file?",
      questions,
    });
    expect(session.pendingQuestion).toEqual({
      requestId: 3,
      title: "Which file?",
      questions,
    });
    expect(session.blocks).toEqual([]);
  });

  it("clears the prompt when the user answers or skips", () => {
    let session = newSession("claude", "/repo");
    session = applyHarnessEvent(session, {
      type: "question.asked",
      requestId: 3,
      questions,
    });
    session = applyHarnessEvent(session, {
      type: "question.resolved",
      requestId: 3,
      decision: "answered",
    });
    expect(session.pendingQuestion).toBeUndefined();
  });

  it("drops a parked prompt when the turn stops", () => {
    let session = newSession("claude", "/repo");
    session = applyHarnessEvent(session, {
      type: "question.asked",
      requestId: 3,
      questions,
    });
    session = stopStreaming(session);
    expect(session.pendingQuestion).toBeUndefined();
  });
});
