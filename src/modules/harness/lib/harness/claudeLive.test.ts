import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sent: string[] = [];
const spawned: string[][] = [];
let onLine: ((line: string) => void) | undefined;
let onExit: ((code?: number | null) => void) | undefined;

vi.mock("./child", () => ({
  resolveClaudeBinary: async () => ({ path: "/fake/claude" }),
  spawnChild: async (_id: string, _path: string, args: string[]) => {
    spawned.push(args);
  },
  killChild: async () => undefined,
  unwatchChild: () => undefined,
  watchChild: (
    _id: string,
    line: (l: string) => void,
    exit?: (code?: number | null) => void,
  ) => {
    onLine = line;
    onExit = exit;
  },
  writeChild: async (_id: string, line: string) => {
    sent.push(line);
  },
}));

const {
  bindClaudeSession,
  compactClaudeContext,
  restoreClaudeTaskLists,
  sendClaudeTurn,
  stopClaudeSession,
  __claudeTestReset,
} = await import("./claude");
import type { HarnessEvent } from "./types";
import { newSession, type RuntimeMode, type TurnIntent } from "../session";
import { applyHarnessEvent } from "./apply";

function parse() {
  return sent.map((line) => JSON.parse(line) as Record<string, unknown>);
}

function emit(rec: Record<string, unknown>) {
  onLine!(JSON.stringify(rec));
}

const waitFor = async (pred: () => boolean, label: string) => {
  for (let i = 0; i < 200; i++) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(
    `timed out waiting for ${label}; sent=${JSON.stringify(parse())}`,
  );
};

async function startTurn(
  sessionId: string,
  options: {
    runtimeMode?: RuntimeMode;
    intent?: TurnIntent;
    providerAccountId?: string;
  } = {},
) {
  const events: HarnessEvent[] = [];
  const turn = sendClaudeTurn({
    sessionId,
    cwd: "/repo",
    model: "claude:claude-sonnet-5",
    modelSettings: {},
    runtimeMode: options.runtimeMode ?? "supervised",
    intent: options.intent,
    providerAccountId: options.providerAccountId,
    text: "explore the codebase",
    attachments: [],
    onEvent: (event) => events.push(event),
  });

  await waitFor(
    () =>
      parse().some((m) => {
        const request = m.request as Record<string, unknown> | undefined;
        return request?.subtype === "initialize";
      }),
    "initialize",
  );
  emit({ type: "system", subtype: "init", session_id: "sess_1" });
  emit({
    type: "control_response",
    response: { subtype: "success", request_id: "monocode_1" },
  });
  await waitFor(() => parse().some((m) => m.type === "user"), "user prompt");
  return { events, turn };
}

beforeEach(() => {
  sent.length = 0;
  spawned.length = 0;
  onLine = undefined;
  onExit = undefined;
  __claudeTestReset();
});

afterEach(async () => {
  await stopClaudeSession("s1");
  __claudeTestReset();
});

describe("claude model switching", () => {
  it("restarts a named account with the new model while resuming the provider conversation", async () => {
    const first = await startTurn("s1", {
      providerAccountId: "account-work",
    });
    emit({ type: "result", subtype: "success", session_id: "sess_1" });
    await first.turn;

    const userCount = parse().filter(
      (message) => message.type === "user",
    ).length;
    const second = sendClaudeTurn({
      sessionId: "s1",
      cwd: "/repo",
      model: "claude:opus-5",
      modelSettings: {},
      runtimeMode: "supervised",
      providerAccountId: "account-work",
      text: "what did I ask before?",
      attachments: [],
      onEvent: () => undefined,
    });

    await waitFor(() => spawned.length === 2, "replacement Claude process");
    expect(spawned[1]).toEqual(
      expect.arrayContaining([
        "--model",
        "claude-opus-5",
        "--resume",
        "sess_1",
      ]),
    );
    expect(spawned[1]).not.toContain("--session-id");

    emit({ type: "system", subtype: "init", session_id: "sess_1" });
    await waitFor(
      () =>
        parse().filter((message) => message.type === "user").length > userCount,
      "follow-up prompt",
    );
    emit({ type: "result", subtype: "success", session_id: "sess_1" });
    await second;
  });
});

