import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeMode } from "../session";

let onStdout: ((line: string) => void) | undefined;
let onSseEvent: ((event: Record<string, unknown>) => void) | undefined;
let onSseEnd: ((error?: string) => void) | undefined;
let sessionMessages: unknown[] = [];
let openCodeVersion = "opencode 1.14.19";
/** v2 inbox ids handed out, in order, by the prompt and compact routes. */
let admittedIds: Record<string, string[]> = {};
/** Runs before an admission response returns, as a fast server would. */
let onAdmit: ((path: string, id: string | undefined) => void) | undefined;
let v2SessionDirectory = "/repo";
let v2ForkDirectory: string | undefined;
let v2MoveApplies = true;
let v2ForkFailure: { status: number; body: string } | undefined;
const spawnChild = vi.fn(async () => {
  onStdout?.("opencode server listening on http://127.0.0.1:4096");
});
const killChild = vi.fn(async () => undefined);
const closeHarnessSse = vi.fn(async (_id: string) => undefined);
const harnessHttp = vi.fn(
  async (input: {
    url: string;
    method: string;
    body?: string;
  }): Promise<{ status: number; body: string }> => {
    const url = new URL(input.url);
    // v2 reports a session's folder only under `location`.
    const v2Session = (id: string, directory: string) => ({
      status: 200,
      body: JSON.stringify({ data: { id, location: { directory } } }),
    });
    if (input.method === "POST" && url.pathname === "/api/session") {
      return v2Session("session_1", url.searchParams.get("directory") ?? "");
    }
    if (input.method === "GET" && url.pathname === "/api/session/session_1") {
      return v2Session("session_1", v2SessionDirectory);
    }
    if (
      input.method === "POST" &&
      url.pathname === "/api/session/session_1/fork"
    ) {
      if (v2ForkFailure) return v2ForkFailure;
      v2ForkDirectory = v2SessionDirectory;
      return v2Session("session_fork", v2ForkDirectory);
    }
    if (
      input.method === "POST" &&
      url.pathname === "/api/session/session_fork/move"
    ) {
      if (v2MoveApplies) {
        v2ForkDirectory = (
          JSON.parse(input.body ?? "{}") as { directory: string }
        ).directory;
      }
      return { status: 204, body: "" };
    }
    if (
      input.method === "GET" &&
      url.pathname === "/api/session/session_fork"
    ) {
      return v2Session("session_fork", v2ForkDirectory ?? "");
    }
    if (
      input.method === "GET" &&
      /^\/api\/session\/[^/]+\/message$/.test(url.pathname)
    ) {
      return { status: 200, body: JSON.stringify({ data: [] }) };
    }
    if (
      (input.method === "POST" && url.pathname === "/session") ||
      (input.method === "GET" && url.pathname === "/session/session_1")
    ) {
      return {
        status: 200,
        body: JSON.stringify({ id: "session_1", directory: "/repo" }),
      };
    }
    if (
      input.method === "GET" &&
      url.pathname === "/session/session_1/message"
    ) {
      return { status: 200, body: JSON.stringify(sessionMessages) };
    }
    const admitted =
      input.method === "POST" ? admittedIds[url.pathname]?.shift() : undefined;
    if (
      input.method === "POST" &&
      /^\/api\/session\/[^/]+\/(?:prompt|compact)$/.test(url.pathname)
    ) {
      onAdmit?.(url.pathname, admitted);
    }
    if (admitted) {
      return { status: 200, body: JSON.stringify({ data: { id: admitted } }) };
    }
    return { status: 204, body: "" };
  },
);

vi.mock("./child", () => ({
  closeHarnessSse,
  execChild: async (_command: string, args: string[]) =>
    args[0] !== "service"
      ? openCodeVersion
      : args[1] === "get"
        ? "secret"
        : "http://127.0.0.1:4096",
  freeHarnessPort: async () => 4096,
  harnessHttp,
  killChild,
  openHarnessSse: async () => undefined,
  resolveOpenCodeBinary: async () => ({ path: "/fake/opencode" }),
  spawnChild,
  unwatchChild: () => undefined,
  watchChild: (
    _id: string,
    stdout: (line: string) => void,
    _exit: (code: number | null) => void,
  ) => {
    onStdout = stdout;
  },
  watchSse: (
    _id: string,
    event: (data: string) => void,
    end?: (error?: string) => void,
  ) => {
    onSseEvent = (value) => event(JSON.stringify(value));
    onSseEnd = end;
  },
}));

