import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sent: string[] = [];
let onLine: ((line: string) => void) | undefined;

vi.mock("./child", () => ({
  resolveCursorBinary: async () => ({ path: "/fake/cursor-agent" }),
  spawnChild: async () => undefined,
  killChild: async () => undefined,
  unwatchChild: () => undefined,
  watchChild: (_id: string, line: (value: string) => void) => {
    onLine = line;
  },
  writeChild: async (_id: string, line: string) => {
    sent.push(line);
  },
}));

vi.mock("./cursorStore", () => ({
  readStoredCursorToolCalls: async () => [],
}));

const { sendCursorTurn, stopCursorSession, __cursorTestReset } =
  await import("./cursor");
import type { HarnessEvent } from "./types";

function parse() {
  return sent.map((line) => JSON.parse(line) as Record<string, unknown>);
}

function reply(id: number, result: unknown) {
  onLine!(JSON.stringify({ jsonrpc: "2.0", id, result }));
}

function notify(method: string, params: unknown) {
  onLine!(JSON.stringify({ jsonrpc: "2.0", method, params }));
}

function request(id: number, method: string, params: unknown) {
  onLine!(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
}

const waitFor = async (pred: () => boolean, label: string) => {
  for (let i = 0; i < 200; i++) {
    if (pred()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(
    `timed out waiting for ${label}; sent=${JSON.stringify(parse())}`,
  );
};

function outboundRequest(method: string) {
  return parse().find((message) => message.method === method);
}

async function startTurn(sessionId: string) {
  const events: HarnessEvent[] = [];
  const turn = sendCursorTurn({
    sessionId,
    cwd: "/repo",
    model: "cursor:composer-2.5",
    modelSettings: {},
    runtimeMode: "supervised",
    text: "explore the codebase",
    attachments: [],
    onEvent: (event) => events.push(event),
  });

  await waitFor(() => !!outboundRequest("initialize"), "initialize");
  reply(outboundRequest("initialize")!.id as number, {});

  await waitFor(() => !!outboundRequest("authenticate"), "authenticate");
  reply(outboundRequest("authenticate")!.id as number, {});

  await waitFor(() => !!outboundRequest("session/new"), "session/new");
  reply(outboundRequest("session/new")!.id as number, {
    sessionId: "cursor_1",
    configOptions: [
      {
        id: "model",
        category: "model",
        currentValue: "composer-2.5",
      },
    ],
  });

  await waitFor(() => !!outboundRequest("session/prompt"), "session/prompt");
  const promptId = outboundRequest("session/prompt")!.id as number;
  return { events, promptId, turn };
}

function emitAgentStart() {
  notify("session/update", {
    sessionId: "cursor_1",
    update: {
      sessionUpdate: "tool_call",
      toolCallId: "call_agent",
      title: "Task: Explore auth",
      kind: "other",
      status: "pending",
      rawInput: {
        _toolName: "task",
        description: "Explore auth",
        subagentType: "explore",
      },
    },
  });
}

function agentEvents(events: HarnessEvent[]) {
  return events.filter(
    (event) => event.type === "tool.updated" && event.callId === "call_agent",
  );
}

beforeEach(() => {
  sent.length = 0;
  onLine = undefined;
  __cursorTestReset();
});

afterEach(async () => {
  await stopCursorSession("cursor-live");
  __cursorTestReset();
});

describe("cursor background subagents", () => {
  it("emits Cursor todo updates as structured task lists", async () => {
    const { events, promptId, turn } = await startTurn("cursor-live");
    notify("cursor/update_todos", {
      todos: [
        { content: "Inspect", status: "completed" },
        { content: "Implement", status: "in_progress" },
      ],
    });
    expect(events.at(-1)).toEqual({
      type: "tasks.updated",
      items: [
        { text: "Inspect", status: "completed" },
        { text: "Implement", status: "in_progress" },
      ],
    });
    reply(promptId, { stopReason: "end_turn" });
    await turn;
  });

  it("keeps an ACP background task active until the prompt completes", async () => {
    const { events, promptId, turn } = await startTurn("cursor-live");
    let settled = false;
    void turn.then(() => {
      settled = true;
    });

    emitAgentStart();
    notify("session/update", {
      sessionId: "cursor_1",
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: "call_agent",
        status: "completed",
        rawOutput: { isBackground: true },
      },
    });

    expect(agentEvents(events).at(-1)).toMatchObject({
      type: "tool.updated",
      title: "Explore auth",
      kind: "agent",
      status: "in_progress",
    });
    expect(settled).toBe(false);
    expect(events.some((event) => event.type === "message.completed")).toBe(
      false,
    );

    reply(promptId, { stopReason: "end_turn" });
    await turn;

    expect(agentEvents(events).at(-1)).toMatchObject({
      type: "tool.updated",
      kind: "agent",
      status: "completed",
    });
    expect(settled).toBe(true);
    expect(events.some((event) => event.type === "message.completed")).toBe(
      true,
    );
  });

  it("uses Cursor's task request when raw ACP output omits the background flag", async () => {
    const { events, promptId, turn } = await startTurn("cursor-live");
    emitAgentStart();
    notify("session/update", {
      sessionId: "cursor_1",
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: "call_agent",
        status: "completed",
      },
    });
    request(99, "cursor/task", {
      toolCallId: "call_agent",
      description: "Explore auth",
      subagentType: "explore",
      agentId: "child_1",
    });

    expect(agentEvents(events).at(-1)).toMatchObject({
      type: "tool.updated",
      title: "Explore auth",
      kind: "agent",
      status: "in_progress",
      detail: "explore subagent",
    });
    await waitFor(
      () => parse().some((message) => message.id === 99 && "result" in message),
      "cursor/task response",
    );

    reply(promptId, { stopReason: "end_turn" });
    await turn;
    expect(agentEvents(events).at(-1)).toMatchObject({ status: "completed" });
  });

  it("does not reopen a foreground task after Cursor reports its duration", async () => {
    const { events, promptId, turn } = await startTurn("cursor-live");
    emitAgentStart();
    notify("session/update", {
      sessionId: "cursor_1",
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: "call_agent",
        status: "completed",
        rawOutput: { isBackground: false, durationMs: 25 },
      },
    });
    request(100, "cursor/task", {
      toolCallId: "call_agent",
      description: "Explore auth",
      subagentType: "explore",
      agentId: "child_1",
      durationMs: 25,
    });

    expect(agentEvents(events).at(-1)).toMatchObject({
      type: "tool.updated",
      kind: "agent",
      status: "completed",
    });

    reply(promptId, { stopReason: "end_turn" });
    await turn;
    expect(agentEvents(events).at(-1)).toMatchObject({ status: "completed" });
  });
});