describe("claude legacy account resume", () => {
  it("resumes a legacy thread when the missing account resolves to default", async () => {
    bindClaudeSession("s1", "legacy-session", "/repo");
    const { turn } = await startTurn("s1", {
      providerAccountId: "default",
    });
    expect(spawned[0]).toEqual(
      expect.arrayContaining(["--resume", "legacy-session"]),
    );
    expect(spawned[0]).not.toContain("--session-id");
    emit({ type: "result", subtype: "success", session_id: "legacy-session" });
    await turn;
  });

  it("does not resume a legacy default thread under a named account", async () => {
    bindClaudeSession("s1", "legacy-session", "/repo");
    const { turn } = await startTurn("s1", {
      providerAccountId: "account-work",
    });
    expect(spawned[0]).not.toContain("--resume");
    expect(spawned[0]).toContain("--session-id");
    emit({ type: "result", subtype: "success", session_id: "sess_1" });
    await turn;
  });
});

describe("claude subagents", () => {
  it.each([
    {
      scenario: "different descriptions",
      descriptions: ["Explore the auth module", "Review the tests"],
    },
    {
      scenario: "identical descriptions",
      descriptions: ["Explore the auth module", "Explore the auth module"],
    },
  ])(
    "shows one row per background subagent when the task list comes first ($scenario)",
    async ({ descriptions }) => {
      const { events, turn } = await startTurn("s1");
      const agents = [
        { id: "toolu_a", task: "t1", description: descriptions[0] },
        { id: "toolu_b", task: "t2", description: descriptions[1] },
      ];

      emit({
        type: "assistant",
        session_id: "sess_1",
        message: {
          content: agents.map((agent) => ({
            type: "tool_use",
            id: agent.id,
            name: "Agent",
            input: {
              description: agent.description,
              subagent_type: "explore",
              run_in_background: true,
            },
          })),
        },
      });
      // Claude lists the tasks, with no tool_use_id, before it announces them.
      emit({
        type: "system",
        subtype: "background_tasks_changed",
        tasks: agents.map((agent) => ({
          task_id: agent.task,
          task_type: "local_agent",
          description: agent.description,
        })),
      });
      // Each listed task must claim a different call, even before task_started
      // supplies the authoritative IDs for agents with identical descriptions.
      expect(
        new Set(
          events.flatMap((event) =>
            event.type === "tool.updated" ? [event.callId] : [],
          ),
        ),
      ).toEqual(new Set(["toolu_a", "toolu_b"]));
      for (const agent of agents) {
        emit({
          type: "system",
          subtype: "task_started",
          task_id: agent.task,
          tool_use_id: agent.id,
          description: agent.description,
          task_type: "local_agent",
          is_backgrounded: true,
        });
      }

      await waitFor(
        () =>
          events.filter(
            (event) =>
              event.type === "tool.updated" && event.callId === "toolu_b",
          ).length > 0,
        "second task started",
      );
      const rows = events.flatMap((event) =>
        event.type === "tool.started" && event.kind === "agent"
          ? [event.callId]
          : [],
      );
      expect(rows).toEqual(["toolu_a", "toolu_b"]);

      emit({
        type: "system",
        subtype: "task_notification",
        task_id: "t1",
        tool_use_id: "toolu_a",
        status: "completed",
        summary: "First agent finished",
      });
      const session = events.reduce(
        applyHarnessEvent,
        newSession("claude", "/repo"),
      );
      expect(
        session.blocks.find((block) => block.tool?.callId === "toolu_a")?.tool,
      ).toMatchObject({ status: "completed", detail: "First agent finished" });
      expect(
        session.blocks.find((block) => block.tool?.callId === "toolu_b")?.tool,
      ).toMatchObject({ status: "in_progress" });
      emit({
        type: "system",
        subtype: "task_notification",
        task_id: "t2",
        tool_use_id: "toolu_b",
        status: "completed",
        summary: "Second agent finished",
      });
      emit({ type: "result", subtype: "success", session_id: "sess_1" });
      await turn;
    },
  );

  it("keeps an unmatched background subagent visible until it finishes", async () => {
    const { events, turn } = await startTurn("s1");
    const description = "Explore the auth module";
    const task = {
      task_id: "t1",
      task_type: "local_agent",
      description,
    };
    // A task can be listed without an Agent call in the parent transcript.
    for (let i = 0; i < 2; i++) {
      emit({
        type: "system",
        subtype: "background_tasks_changed",
        tasks: [task],
      });
    }
    emit({
      type: "system",
      subtype: "task_progress",
      task_id: "t1",
      description,
      summary: "Reading the auth module",
    });
    const session = events.reduce(
      applyHarnessEvent,
      newSession("claude", "/repo"),
    );
    expect(
      session.blocks.filter((block) => block.tool?.kind === "agent"),
    ).toHaveLength(1);
    expect(
      session.blocks.find(
        (block) => block.tool?.callId === `agent:${description}`,
      )?.tool,
    ).toMatchObject({
      status: "in_progress",
      detail: "Reading the auth module",
    });

    emit({
      type: "system",
      subtype: "task_notification",
      task_id: "t1",
      status: "completed",
      summary: "Found the auth entry points",
    });
    emit({ type: "result", subtype: "success", session_id: "sess_1" });
    await turn;

    const finished = events.reduce(
      applyHarnessEvent,
      newSession("claude", "/repo"),
    );
    expect(
      finished.blocks.filter((block) => block.tool?.kind === "agent"),
    ).toHaveLength(1);
    expect(
      finished.blocks.find(
        (block) => block.tool?.callId === `agent:${description}`,
      )?.tool,
    ).toMatchObject({
      status: "completed",
      detail: "Found the auth entry points",
    });
  });

  it("stays busy after a parent result while a background subagent is running", async () => {
    const { events, turn } = await startTurn("s1");
    let settled = false;
    void turn.then(() => {
      settled = true;
    });

    emit({
      type: "assistant",
      session_id: "sess_1",
      message: {
        content: [
          {
            type: "tool_use",
            id: "toolu_agent",
            name: "Agent",
            input: {
              description: "Explore the auth module",
              subagent_type: "explore",
            },
          },
        ],
      },
    });
    emit({
      type: "system",
      subtype: "task_started",
      task_id: "t1",
      tool_use_id: "toolu_agent",
      description: "Explore the auth module",
      task_type: "local_agent",
      is_backgrounded: true,
    });
    emit({
      type: "user",
      session_id: "sess_1",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu_agent",
            content: "Backgrounded",
          },
        ],
      },
    });
    emit({
      type: "result",
      subtype: "success",
      session_id: "sess_1",
    });

    await new Promise((r) => setTimeout(r, 30));
    expect(settled).toBe(false);
    expect(
      events.some(
        (event) =>
          event.type === "tool.started" &&
          event.kind === "agent" &&
          event.title === "Explore the auth module",
      ),
    ).toBe(true);
    expect(events.some((event) => event.type === "message.completed")).toBe(
      false,
    );

    emit({
      type: "system",
      subtype: "task_notification",
      task_id: "t1",
      tool_use_id: "toolu_agent",
      status: "completed",
      summary: "Found the tokens",
    });
    await turn;
    expect(settled).toBe(true);
    expect(events.some((event) => event.type === "message.completed")).toBe(
      true,
    );
  });

  it("does not end the turn on a subagent result", async () => {
    const { events, turn } = await startTurn("s1");
    let settled = false;
    void turn.then(() => {
      settled = true;
    });

    emit({
      type: "assistant",
      session_id: "sess_1",
      message: {
        content: [
          {
            type: "tool_use",
            id: "toolu_agent",
            name: "Agent",
            input: { description: "Explore", subagent_type: "explore" },
          },
        ],
      },
    });
    emit({
      type: "result",
      subtype: "success",
      session_id: "sess_sub",
      parent_tool_use_id: "toolu_agent",
    });

    await new Promise((r) => setTimeout(r, 30));
    expect(settled).toBe(false);
    expect(events.some((event) => event.type === "message.completed")).toBe(
      false,
    );

    emit({ type: "result", subtype: "success", session_id: "sess_1" });
    await turn;
    expect(settled).toBe(true);
  });

  it("does not dump subagent assistant text into the parent transcript", async () => {
    const { events, turn } = await startTurn("s1");
    emit({
      type: "assistant",
      session_id: "sess_1",
      message: {
        content: [
          {
            type: "tool_use",
            id: "toolu_agent",
            name: "Agent",
            input: { description: "Explore", subagent_type: "explore" },
          },
        ],
      },
    });
    emit({
      type: "assistant",
      parent_tool_use_id: "toolu_agent",
      message: { content: [{ type: "text", text: "I will grep for tokens" }] },
    });
    emit({ type: "result", subtype: "success", session_id: "sess_1" });
    await turn;
    expect(
      events.some(
        (event) =>
          event.type === "message.delta" &&
          event.text.includes("I will grep for tokens"),
      ),
    ).toBe(false);
  });

  it("keeps a failed subagent tool result on its tool row", async () => {
    const { events, turn } = await startTurn("s1");
    emit({
      type: "assistant",
      session_id: "sess_1",
      message: {
        content: [
          {
            type: "tool_use",
            id: "toolu_agent",
            name: "Agent",
            input: { description: "Run tests" },
          },
        ],
      },
    });
    emit({
      type: "assistant",
      parent_tool_use_id: "toolu_agent",
      message: {
        content: [
          {
            type: "tool_use",
            id: "toolu_sub_bash",
            name: "Bash",
            input: { command: "npm test" },
          },
        ],
      },
    });
    emit({
      type: "user",
      parent_tool_use_id: "toolu_agent",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu_sub_bash",
            is_error: true,
            content: [{ type: "text", text: "Tests failed: assertion error" }],
          },
        ],
      },
    });
    emit({ type: "result", subtype: "success", session_id: "sess_1" });
    await turn;

    const session = events.reduce(
      applyHarnessEvent,
      newSession("claude", "/repo"),
    );
    expect(
      session.blocks.find((block) => block.tool?.callId === "toolu_agent")
        ?.agentRun?.steps,
    ).toMatchObject([
      {
        id: "toolu_sub_bash",
        kind: "tool",
        text: "npm test",
        toolKind: "execute",
        status: "failed",
        detail: "Tests failed: assertion error",
      },
    ]);
  });
});