const {
  __openCodeTestReset,
  bindOpenCodeSession,
  cancelOpenCodeTurn,
  compactOpenCodeContext,
  sendOpenCodeTurn,
  stopOpenCodeSession,
} = await import("./opencode");
import type { HarnessEvent } from "./types";

const waitFor = async (predicate: () => boolean, label: string) => {
  for (let index = 0; index < 200; index += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`timed out waiting for ${label}`);
};

function turn(
  events: HarnessEvent[],
  options: {
    runtimeMode?: RuntimeMode;
    onAccepted?: () => void;
    networkAllowlist?: string[];
  } = {},
) {
  return sendOpenCodeTurn({
    sessionId: "opencode-live",
    cwd: "/repo",
    model: "opencode:openrouter/anthropic/claude-sonnet-4.6",
    runtimeMode: options.runtimeMode ?? "supervised",
    text: "delegate the investigation",
    attachments: [],
    onAccepted: options.onAccepted,
    networkAllowlist: options.networkAllowlist,
    onEvent: (event) => events.push(event),
  });
}

async function startTurn(events: HarnessEvent[]) {
  const done = turn(events);
  await waitFor(
    () =>
      harnessHttp.mock.calls.some(([input]) =>
        input.url.includes("/prompt_async"),
      ),
    "prompt",
  );
  return { done };
}

function idle(sessionID = "session_1") {
  onSseEvent?.({
    type: "session.status",
    properties: { sessionID, status: { type: "idle" } },
  });
}

beforeEach(() => {
  onStdout = undefined;
  onSseEvent = undefined;
  onSseEnd = undefined;
  sessionMessages = [];
  openCodeVersion = "opencode 1.14.19";
  admittedIds = {};
  onAdmit = undefined;
  v2SessionDirectory = "/repo";
  v2ForkDirectory = undefined;
  v2MoveApplies = true;
  v2ForkFailure = undefined;
  spawnChild.mockClear();
  killChild.mockClear();
  closeHarnessSse.mockClear();
  harnessHttp.mockClear();
  __openCodeTestReset();
});

afterEach(async () => {
  await stopOpenCodeSession("opencode-live");
  __openCodeTestReset();
});

it("reports when OpenCode accepts a turn", async () => {
  const events: HarnessEvent[] = [];
  const onAccepted = vi.fn();
  const done = turn(events, { onAccepted });

  await waitFor(() => onAccepted.mock.calls.length === 1, "turn acceptance");
  idle();
  await done;
  expect(onAccepted).toHaveBeenCalledOnce();
});

it("rejects a closed v2 stream and reconnects without letting its late events finish the next turn", async () => {
  openCodeVersion = "opencode v2.0.15";
  const first = turn([]);
  await waitFor(() => harnessHttp.mock.calls.some(([input]) => input.url.includes("/prompt")), "prompt");
  const stale = onSseEvent;
  const failed = expect(first).rejects.toThrow("event stream ended");
  onSseEnd?.();
  await failed;

  harnessHttp.mockClear();
  const accepted = vi.fn();
  const events: HarnessEvent[] = [];
  const next = turn(events, { onAccepted: accepted });
  await waitFor(() => accepted.mock.calls.length > 0, "reconnected prompt");
  stale?.({ type: "session.execution.succeeded", data: { sessionID: "session_1" } });
  expect(events).not.toContainEqual({ type: "message.completed" });
  onSseEvent?.({ type: "session.execution.succeeded", data: { sessionID: "session_1" } });
  await next;
  expect(events).toContainEqual({ type: "message.completed" });
});

it("rejects a v2 network sandbox before starting or reusing the shared service", async () => {
  openCodeVersion = "opencode v2.0.15";
  await expect(turn([], { networkAllowlist: [] })).rejects.toThrow(
    "network sandbox",
  );
  expect(harnessHttp).not.toHaveBeenCalled();

  const first = turn([]);
  await waitFor(
    () =>
      harnessHttp.mock.calls.some(([input]) => input.url.includes("/prompt")),
    "prompt",
  );
  onSseEvent?.({
    type: "session.execution.succeeded",
    data: { sessionID: "session_1" },
  });
  await first;
  harnessHttp.mockClear();
  await expect(
    turn([], { networkAllowlist: ["api.example.com"] }),
  ).rejects.toThrow("network sandbox");
  expect(harnessHttp).not.toHaveBeenCalled();
});