describe("claude plan permissions", () => {
  it("answers residual plan-mode permissions without prompting the user", async () => {
    const { events, turn } = await startTurn("s1", {
      runtimeMode: "auto",
      intent: "plan",
    });

    emit({
      type: "control_request",
      request_id: "read_1",
      request: {
        subtype: "can_use_tool",
        tool_name: "Read",
        input: { file_path: "/repo/src/App.tsx" },
      },
    });
    emit({
      type: "control_request",
      request_id: "write_1",
      request: {
        subtype: "can_use_tool",
        tool_name: "Write",
        input: { file_path: "/repo/src/new.ts" },
      },
    });

    await waitFor(
      () =>
        parse().filter((message) => message.type === "control_response")
          .length >= 2,
      "plan permission responses",
    );
    const responses = parse().filter(
      (message) => message.type === "control_response",
    );
    const read = responses.find(
      (message) =>
        (message.response as Record<string, unknown>)?.request_id === "read_1",
    );
    const write = responses.find(
      (message) =>
        (message.response as Record<string, unknown>)?.request_id === "write_1",
    );
    expect(
      (
        (read?.response as Record<string, unknown>)?.response as Record<
          string,
          unknown
        >
      )?.behavior,
    ).toBe("allow");
    expect(
      (
        (write?.response as Record<string, unknown>)?.response as Record<
          string,
          unknown
        >
      )?.behavior,
    ).toBe("deny");
    expect(events.some((event) => event.type === "approval.requested")).toBe(
      false,
    );

    emit({ type: "result", subtype: "success", session_id: "sess_1" });
    await turn;
  });
});

describe("claude manual compaction", () => {
  it("runs the built-in command and requires a compact boundary", async () => {
    const { turn } = await startTurn("s1");
    emit({ type: "result", subtype: "success", session_id: "sess_1" });
    await turn;
    sent.length = 0;

    const events: HarnessEvent[] = [];
    const compact = compactClaudeContext({
      sessionId: "s1",
      cwd: "/repo",
      model: "claude:claude-sonnet-5",
      runtimeMode: "supervised",
      onEvent: (event) => events.push(event),
    });
    await waitFor(
      () => parse().some((message) => message.type === "user"),
      "compact command",
    );
    expect(parse().find((message) => message.type === "user")).toMatchObject({
      message: { content: [{ type: "text", text: "/compact" }] },
    });

    emit({
      type: "assistant",
      session_id: "sess_1",
      message: { content: [{ type: "text", text: "not transcript output" }] },
    });
    emit({
      type: "system",
      subtype: "compact_boundary",
      session_id: "sess_1",
    });
    emit({ type: "result", subtype: "success", session_id: "sess_1" });
    await compact;

    expect(events).toContainEqual({
      type: "status",
      text: "Compacted context",
    });
    expect(events.some((event) => event.type === "message.delta")).toBe(false);
  });
});

describe("claude task tools", () => {
  function emitTaskTool(
    id: string,
    name: string,
    input: Record<string, unknown>,
    result: string,
    providerSessionId = "sess_1",
  ) {
    emit({
      type: "assistant",
      session_id: providerSessionId,
      message: { content: [{ type: "tool_use", id, name, input }] },
    });
    emit({
      type: "user",
      session_id: providerSessionId,
      message: {
        content: [{ type: "tool_result", tool_use_id: id, content: result }],
      },
    });
  }

  it("builds the task list from TaskCreate and TaskUpdate, not subagent rows", async () => {
    const { events, turn } = await startTurn("s1");
    emitTaskTool(
      "toolu_c1",
      "TaskCreate",
      { subject: "Write tests", description: "Cover the parser" },
      "Task #1 created successfully: Write tests",
    );
    emitTaskTool(
      "toolu_c2",
      "TaskCreate",
      { subject: "Ship it", description: "Open the PR" },
      "Task #2 created successfully: Ship it",
    );
    emitTaskTool(
      "toolu_u1",
      "TaskUpdate",
      { taskId: "1", status: "in_progress" },
      "Updated task #1 status",
    );
    emitTaskTool(
      "toolu_u2",
      "TaskUpdate",
      { taskId: "1", status: "completed" },
      "Updated task #1 status",
    );
    emit({ type: "result", subtype: "success", session_id: "sess_1" });
    await turn;

    const session = events.reduce(
      applyHarnessEvent,
      newSession("claude", "/repo"),
    );
    const lists = session.blocks.filter((block) => block.role === "tasks");
    expect(lists).toHaveLength(1);
    expect(lists[0].taskList?.items).toEqual([
      { id: "1", text: "Write tests", status: "completed" },
      { id: "2", text: "Ship it", status: "pending" },
    ]);
    expect(
      session.blocks.some(
        (block) => block.tool?.kind === "agent" || block.agentRun !== undefined,
      ),
    ).toBe(false);
  });

  it("keeps earlier tasks updatable after a restart resumes the conversation", async () => {
    const first = await startTurn("s1");
    emitTaskTool(
      "toolu_c1",
      "TaskCreate",
      { subject: "Write tests", description: "Cover the parser" },
      "Task #1 created successfully: Write tests",
    );
    emit({ type: "result", subtype: "success", session_id: "sess_1" });
    await first.turn;

    const events: HarnessEvent[] = [...first.events];
    const userCount = parse().filter(
      (message) => message.type === "user",
    ).length;
    const second = sendClaudeTurn({
      sessionId: "s1",
      cwd: "/repo",
      model: "claude:opus-5",
      modelSettings: {},
      runtimeMode: "supervised",
      text: "finish it",
      attachments: [],
      onEvent: (event) => events.push(event),
    });
    await waitFor(() => spawned.length === 2, "replacement Claude process");
    expect(spawned[1]).toEqual(expect.arrayContaining(["--resume", "sess_1"]));
    emit({ type: "system", subtype: "init", session_id: "sess_1" });
    await waitFor(
      () =>
        parse().filter((message) => message.type === "user").length > userCount,
      "follow-up prompt",
    );
    emitTaskTool(
      "toolu_u1",
      "TaskUpdate",
      { taskId: "1", status: "completed" },
      "Updated task #1 status",
    );
    emit({ type: "result", subtype: "success", session_id: "sess_1" });
    await second;

    const session = events.reduce(
      applyHarnessEvent,
      newSession("claude", "/repo"),
    );
    const lists = session.blocks.filter((block) => block.role === "tasks");
    expect(lists.slice(-1)[0]?.taskList?.items).toEqual([
      { id: "1", text: "Write tests", status: "completed" },
    ]);
  });

  /** A later turn that must launch a new Claude process. */
  async function restartedTurn(
    events: HarnessEvent[],
    options: {
      intent?: TurnIntent;
      providerAccountId?: string;
      providerSessionId?: string;
    } = {},
  ) {
    const spawnCount = spawned.length;
    const userCount = parse().filter(
      (message) => message.type === "user",
    ).length;
    const turn = sendClaudeTurn({
      sessionId: "s1",
      cwd: "/repo",
      model: "claude:claude-sonnet-5",
      modelSettings: {},
      runtimeMode: "supervised",
      intent: options.intent,
      providerAccountId: options.providerAccountId,
      text: "finish it",
      attachments: [],
      onEvent: (event) => events.push(event),
    });
    await waitFor(
      () => spawned.length === spawnCount + 1,
      "replacement Claude process",
    );
    emit({
      type: "system",
      subtype: "init",
      session_id: options.providerSessionId ?? "sess_1",
    });
    await waitFor(
      () =>
        parse().filter((message) => message.type === "user").length > userCount,
      "follow-up prompt",
    );
    return { turn };
  }

  function lastTaskItems(events: HarnessEvent[]) {
    const session = events.reduce(
      applyHarnessEvent,
      newSession("claude", "/repo"),
    );
    return session.blocks.filter((block) => block.role === "tasks").slice(-1)[0]
      ?.taskList?.items;
  }

  it("shows a TaskUpdate subject rename in the panel", async () => {
    const { events, turn } = await startTurn("s1");
    emitTaskTool(
      "toolu_c1",
      "TaskCreate",
      { subject: "Write tests", description: "Cover the parser" },
      "Task #1 created successfully: Write tests",
    );
    emitTaskTool(
      "toolu_u1",
      "TaskUpdate",
      { taskId: "1", subject: "Write parser tests", status: "in_progress" },
      "Updated task #1 subject, status",
    );
    emit({ type: "result", subtype: "success", session_id: "sess_1" });
    await turn;

    expect(lastTaskItems(events)).toEqual([
      { id: "1", text: "Write parser tests", status: "in_progress" },
    ]);
  });

  it("keeps earlier tasks across a plan to build restart", async () => {
    const first = await startTurn("s1", { intent: "plan" });
    emitTaskTool(
      "toolu_c1",
      "TaskCreate",
      { subject: "Write tests" },
      "Task #1 created successfully: Write tests",
    );
    emit({ type: "result", subtype: "success", session_id: "sess_1" });
    await first.turn;

    const events: HarnessEvent[] = [...first.events];
    const { turn: second } = await restartedTurn(events, { intent: "build" });
    expect(spawned[1]).toEqual(expect.arrayContaining(["--resume", "sess_1"]));
    emitTaskTool(
      "toolu_u1",
      "TaskUpdate",
      { taskId: "1", status: "completed" },
      "Updated task #1 status",
    );
    emit({ type: "result", subtype: "success", session_id: "sess_1" });
    await second;

    expect(lastTaskItems(events)).toEqual([
      { id: "1", text: "Write tests", status: "completed" },
    ]);
  });

  it("keeps earlier tasks after the Claude child exits", async () => {
    const first = await startTurn("s1");
    emitTaskTool(
      "toolu_c1",
      "TaskCreate",
      { subject: "Write tests" },
      "Task #1 created successfully: Write tests",
    );
    emit({ type: "result", subtype: "success", session_id: "sess_1" });
    await first.turn;
    onExit!(1);

    const events: HarnessEvent[] = [...first.events];
    const { turn: second } = await restartedTurn(events);
    emitTaskTool(
      "toolu_u1",
      "TaskUpdate",
      { taskId: "1", status: "completed" },
      "Updated task #1 status",
    );
    emit({ type: "result", subtype: "success", session_id: "sess_1" });
    await second;

    expect(lastTaskItems(events)).toEqual([
      { id: "1", text: "Write tests", status: "completed" },
    ]);
  });

  it("rehydrates tasks from the persisted panel after an app restart", async () => {
    const first = await startTurn("s1");
    emitTaskTool(
      "toolu_c1",
      "TaskCreate",
      { subject: "Write tests" },
      "Task #1 created successfully: Write tests",
    );
    emitTaskTool(
      "toolu_c2",
      "TaskCreate",
      { subject: "Ship it" },
      "Task #2 created successfully: Ship it",
    );
    emit({ type: "result", subtype: "success", session_id: "sess_1" });
    await first.turn;
    const restored = first.events.reduce(
      applyHarnessEvent,
      newSession("claude", "/repo"),
    );

    // App restart: all module state is gone; only the saved transcript remains.
    await stopClaudeSession("s1");
    __claudeTestReset();
    bindClaudeSession("s1", "sess_1", "/repo");
    restoreClaudeTaskLists(
      "s1",
      restored.blocks.flatMap((block) =>
        block.taskList ? [block.taskList] : [],
      ),
    );

    const events: HarnessEvent[] = [...first.events];
    const { turn: second } = await restartedTurn(events);
    expect(spawned.slice(-1)[0]).toEqual(
      expect.arrayContaining(["--resume", "sess_1"]),
    );
    emitTaskTool(
      "toolu_u1",
      "TaskUpdate",
      { taskId: "1", status: "completed" },
      "Updated task #1 status",
    );
    emitTaskTool(
      "toolu_c3",
      "TaskCreate",
      { subject: "Tag release" },
      "Task #3 created successfully: Tag release",
    );
    emit({ type: "result", subtype: "success", session_id: "sess_1" });
    await second;

    expect(lastTaskItems(events)).toEqual([
      { id: "1", text: "Write tests", status: "completed" },
      { id: "2", text: "Ship it", status: "pending" },
      { id: "3", text: "Tag release", status: "pending" },
    ]);
  });

  /** Conversation A: tasks #1 and #2 in sess_1, reduced like the saved transcript. */
  async function conversationWithTasks() {
    const first = await startTurn("s1");
    emitTaskTool(
      "toolu_c1",
      "TaskCreate",
      { subject: "Write tests" },
      "Task #1 created successfully: Write tests",
    );
    emitTaskTool(
      "toolu_c2",
      "TaskCreate",
      { subject: "Ship it" },
      "Task #2 created successfully: Ship it",
    );
    emit({ type: "result", subtype: "success", session_id: "sess_1" });
    await first.turn;
    return first.events.reduce(
      applyHarnessEvent,
      newSession("claude", "/repo"),
    );
  }

  /** Conversation B updates A's #1, then creates its own #1. */
  function emitConversationB() {
    emitTaskTool(
      "toolu_u1",
      "TaskUpdate",
      { taskId: "1", status: "completed" },
      "Updated task #1 status",
      "sess_2",
    );
    emitTaskTool(
      "toolu_c3",
      "TaskCreate",
      { subject: "Fresh task" },
      "Task #1 created successfully: Fresh task",
      "sess_2",
    );
    emit({ type: "result", subtype: "success", session_id: "sess_2" });
  }

  it("rehydrates the bound conversation's panel past a later conversation's panel", async () => {
    const restored = await conversationWithTasks();
    const lists = [
      ...restored.blocks.flatMap((block) =>
        block.taskList ? [block.taskList] : [],
      ),
      {
        key: "claude-tasks",
        providerSessionId: "sess_2",
        items: [{ id: "1", text: "Other conversation", status: "pending" as const }],
      },
    ];

    await stopClaudeSession("s1");
    __claudeTestReset();
    bindClaudeSession("s1", "sess_1", "/repo");
    restoreClaudeTaskLists("s1", lists);

    const events: HarnessEvent[] = [];
    const { turn } = await restartedTurn(events);
    emitTaskTool(
      "toolu_u1",
      "TaskUpdate",
      { taskId: "2", status: "completed" },
      "Updated task #2 status",
    );
    emit({ type: "result", subtype: "success", session_id: "sess_1" });
    await turn;

    expect(lastTaskItems(events)).toEqual([
      { id: "1", text: "Write tests", status: "pending" },
      { id: "2", text: "Ship it", status: "completed" },
    ]);
  });

  it("does not carry tasks to another conversation bound to the same thread", async () => {
    const restored = await conversationWithTasks();
    expect(
      restored.blocks.find((block) => block.role === "tasks")?.taskList
        ?.providerSessionId,
    ).toBe("sess_1");

    await stopClaudeSession("s1");
    bindClaudeSession("s1", "sess_2", "/repo");
    restoreClaudeTaskLists(
      "s1",
      restored.blocks.flatMap((block) =>
        block.taskList ? [block.taskList] : [],
      ),
    );

    const events: HarnessEvent[] = [];
    const { turn } = await restartedTurn(events, { providerSessionId: "sess_2" });
    expect(spawned.slice(-1)[0]).toEqual(
      expect.arrayContaining(["--resume", "sess_2"]),
    );
    emitConversationB();
    await turn;

    const updates = events.filter((event) => event.type === "tasks.updated");
    expect(updates).toEqual([
      expect.objectContaining({
        providerSessionId: "sess_2",
        items: [{ id: "1", text: "Fresh task", status: "pending" }],
      }),
    ]);
  });

  it("starts a clean task map when Claude reports a different conversation", async () => {
    await conversationWithTasks();

    const events: HarnessEvent[] = [];
    const turn = sendClaudeTurn({
      sessionId: "s1",
      cwd: "/repo",
      model: "claude:claude-sonnet-5",
      modelSettings: {},
      runtimeMode: "supervised",
      text: "keep going",
      attachments: [],
      onEvent: (event) => events.push(event),
    });
    await waitFor(
      () => parse().filter((message) => message.type === "user").length > 1,
      "follow-up prompt",
    );
    emitConversationB();
    await turn;

    expect(
      events.filter((event) => event.type === "tasks.updated").slice(-1)[0],
    ).toEqual(
      expect.objectContaining({
        providerSessionId: "sess_2",
        items: [{ id: "1", text: "Fresh task", status: "pending" }],
      }),
    );
  });

  it("drops the task map when the conversation cannot resume", async () => {
    const first = await startTurn("s1", { providerAccountId: "work" });
    emitTaskTool(
      "toolu_c1",
      "TaskCreate",
      { subject: "Write tests" },
      "Task #1 created successfully: Write tests",
    );
    emit({ type: "result", subtype: "success", session_id: "sess_1" });
    await first.turn;

    const events: HarnessEvent[] = [];
    const { turn: second } = await restartedTurn(events, { providerAccountId: "home" });
    expect(spawned.slice(-1)[0]).not.toContain("--resume");
    emitTaskTool(
      "toolu_u1",
      "TaskUpdate",
      { taskId: "1", status: "completed" },
      "Updated task #1 status",
    );
    emit({ type: "result", subtype: "success", session_id: "sess_1" });
    await second;

    expect(events.some((event) => event.type === "tasks.updated")).toBe(false);
  });
});