it("keeps the v1 network sandbox on the owned server", async () => {
  const done = turn([], { networkAllowlist: ["api.example.com"] });
  await waitFor(() => spawnChild.mock.calls.length > 0, "server spawn");
  expect(spawnChild).toHaveBeenCalledWith(
    "opencode-live",
    "/fake/opencode",
    expect.any(Array),
    "/repo",
    ["api.example.com"],
  );
  idle();
  await done;
});

it("ends a 1.x turn on session.status, not the deprecated session.idle", async () => {
  const events: HarnessEvent[] = [];
  const { done } = await startTurn(events);
  let finished = false;
  void done.then(() => (finished = true));
  onSseEvent?.({
    type: "session.idle",
    properties: { sessionID: "session_1" },
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(finished).toBe(false);
  idle();
  await done;
  expect(events).toContainEqual({ type: "message.completed" });
});

it("uses the v2 API and completes from a v2 event envelope", async () => {
  openCodeVersion = "opencode v2.0.15";
  const events: HarnessEvent[] = [];
  const done = turn(events);
  await waitFor(
    () =>
      harnessHttp.mock.calls.some(
        ([input]) =>
          new URL(input.url).pathname === "/api/session/session_1/prompt",
      ),
    "v2 prompt",
  );
  expect(
    harnessHttp.mock.calls.map(([input]) => new URL(input.url).pathname),
  ).toEqual(
    expect.arrayContaining([
      "/api/session",
      "/api/session/session_1/model",
      "/api/session/session_1/agent",
      "/api/session/session_1/prompt",
    ]),
  );
  expect(spawnChild).not.toHaveBeenCalled();
  onSseEvent?.({
    id: "evt_idle",
    type: "session.idle",
    data: { sessionID: "session_1" },
  });
  await done;
  expect(events).toContainEqual({ type: "message.completed" });
});

it("renders a v2 turn streamed as session step, text, reasoning, and tool events", async () => {
  openCodeVersion = "opencode v2.0.15";
  const events: HarnessEvent[] = [];
  const done = turn(events);
  await waitFor(
    () =>
      harnessHttp.mock.calls.some(
        ([input]) =>
          new URL(input.url).pathname === "/api/session/session_1/prompt",
      ),
    "v2 prompt",
  );
  const sessionID = "session_1";
  const model = { id: "mimo-v2.6-flash-free", providerID: "opencode" };
  const send = (type: string, data: Record<string, unknown>) =>
    onSseEvent?.({ id: `evt_${type}`, type, data: { sessionID, ...data } });

  send("session.execution.started", {});
  send("session.step.started", {
    agent: "build",
    model,
    assistantMessageID: "msg_a",
  });
  send("session.reasoning.started", {
    assistantMessageID: "msg_a",
    ordinal: 0,
  });
  send("session.reasoning.delta", {
    assistantMessageID: "msg_a",
    ordinal: 0,
    delta: "Plan it.",
  });
  send("session.tool.input.started", {
    assistantMessageID: "msg_a",
    id: "call_1",
    name: "shell",
  });
  send("session.reasoning.ended", {
    assistantMessageID: "msg_a",
    ordinal: 0,
    text: "Plan it.",
  });
  send("session.tool.called", {
    assistantMessageID: "msg_a",
    id: "call_1",
    input: { command: "echo MONOCODE_TOOL_TEST" },
  });
  send("session.tool.success", {
    assistantMessageID: "msg_a",
    id: "call_1",
    content: [{ type: "text", text: "MONOCODE_TOOL_TEST\n" }],
    metadata: { status: "completed", exit: 0 },
  });
  send("session.step.ended", {
    assistantMessageID: "msg_a",
    finish: "tool-calls",
    tokens: {
      input: 100,
      output: 5,
      reasoning: 2,
      cache: { read: 50, write: 0 },
    },
  });
  send("session.step.started", {
    agent: "build",
    model,
    assistantMessageID: "msg_b",
  });
  send("session.text.started", { assistantMessageID: "msg_b", ordinal: 0 });
  send("session.text.delta", {
    assistantMessageID: "msg_b",
    ordinal: 0,
    delta: "DO",
  });
  send("session.text.delta", {
    assistantMessageID: "msg_b",
    ordinal: 0,
    delta: "NE",
  });
  send("session.text.ended", {
    assistantMessageID: "msg_b",
    ordinal: 0,
    text: "DONE",
  });
  send("session.step.ended", { assistantMessageID: "msg_b", finish: "stop" });
  send("session.execution.succeeded", {});
  await done;

  const text = events
    .filter((event) => event.type === "message.delta")
    .map((event) => (event as { text: string }).text)
    .join("");
  expect(text).toBe("DONE");
  expect(events).toContainEqual({ type: "reasoning.delta", text: "Plan it." });
  expect(events).toContainEqual(
    expect.objectContaining({
      type: "tool.started",
      callId: "call_1",
      kind: "shell",
    }),
  );
  expect(events).toContainEqual(
    expect.objectContaining({
      type: "tool.updated",
      callId: "call_1",
      status: "completed",
      detail: "MONOCODE_TOOL_TEST\n",
    }),
  );
  expect(events).toContainEqual(expect.objectContaining({ type: "context" }));
  expect(events).toContainEqual({ type: "message.completed" });
});

it("surfaces a failed v2 execution as a session error", async () => {
  openCodeVersion = "opencode v2.0.15";
  const events: HarnessEvent[] = [];
  const done = turn(events);
  await waitFor(
    () =>
      harnessHttp.mock.calls.some(
        ([input]) =>
          new URL(input.url).pathname === "/api/session/session_1/prompt",
      ),
    "v2 prompt",
  );
  onSseEvent?.({
    type: "session.execution.failed",
    data: {
      sessionID: "session_1",
      error: { type: "provider", message: "Rate limited" },
    },
  });
  await done.catch(() => undefined);
  expect(events).toContainEqual({
    type: "session.error",
    message: "Rate limited",
  });
});

describe("OpenCode 2.x resumed session folders", () => {
  const paths = () =>
    harnessHttp.mock.calls.map(
      ([input]) => `${input.method} ${new URL(input.url).pathname}`,
    );
  const resumeTurn = async (events: HarnessEvent[] = []) => {
    bindOpenCodeSession("opencode-live", "session_1", "/repo");
    const done = turn(events);
    await waitFor(
      () =>
        paths().some((path) => path.endsWith("/prompt")) ||
        events.some((e) => e.type === "session.error"),
      "prompt",
    );
    onSseEvent?.({
      type: "session.execution.succeeded",
      data: {
        sessionID: paths().some((p) => p.includes("session_fork/prompt"))
          ? "session_fork"
          : "session_1",
      },
    });
    return done;
  };

  beforeEach(() => {
    openCodeVersion = "opencode v2.0.19";
  });

  it("adopts a session that already works in the current folder", async () => {
    v2SessionDirectory = "/repo/";
    await resumeTurn();
    expect(paths()).toContain("POST /api/session/session_1/prompt");
    expect(paths().some((path) => path.includes("/fork"))).toBe(false);
  });

  it("forks a session from another folder and moves the fork here", async () => {
    v2SessionDirectory = "/repo-old-worktree";
    const events: HarnessEvent[] = [];
    await resumeTurn(events);
    const move = harnessHttp.mock.calls.find(
      ([input]) =>
        new URL(input.url).pathname === "/api/session/session_fork/move",
    );
    expect(JSON.parse(move?.[0].body ?? "{}")).toMatchObject({
      directory: "/repo",
    });
    expect(paths()).toContain("POST /api/session/session_fork/prompt");
    expect(paths()).not.toContain("POST /api/session/session_1/move");
    expect(paths()).not.toContain("POST /api/session/session_1/prompt");
    expect(events).toContainEqual({
      type: "session.providerBound",
      providerSessionId: "session_fork",
    });
  });

  it("deletes the fork and fails when the move does not take effect", async () => {
    v2SessionDirectory = "/repo-old-worktree";
    v2MoveApplies = false;
    bindOpenCodeSession("opencode-live", "session_1", "/repo");
    await expect(turn([])).rejects.toThrow("did not move the forked session");
    expect(paths()).toContain("DELETE /api/session/session_fork");
    expect(paths().some((path) => path.endsWith("/prompt"))).toBe(false);
  });

  it("starts a new session when the other folder's session has no history", async () => {
    v2SessionDirectory = "/repo-old-worktree";
    v2ForkFailure = {
      status: 400,
      body: JSON.stringify({
        _tag: "InvalidRequestError",
        message: "Cannot fork empty session: session_1",
        kind: "empty_session",
      }),
    };
    await resumeTurn();
    const create = harnessHttp.mock.calls.find(
      ([input]) =>
        input.method === "POST" &&
        new URL(input.url).pathname === "/api/session",
    );
    expect(JSON.parse(create?.[0].body ?? "{}")).toMatchObject({
      location: { directory: "/repo" },
    });
  });
});

describe("OpenCode 2.x completion correlation", () => {
  const PROMPT = "/api/session/session_1/prompt";
  const COMPACT = "/api/session/session_1/compact";
  const v2 = (type: string, data: Record<string, unknown> = {}) =>
    onSseEvent?.({
      id: `evt_${type}`,
      type,
      data: { sessionID: "session_1", ...data },
    });
  const calls = (path: string) =>
    harnessHttp.mock.calls.filter(
      ([input]) => new URL(input.url).pathname === path,
    ).length;
  const settled = (promise: Promise<unknown>) => {
    let done = false;
    promise.then(
      () => (done = true),
      () => (done = true),
    );
    return () => done;
  };
  const drain = () => new Promise((resolve) => setTimeout(resolve, 20));
  const replyText = (events: HarnessEvent[]) =>
    events
      .filter((event) => event.type === "message.delta")
      .map((event) => (event as { text: string }).text)
      .join("");
  const compact = (events: HarnessEvent[]) =>
    compactOpenCodeContext({
      sessionId: "opencode-live",
      cwd: "/repo",
      model: "opencode:openrouter/anthropic/claude-sonnet-4.6",
      runtimeMode: "supervised",
      onEvent: (event) => events.push(event),
    });

  beforeEach(() => {
    openCodeVersion = "opencode v2.0.19";
  });

  it("does not let a stopped run's late interrupt finish the next turn", async () => {
    admittedIds[PROMPT] = ["msg_first", "msg_second"];
    const first = turn([]);
    await waitFor(() => calls(PROMPT) === 1, "first prompt");
    await drain();
    v2("session.execution.started");
    v2("session.inbox.delivered", { inboxID: "msg_first" });
    await cancelOpenCodeTurn("opencode-live");
    await first;

    // The interrupt response returns before its event; the event lands while
    // the next prompt is being admitted.
    onAdmit = (_path, id) => {
      if (id === "msg_second")
        v2("session.execution.interrupted", { reason: "user" });
    };
    const events: HarnessEvent[] = [];
    const second = turn(events);
    const secondDone = settled(second);
    await waitFor(() => calls(PROMPT) === 2, "second prompt");
    await drain();
    v2("session.execution.interrupted", { reason: "user" });
    await drain();
    expect(secondDone()).toBe(false);
    expect(events).not.toContainEqual({ type: "message.completed" });

    v2("session.execution.started");
    v2("session.inbox.delivered", { inboxID: "msg_second" });
    v2("session.text.delta", {
      assistantMessageID: "msg_reply",
      delta: "SECOND_DONE",
    });
    v2("session.execution.succeeded");
    await second;
    expect(replyText(events)).toBe("SECOND_DONE");
    expect(events).toContainEqual({ type: "message.completed" });
  });

  it("finishes a run that completed before its admission response", async () => {
    admittedIds[PROMPT] = ["msg_fast"];
    onAdmit = (_path, id) => {
      v2("session.execution.started");
      v2("session.inbox.delivered", { inboxID: id });
      v2("session.text.delta", {
        assistantMessageID: "msg_reply",
        delta: "FAST",
      });
      v2("session.execution.succeeded");
    };
    const events: HarnessEvent[] = [];
    await turn(events);
    expect(replyText(events)).toBe("FAST");
    expect(events).toContainEqual({ type: "message.completed" });
  });

  describe.each(["with an inbox id", "without an inbox id"])(
    "early completion %s",
    (admission) => {
      it.each(["succeeded", "failed", "interrupted"])(
        "preserves an early %s event when delivery is not reported",
        async (execution) => {
          if (admission === "with an inbox id") {
            admittedIds[PROMPT] = ["msg_fast"];
          }
          onAdmit = () => {
            v2("session.text.delta", {
              assistantMessageID: "msg_reply",
              delta: "FAST",
            });
            v2(`session.execution.${execution}`, {
              error: { message: "Rate limited" },
              reason: "shutdown",
            });
          };
          const events: HarnessEvent[] = [];
          const done = turn(events);
          const finished = settled(done);
          await waitFor(finished, "early terminal completion");
          await done;
          expect(replyText(events)).toBe("FAST");
          if (execution === "failed") {
            expect(events).toContainEqual({
              type: "session.error",
              message: "Rate limited",
            });
          } else {
            expect(events).toContainEqual({ type: "message.completed" });
          }
        },
      );
    },
  );

  it("keeps early completion with delivery but no admission id", async () => {
    onAdmit = () => {
      v2("session.inbox.delivered", { inboxID: "msg_fast" });
      v2("session.execution.succeeded");
    };
    const events: HarnessEvent[] = [];
    const done = turn(events);
    await waitFor(settled(done), "id-less early completion");
    await done;
    expect(events).toContainEqual({ type: "message.completed" });
  });

  it("preserves the first early outcome instead of a later idle event", async () => {
    admittedIds[PROMPT] = ["msg_fail"];
    onAdmit = () => {
      v2("session.execution.failed", { error: { message: "Rate limited" } });
      v2("session.idle");
    };
    const events: HarnessEvent[] = [];
    const done = turn(events);
    await waitFor(settled(done), "first early outcome");
    await done;
    expect(events).toContainEqual({
      type: "session.error",
      message: "Rate limited",
    });
    expect(events).not.toContainEqual({ type: "message.completed" });
  });

  it("does not replay an uncorrelated early outcome when delivery becomes available", async () => {
    admittedIds[PROMPT] = ["msg_current"];
    onAdmit = () => {
      v2("session.execution.interrupted", { reason: "user" });
      v2("session.inbox.delivered", { inboxID: "msg_current" });
    };
    const events: HarnessEvent[] = [];
    const done = turn(events);
    const finished = settled(done);
    await waitFor(() => calls(PROMPT) === 1, "prompt");
    await drain();
    expect(finished()).toBe(false);
    expect(events).not.toContainEqual({ type: "message.completed" });

    v2("session.text.delta", {
      assistantMessageID: "msg_reply",
      delta: "CURRENT",
    });
    v2("session.execution.succeeded");
    await done;
    expect(replyText(events)).toBe("CURRENT");
  });

  it("reports a failed run as a session error", async () => {
    admittedIds[PROMPT] = ["msg_fail"];
    const events: HarnessEvent[] = [];
    const done = turn(events);
    await waitFor(() => calls(PROMPT) === 1, "prompt");
    await drain();
    v2("session.inbox.delivered", { inboxID: "msg_fail" });
    v2("session.execution.failed", { error: { message: "Rate limited" } });
    await done;
    expect(events).toContainEqual({
      type: "session.error",
      message: "Rate limited",
    });
  });

  it("ends the active turn on a v2 session error and shows the message", async () => {
    admittedIds[PROMPT] = ["msg_boom"];
    const events: HarnessEvent[] = [];
    const done = turn(events);
    await waitFor(() => calls(PROMPT) === 1, "prompt");
    await drain();
    v2("session.error", { error: { message: "Provider exploded" } });
    await done;
    expect(events).toContainEqual({
      type: "session.error",
      message: "Provider exploded",
    });
  });

  it("shows a stale failed run between turns without finishing the next turn", async () => {
    admittedIds[PROMPT] = ["msg_first", "msg_second"];
    const firstEvents: HarnessEvent[] = [];
    const first = turn(firstEvents);
    await waitFor(() => calls(PROMPT) === 1, "first prompt");
    await drain();
    v2("session.execution.started");
    v2("session.inbox.delivered", { inboxID: "msg_first" });
    v2("session.execution.succeeded");
    await first;

    v2("session.execution.failed", { error: { message: "Late failure" } });
    expect(firstEvents).toContainEqual({
      type: "session.error",
      message: "Late failure",
    });

    const events: HarnessEvent[] = [];
    const second = turn(events);
    const secondDone = settled(second);
    await waitFor(() => calls(PROMPT) === 2, "second prompt");
    await drain();
    expect(secondDone()).toBe(false);

    v2("session.execution.started");
    v2("session.inbox.delivered", { inboxID: "msg_second" });
    v2("session.text.delta", {
      assistantMessageID: "msg_reply",
      delta: "SECOND_DONE",
    });
    v2("session.execution.succeeded");
    await second;
    expect(replyText(events)).toBe("SECOND_DONE");
    expect(events).not.toContainEqual(
      expect.objectContaining({ type: "session.error" }),
    );
  });

  it("keeps uncorrelated completion when the server never reports delivery", async () => {
    admittedIds[PROMPT] = ["msg_untracked"];
    const done = turn([]);
    await waitFor(() => calls(PROMPT) === 1, "prompt");
    await drain();
    v2("session.execution.succeeded");
    await done;
  });

  it("waits for compaction to end before sending the next prompt", async () => {
    admittedIds[COMPACT] = ["msg_compact"];
    admittedIds[PROMPT] = ["msg_after"];
    const compaction = compact([]);
    const compacted = settled(compaction);
    await waitFor(() => calls(COMPACT) === 1, "compact");
    await drain();
    v2("session.execution.started");
    v2("session.inbox.delivered", { inboxID: "msg_compact" });
    v2("session.compaction.started", {
      reason: "manual",
      inputID: "msg_compact",
    });

    const events: HarnessEvent[] = [];
    const next = turn(events);
    await drain();
    expect(compacted()).toBe(false);
    expect(calls(PROMPT)).toBe(0);

    v2("session.compaction.ended", { reason: "manual", text: "summary" });
    await compaction;
    await waitFor(() => calls(PROMPT) === 1, "prompt after compaction");
    await drain();
    // The compaction's execution goes on to run the queued prompt.
    v2("session.inbox.delivered", { inboxID: "msg_after" });
    v2("session.text.delta", {
      assistantMessageID: "msg_reply",
      delta: "AFTER",
    });
    v2("session.execution.succeeded");
    await next;
    expect(replyText(events)).toBe("AFTER");
  });

  it("waits for compaction to end when admission returns no inbox id", async () => {
    const compaction = compact([]);
    const compacted = settled(compaction);
    await waitFor(() => calls(COMPACT) === 1, "compact");
    await drain();
    expect(compacted()).toBe(false);
    v2("session.compaction.ended", { reason: "manual", text: "summary" });
    await compaction;
  });

  describe.each(["with an inbox id", "without an inbox id"])(
    "early compaction %s",
    (admission) => {
      it.each(["ended", "failed"])(
        "preserves an early compaction.%s event when delivery is not reported",
        async (outcome) => {
          if (admission === "with an inbox id") {
            admittedIds[COMPACT] = ["msg_compact"];
          }
          onAdmit = () => {
            v2(`session.compaction.${outcome}`, {
              error: { message: "Context too large" },
            });
          };
          const done = compact([]);
          await waitFor(settled(done), "early compaction completion");
          if (outcome === "failed") {
            await expect(done).rejects.toThrow("Context too large");
          } else {
            await done;
          }
        },
      );
    },
  );

  it("fails compaction when OpenCode reports a compaction failure", async () => {
    admittedIds[COMPACT] = ["msg_compact"];
    const compaction = compact([]);
    await waitFor(() => calls(COMPACT) === 1, "compact");
    await drain();
    v2("session.inbox.delivered", { inboxID: "msg_compact" });
    v2("session.compaction.failed", {
      reason: "manual",
      inputID: "msg_compact",
      error: { message: "Context too large" },
    });
    await expect(compaction).rejects.toThrow("Context too large");
  });

  it("fails compaction when its run is interrupted before it ends", async () => {
    admittedIds[COMPACT] = ["msg_compact"];
    const compaction = compact([]);
    await waitFor(() => calls(COMPACT) === 1, "compact");
    await drain();
    v2("session.inbox.delivered", { inboxID: "msg_compact" });
    v2("session.compaction.started", {
      reason: "manual",
      inputID: "msg_compact",
    });
    v2("session.execution.interrupted", { reason: "shutdown" });
    await expect(compaction).rejects.toThrow("interrupted");
  });

  it("settles compaction when the user stops it", async () => {
    admittedIds[COMPACT] = ["msg_compact"];
    const compaction = compact([]);
    await waitFor(() => calls(COMPACT) === 1, "compact");
    await drain();
    await cancelOpenCodeTurn("opencode-live");
    await compaction;
  });

  it("fails compaction when the event stream ends", async () => {
    admittedIds[COMPACT] = ["msg_compact"];
    const compaction = compact([]);
    await waitFor(() => calls(COMPACT) === 1, "compact");
    await drain();
    onSseEnd?.("stream closed");
    await expect(compaction).rejects.toThrow("stream closed");
  });
});
