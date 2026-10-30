import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  it,
  vi,
} from "vitest";
import {
  __claudeTestReset,
  cancelClaudeTurn,
  compactClaudeContext,
  respondClaudeApproval,
  respondClaudeQuestion,
  sendClaudeTurn,
  steerClaudeTurn,
  stopClaudeSession,
} from "@/modules/harness/lib/harness/claude";
import * as childApi from "@/modules/harness/lib/harness/child";
import type {
  HarnessEvent,
  SendTurnInput,
} from "@/modules/harness/lib/harness/types";

type Call = { command: string; args: Record<string, unknown> };
const calls: Call[] = [];
const listeners = new Map<string, (event: { payload: unknown }) => void>();
const processes = new Map<string, number>();
const providers = new Map<string, string>();
const ids = new Set<string>();
let nextPid = 100;
let releaseBridge: (() => void) | undefined;
let binary: (() => Promise<{ path: string }>) | undefined;
let spawn: ((id: string) => Promise<void>) | undefined;
let write:
  | ((id: string, message: Record<string, unknown>) => Promise<void>)
  | undefined;
let kill: ((id: string) => Promise<void>) | undefined;
let autoResult = true;
const SID = "claude-owned";
function observed<T>(promise: Promise<T>): Promise<T> {
  void promise.catch(() => {});
  return promise;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = observed(
    new Promise<T>((yes, no) => {
      resolve = yes;
      reject = no;
    }),
  );
  return { promise, resolve, reject };
}
async function flush() {
  for (let i = 0; i < 150; i += 1) await Promise.resolve();
}
function invocations(command: string) {
  return calls.filter((call) => call.command === command);
}
function lastId() {
  return String(invocations("harness_spawn").slice(-1)[0]?.args.sessionId);
}
function emit(id: string, record: unknown) {
  listeners.get("harness-stdout")?.({
    payload: { sessionId: id, line: JSON.stringify(record) },
  });
}
function result(id: string) {
  emit(id, {
    type: "result",
    subtype: "success",
    session_id: providers.get(id),
  });
}
function request(id: string, name = "Bash") {
  emit(id, {
    type: "control_request",
    request_id: "wire-request",
    request: {
      subtype: "can_use_tool",
      tool_name: name,
      input:
        name === "AskUserQuestion"
          ? {
              questions: [
                {
                  question: "Choose",
                  options: [{ label: "One", description: "First" }],
                },
              ],
            }
          : { command: "echo fixture" },
    },
  });
}
function inputs(id?: string) {
  return invocations("harness_write").filter(
    (call) =>
      (!id || call.args.sessionId === id) &&
      JSON.parse(String(call.args.line)).type === "user",
  );
}
function replies(id?: string) {
  return invocations("harness_write").filter(
    (call) =>
      (!id || call.args.sessionId === id) &&
      JSON.parse(String(call.args.line)).type === "control_response",
  );
}
function input(
  text = "hello",
  events: HarnessEvent[] = [],
  sessionId = SID,
): SendTurnInput {
  ids.add(sessionId);
  return {
    sessionId,
    cwd: "/repo",
    model: "claude:claude-sonnet-5",
    modelSettings: { effort: "high" },
    runtimeMode: "supervised",
    text,
    attachments: [],
    onEvent: (event) => events.push(event),
  };
}
beforeAll(async () => {
  childApi.configureChildBackend({
    async invoke<T>(
      command: string,
      args: Record<string, unknown> = {},
    ): Promise<T> {
      calls.push({ command, args });
      const id = String(args.sessionId);
      if (command === "harness_resolve_claude")
        return (await (binary?.() ??
          Promise.resolve({ path: "/synthetic/claude" }))) as T;
      if (command === "harness_spawn") {
        const pid = nextPid++;
        const argv = args.args as string[];
        const resumeAt = argv.indexOf("--resume");
        providers.set(
          id,
          resumeAt >= 0 ? argv[resumeAt + 1] : `provider-${id}`,
        );
        await spawn?.(id);
        processes.set(id, pid);
        return pid as T;
      }
      if (command === "harness_write") {
        const message = JSON.parse(String(args.line));
        if (
          message.type === "control_request" &&
          message.request?.subtype === "initialize"
        )
          emit(id, {
            type: "system",
            subtype: "init",
            session_id: providers.get(id),
          });
        if (message.type === "user" && autoResult) result(id);
        await write?.(id, message);
      }
      if (command === "harness_kill") {
        await kill?.(id);
        processes.delete(id);
      }
      if (command === "harness_kill_all") processes.clear();
      return undefined as T;
    },
    async listen<T>(event: string, handler: (event: { payload: T }) => void) {
      listeners.set(event, handler as (event: { payload: unknown }) => void);
      return () => {
        listeners.delete(event);
      };
    },
  });
  releaseBridge = await childApi.acquireHarnessBridge();
});
afterAll(() => releaseBridge?.());
beforeEach(() => {
  calls.length = 0;
  providers.clear();
  ids.clear();
  binary = undefined;
  spawn = undefined;
  write = undefined;
  kill = undefined;
  autoResult = true;
});
afterEach(async () => {
  binary = undefined;
  spawn = undefined;
  write = undefined;
  kill = undefined;
  vi.restoreAllMocks();
  await Promise.all([...ids].map((id) => stopClaudeSession(id)));
  await childApi.killAllChildren();
  __claudeTestReset();
});

it("uses an opaque process with the original logical control identity and named account", async () => {
  await sendClaudeTurn({ ...input(), providerAccountId: "work" });
  await sendClaudeTurn({ ...input("again"), providerAccountId: "work" });
  const started = invocations("harness_spawn");
  expect(started).toHaveLength(1);
  expect(started[0].args).toMatchObject({
    logicalSessionId: SID,
    cwd: "/repo",
    account: { provider: "claude", id: "work" },
  });
  expect(started[0].args.sessionId).not.toBe(SID);
  expect(inputs().map((call) => call.args.sessionId)).toEqual([
    lastId(),
    lastId(),
  ]);
});

it("coalesces cold startup before binary resolution and keeps queued callbacks separate", async () => {
  const held = deferred<{ path: string }>();
  binary = () => held.promise;
  autoResult = false;
  const eventsA: HarnessEvent[] = [];
  const eventsB: HarnessEvent[] = [];
  const a = observed(sendClaudeTurn(input("A", eventsA)));
  const b = observed(sendClaudeTurn(input("B", eventsB)));
  await flush();
  expect(invocations("harness_resolve_claude")).toHaveLength(1);
  held.resolve({ path: "/synthetic/claude" });
  await flush();
  const id = lastId();
  expect(inputs()).toHaveLength(1);
  emit(id, {
    type: "assistant",
    message: { content: [{ type: "text", text: "A response" }] },
  });
  expect(eventsA).toContainEqual({ type: "message.delta", text: "A response" });
  expect(eventsB).toEqual([]);
  result(id);
  await a;
  await flush();
  expect(inputs()).toHaveLength(2);
  result(id);
  await b;
});

it("retires held opening A and queued A1 while a replacement and sibling proceed", async () => {
  const held = deferred<{ path: string }>();
  binary = () => held.promise;
  const a = observed(sendClaudeTurn(input("A")));
  const a1 = observed(sendClaudeTurn(input("A1")));
  await flush();
  await stopClaudeSession(SID);
  binary = undefined;
  await sendClaudeTurn(input("B"));
  const b = lastId();
  await sendClaudeTurn(input("C", [], "sibling"));
  held.resolve({ path: "/synthetic/claude" });
  await expect(a).rejects.toThrow(/retired/);
  await expect(a1).rejects.toThrow(/retired/);
  expect(invocations("harness_spawn")).toHaveLength(2);
  expect(processes.has(b)).toBe(true);
});

it("snapshots input and launch configuration before binary resolution", async () => {
  const held = deferred<{ path: string }>();
  binary = () => held.promise;
  const requestInput = {
    ...input("original"),
    providerAccountId: "work",
    networkAllowlist: ["a.example"],
    attachments: [
      {
        id: "file",
        name: "file",
        kind: "file" as const,
        mimeType: "text/plain",
        size: 1,
        path: "/original",
      },
    ],
  };
  const turn = observed(sendClaudeTurn(requestInput));
  await flush();
  requestInput.sessionId = "changed";
  requestInput.cwd = "/changed";
  requestInput.text = "changed";
  requestInput.model = "changed";
  requestInput.providerAccountId = "other";
  requestInput.networkAllowlist[0] = "b.example";
  requestInput.attachments[0].path = "/changed";
  if (requestInput.modelSettings) requestInput.modelSettings.effort = "low";
  held.resolve({ path: "/synthetic/claude" });
  await turn;
  const started = invocations("harness_spawn")[0].args;
  expect(started).toMatchObject({
    logicalSessionId: SID,
    cwd: "/repo",
    networkAllowlist: ["a.example"],
    account: { provider: "claude", id: "work" },
  });
  expect(started.args).toContain("high");
  expect(String(inputs()[0].args.line)).toContain("original");
  expect(String(inputs()[0].args.line)).not.toContain("changed");
});

it("ignores old stdout and positive PID exit after replacement without changing its resume binding", async () => {
  autoResult = false;
  const a = observed(sendClaudeTurn(input("A")));
  await flush();
  const old = lastId();
  const pid = processes.get(old);
  await stopClaudeSession(SID);
  await a;
  const events: HarnessEvent[] = [];
  const b = observed(sendClaudeTurn(input("B", events)));
  await flush();
  const current = lastId();
  const provider = providers.get(current);
  emit(old, { type: "system", subtype: "init", session_id: "stale" });
  result(old);
  listeners.get("harness-exit")?.({
    payload: { sessionId: old, pid, code: 0 },
  });
  expect(
    events.some(
      (event) =>
        event.type === "session.ended" ||
        (event.type === "session.providerBound" &&
          event.providerSessionId === "stale"),
    ),
  ).toBe(false);
  result(current);
  await b;
  await stopClaudeSession(SID);
  autoResult = true;
  await sendClaudeTurn(input("resume"));
  expect(invocations("harness_spawn").slice(-1)[0]?.args.args).toContain(
    provider,
  );
});

it("late spawn settlement closes only the captured process before and after spawn", async () => {
  const held = deferred<void>();
  spawn = () => held.promise;
  const a = observed(sendClaudeTurn(input("A")));
  await flush();
  const old = lastId();
  const stopped = observed(stopClaudeSession(SID));
  await flush();
  spawn = undefined;
  await sendClaudeTurn(input("B"));
  const b = lastId();
  held.resolve();
  await stopped;
  await expect(a).rejects.toThrow(/retired/);
  expect(
    invocations("harness_kill").filter((call) => call.args.sessionId === old),
  ).toHaveLength(2);
  expect(processes.has(old)).toBe(false);
  expect(processes.has(b)).toBe(true);
});

it("an old native write failure cannot close the replacement or publish errors into it", async () => {
  const held = deferred<void>();
  write = async (_id, message) => {
    if (message.type === "user") await held.promise;
  };
  const a = observed(sendClaudeTurn(input("A")));
  await flush();
  await stopClaudeSession(SID);
  write = undefined;
  const events: HarnessEvent[] = [];
  await sendClaudeTurn(input("B", events));
  const b = lastId();
  held.reject(new Error("old write"));
  await a;
  expect(events.some((event) => event.type === "session.error")).toBe(false);
  await sendClaudeTurn(input("B2"));
  expect(lastId()).toBe(b);
});

it("rejects an unexpected current native exit instead of treating it as cancellation", async () => {
  autoResult = false;
  const turn = observed(sendClaudeTurn(input()));
  await flush();
  const id = lastId();
  listeners.get("harness-exit")?.({
    payload: { sessionId: id, pid: processes.get(id), code: 1 },
  });
  await expect(turn).rejects.toThrow("Claude Code exited");
});

it.each(["approval", "question"])(
  "registers a %s before its reentrant response callback",
  async (kind) => {
    autoResult = false;
    const requestInput = input();
    requestInput.onEvent = (event) => {
      if (event.type === "approval.requested")
        respondClaudeApproval(SID, event.requestId, "allow");
      if (event.type === "question.asked")
        respondClaudeQuestion(SID, event.requestId, {
          kind: "answered",
          answers: { "0": ["One"] },
        });
    };
    const turn = observed(sendClaudeTurn(requestInput));
    await flush();
    const id = lastId();
    request(id, kind === "question" ? "AskUserQuestion" : "Bash");
    await flush();
    expect(replies(id)).toHaveLength(1);
    expect(
      JSON.parse(String(replies(id)[0].args.line)).response.response.behavior,
    ).toBe("allow");
    result(id);
    await turn;
  },
);

it.each(["approval", "question"])(
  "retires a %s before callbacks can leave a pending reply in a successor",
  async (kind) => {
    autoResult = false;
    const requestInput = input();
    requestInput.onEvent = (event) => {
      if (
        event.type === "approval.requested" ||
        event.type === "question.asked"
      )
        void stopClaudeSession(SID);
    };
    const turn = observed(sendClaudeTurn(requestInput));
    await flush();
    const old = lastId();
    request(old, kind === "question" ? "AskUserQuestion" : "Bash");
    await flush();
    await turn;
    autoResult = true;
    await sendClaudeTurn(input("B"));
    expect(replies()).toEqual([]);
    expect(processes.has(lastId())).toBe(true);
  },
);

it("does not let a stale approval UI id authorize a replacement's request", async () => {
  autoResult = false;
  const eventsA: HarnessEvent[] = [];
  const a = observed(sendClaudeTurn(input("A", eventsA)));
  await flush();
  request(lastId());
  await flush();
  const oldRequest = eventsA.find(
    (event) => event.type === "approval.requested",
  );
  if (oldRequest?.type !== "approval.requested")
    throw new Error("Missing approval");
  await stopClaudeSession(SID);
  await a;
  const eventsB: HarnessEvent[] = [];
  const b = observed(sendClaudeTurn(input("B", eventsB)));
  await flush();
  const id = lastId();
  request(id);
  await flush();
  const nextRequest = eventsB.find(
    (event) => event.type === "approval.requested",
  );
  if (nextRequest?.type !== "approval.requested")
    throw new Error("Missing next approval");
  expect(nextRequest.requestId).not.toBe(oldRequest.requestId);
  respondClaudeApproval(SID, oldRequest.requestId, "allow");
  await flush();
  expect(replies(id)).toEqual([]);
  respondClaudeApproval(SID, nextRequest.requestId, "deny");
  await flush();
  expect(replies(id)).toHaveLength(1);
  result(id);
  await b;
});

it("drains a captured interrupt before the fresh FIFO input and discards queued pre-cancel inputs", async () => {
  autoResult = false;
  const a = observed(sendClaudeTurn(input("A")));
  await flush();
  const id = lastId();
  const queued = observed(sendClaudeTurn(input("old queued")));
  await flush();
  const held = deferred<void>();
  write = async (_id, message) => {
    if (
      (message.request as Record<string, unknown> | undefined)?.subtype ===
      "interrupt"
    )
      await held.promise;
  };
  const stopped = observed(cancelClaudeTurn(SID));
  await flush();
  const fresh = observed(sendClaudeTurn(input("fresh")));
  await flush();
  expect(inputs(id)).toHaveLength(1);
  held.resolve();
  await stopped;
  await a;
  await queued;
  await flush();
  expect(inputs(id)).toHaveLength(2);
  expect(String(inputs(id)[1].args.line)).toContain("fresh");
  result(id);
  await fresh;
});

it("an old pending cancel cannot settle the replacement's active turn", async () => {
  autoResult = false;
  const a = observed(sendClaudeTurn(input("A")));
  await flush();
  const held = deferred<void>();
  write = async (_id, message) => {
    if (
      (message.request as Record<string, unknown> | undefined)?.subtype ===
      "interrupt"
    )
      await held.promise;
  };
  const cancelled = observed(cancelClaudeTurn(SID));
  await flush();
  await stopClaudeSession(SID);
  write = undefined;
  await a;
  let complete = false;
  const b = observed(sendClaudeTurn(input("B"))).then(() => {
    complete = true;
  });
  await flush();
  const id = lastId();
  held.resolve();
  await cancelled;
  await flush();
  expect(complete).toBe(false);
  result(id);
  await b;
});

it("uses the captured process for steering and manual compaction", async () => {
  autoResult = false;
  const turn = observed(sendClaudeTurn(input()));
  await flush();
  const id = lastId();
  await steerClaudeTurn({
    sessionId: SID,
    cwd: "/repo",
    model: "claude:claude-sonnet-5",
    text: "steer",
  });
  expect(inputs(id)).toHaveLength(2);
  result(id);
  await turn;
  const compact = observed(compactClaudeContext(input()));
  await flush();
  expect(String(inputs(id).slice(-1)[0]?.args.line)).toContain("/compact");
  emit(id, { type: "system", subtype: "compact_boundary" });
  result(id);
  await compact;
  expect(invocations("harness_spawn")).toHaveLength(1);
});

it("rejects a returned retired admission when predecessor cleanup synchronously stops it", async () => {
  const old = childApi.reserveRawChild(SID);
  await old.spawn("/synthetic/claude", [], "/repo");
  let entered = false;
  let stopped: Promise<void> | undefined;
  kill = async (id) => {
    if (id === old.nativeId && !entered) {
      entered = true;
      stopped = stopClaudeSession(SID);
    }
  };
  await expect(sendClaudeTurn(input())).rejects.toThrow(/retired/);
  await stopped;
  expect(inputs()).toEqual([]);
  expect(invocations("harness_spawn")).toHaveLength(1);
});

it("rolls back only its own failed raw reservation and preserves a warm actor", async () => {
  await sendClaudeTurn(input());
  const id = lastId();
  vi.spyOn(childApi, "reserveRawChild").mockImplementationOnce(() => {
    throw new Error("capacity");
  });
  await expect(
    sendClaudeTurn({ ...input("new settings"), model: "claude:opus-5" }),
  ).rejects.toThrow("capacity");
  await sendClaudeTurn(input("original settings"));
  expect(lastId()).toBe(id);
  expect(processes.has(id)).toBe(true);
});

it("does not overwrite a successor admitted reentrantly by predecessor cleanup", async () => {
  const old = childApi.reserveRawChild(SID);
  await old.spawn("/synthetic/claude", [], "/repo");
  let entered = false;
  let successor: Promise<void> | undefined;
  kill = async (id) => {
    if (id === old.nativeId && !entered) {
      entered = true;
      successor = observed(sendClaudeTurn(input("successor")));
    }
  };
  await expect(sendClaudeTurn(input("retired"))).rejects.toThrow(/retired/);
  await successor;
  expect(inputs()).toHaveLength(1);
  expect(String(inputs()[0].args.line)).toContain("successor");
  expect(processes.has(lastId())).toBe(true);
});

it("retains an interrupt write failure as a barrier until explicit stop", async () => {
  autoResult = false;
  const a = observed(sendClaudeTurn(input("A")));
  await flush();
  const id = lastId();
  const failure = new Error("interrupt write failed");
  write = async (_id, message) => {
    if (
      (message.request as Record<string, unknown> | undefined)?.subtype ===
      "interrupt"
    )
      throw failure;
  };
  await cancelClaudeTurn(SID);
  await a;
  await expect(sendClaudeTurn(input("blocked"))).rejects.toBe(failure);
  expect(inputs(id)).toHaveLength(1);
  await stopClaudeSession(SID);
  autoResult = true;
  write = undefined;
  await sendClaudeTurn(input("after stop"));
  expect(lastId()).not.toBe(id);
});

it("converts an allowed approval to a captured denial when its resolution callback cancels", async () => {
  autoResult = false;
  const requestInput = input();
  requestInput.onEvent = (event) => {
    if (event.type === "approval.requested")
      respondClaudeApproval(SID, event.requestId, "allow");
    if (event.type === "approval.resolved") void cancelClaudeTurn(SID);
  };
  const turn = observed(sendClaudeTurn(requestInput));
  await flush();
  const id = lastId();
  request(id);
  await flush();
  await turn;
  expect(replies(id)).toHaveLength(1);
  expect(
    JSON.parse(String(replies(id)[0].args.line)).response.response.behavior,
  ).toBe("deny");
});

it("does not mutate retained tasks after a tool callback replaces the actor", async () => {
  autoResult = false;
  let replacement: Promise<void> | undefined;
  const events: HarnessEvent[] = [];
  const requestInput = input();
  requestInput.onEvent = (event) => {
    if (event.type === "tool.updated" && event.callId === "create-task")
      replacement = observed(
        sendClaudeTurn({
          ...input("replacement", events),
          model: "claude:opus-5",
        }),
      );
  };
  const original = observed(sendClaudeTurn(requestInput));
  await flush();
  const old = lastId();
  emit(old, {
    type: "assistant",
    message: {
      content: [
        {
          type: "tool_use",
          id: "create-task",
          name: "TaskCreate",
          input: { subject: "retired task" },
        },
      ],
    },
  });
  emit(old, {
    type: "user",
    message: {
      content: [
        {
          type: "tool_result",
          tool_use_id: "create-task",
          content: "Task #1 created successfully: retired task",
        },
      ],
    },
  });
  await original;
  await flush();
  const id = lastId();
  emit(id, {
    type: "assistant",
    message: {
      content: [
        {
          type: "tool_use",
          id: "update-task",
          name: "TaskUpdate",
          input: { taskId: "1", status: "completed" },
        },
      ],
    },
  });
  emit(id, {
    type: "user",
    message: {
      content: [
        {
          type: "tool_result",
          tool_use_id: "update-task",
          content: "Updated task #1 status",
        },
      ],
    },
  });
  result(id);
  await replacement;
  expect(events.some((event) => event.type === "tasks.updated")).toBe(false);
});

it("bounds cold admissions by the shared raw quota and frees retired openings without waiting for binary IO", async () => {
  const held = deferred<{ path: string }>();
  binary = () => held.promise;
  const work = Array.from({ length: 256 }, (_, index) =>
    observed(sendClaudeTurn(input("pending", [], `quota-${index}`))),
  );
  await flush();
  await expect(
    sendClaudeTurn(input("overflow", [], "quota-overflow")),
  ).rejects.toThrow("HARNESS_RAW_CHILD_CAPACITY");
  await Promise.all([...ids].map((id) => stopClaudeSession(id)));
  binary = undefined;
  await sendClaudeTurn(input("available"));
  held.resolve({ path: "/synthetic/claude" });
  const outcomes = await Promise.allSettled(work);
  expect(outcomes.every((outcome) => outcome.status === "rejected")).toBe(true);
  expect(inputs()).toHaveLength(1);
});

it("retains a provider binding reported before native spawn finishes", async () => {
  spawn = async (id) => {
    providers.set(id, "early-provider");
    emit(id, { type: "system", subtype: "init", session_id: "early-provider" });
  };
  await sendClaudeTurn(input());
  await stopClaudeSession(SID);
  spawn = undefined;
  await sendClaudeTurn(input("resume"));
  expect(invocations("harness_spawn").slice(-1)[0].args.args).toContain(
    "early-provider",
  );
});

it.each(["binary", "spawn", "initialization"])(
  "retires cancellation during %s without admitting old input or blocking a replacement",
  async (stage) => {
    const held = deferred<void>();
    if (stage === "binary")
      binary = async () => {
        await held.promise;
        return { path: "/synthetic/claude" };
      };
    if (stage === "spawn") spawn = () => held.promise;
    if (stage === "initialization")
      write = async (_id, message) => {
        if (
          (message.request as Record<string, unknown> | undefined)?.subtype ===
          "initialize"
        )
          await held.promise;
      };
    const old = observed(sendClaudeTurn(input("old")));
    await flush();
    const cancelled = observed(cancelClaudeTurn(SID));
    await flush();
    binary = undefined;
    spawn = undefined;
    write = undefined;
    await sendClaudeTurn(input("replacement"));
    const id = lastId();
    held.resolve();
    await cancelled;
    await expect(old).rejects.toThrow(/retired/);
    expect(inputs()).toHaveLength(1);
    expect(String(inputs()[0].args.line)).toContain("replacement");
    expect(processes.has(id)).toBe(true);
  },
);

it.each(["session.providerBound", "session.started"] as const)(
  "rejects startup after its %s callback retires the original admission",
  async (eventType) => {
    const requestInput = input();
    requestInput.onEvent = (event) => {
      if (event.type === eventType) void stopClaudeSession(SID);
    };
    await expect(sendClaudeTurn(requestInput)).rejects.toThrow(/retired/);
    expect(inputs()).toEqual([]);
  },
);

it.each(["user", "initialize"])(
  "retains a failed %s writer and prevents warm or changed-settings reuse until stop",
  async (kind) => {
    const failure = new Error("captured native writer failed");
    write = async (_id, message) => {
      if (
        kind === "user"
          ? message.type === "user"
          : (message.request as Record<string, unknown> | undefined)
              ?.subtype === "initialize"
      )
        throw failure;
    };
    await expect(sendClaudeTurn(input())).rejects.toBe(failure);
    const id = lastId();
    const count = invocations("harness_write").length;
    await expect(sendClaudeTurn(input("warm"))).rejects.toBe(failure);
    await expect(
      sendClaudeTurn({
        ...input("changed"),
        model: "claude:opus-5",
        cwd: "/other",
      }),
    ).rejects.toBe(failure);
    expect(invocations("harness_spawn")).toHaveLength(1);
    expect(invocations("harness_write")).toHaveLength(count);
    expect(invocations("harness_kill")).toEqual([]);
    expect(processes.has(id)).toBe(true);
    write = undefined;
    await sendClaudeTurn(input("sibling", [], "sibling"));
    await stopClaudeSession(SID);
    await sendClaudeTurn(input("after stop"));
    expect(lastId()).not.toBe(id);
  },
);

it.each([
  "approval",
  "question",
  "plan",
  "full access",
  "unknown control",
  "exit plan",
])(
  "observes a %s response writer failure even when its legacy caller catches it",
  async (kind) => {
    autoResult = false;
    const failure = new Error("control response failed");
    write = async (_id, message) => {
      if (message.type === "control_response") throw failure;
    };
    const requestInput = input();
    if (kind === "plan") requestInput.intent = "plan";
    if (kind === "full access") requestInput.runtimeMode = "full-access";
    requestInput.onEvent = (event) => {
      if (event.type === "approval.requested")
        respondClaudeApproval(SID, event.requestId, "allow");
      if (event.type === "question.asked")
        respondClaudeQuestion(SID, event.requestId, {
          kind: "answered",
          answers: { "0": ["One"] },
        });
    };
    const turn = observed(sendClaudeTurn(requestInput));
    await flush();
    const id = lastId();
    if (kind === "unknown control")
      emit(id, {
        type: "control_request",
        request_id: "unknown",
        request: { subtype: "unknown" },
      });
    else
      request(
        id,
        kind === "question"
          ? "AskUserQuestion"
          : kind === "plan"
            ? "Read"
            : kind === "exit plan"
              ? "ExitPlanMode"
              : "Bash",
      );
    await flush();
    result(id);
    await expect(turn).rejects.toBe(failure);
    await expect(sendClaudeTurn(input("blocked"))).rejects.toBe(failure);
    expect(replies(id)).toHaveLength(1);
    expect(processes.has(id)).toBe(true);
    expect(invocations("harness_kill")).toEqual([]);
  },
);

it.each([false, true])(
  "a late UI writer failure blocks the same actor's new turn after ordinary completion or cancel=%s",
  async (cancelled) => {
    autoResult = false;
    const held = deferred<void>();
    const failure = new Error("late UI writer");
    write = async (_id, message) => {
      if (message.type === "control_response") await held.promise;
    };
    const requestInput = input("first");
    requestInput.onEvent = (event) => {
      if (event.type === "approval.requested")
        respondClaudeApproval(SID, event.requestId, "allow");
    };
    let firstDone = false;
    const first = observed(sendClaudeTurn(requestInput)).then(() => {
      firstDone = true;
    });
    await flush();
    const id = lastId();
    request(id);
    await flush();
    if (cancelled) await cancelClaudeTurn(SID);
    else result(id);
    await first;
    const next = observed(sendClaudeTurn(input("next")));
    await flush();
    expect(inputs(id)).toHaveLength(2);
    held.reject(failure);
    await flush();
    await expect(next).rejects.toBe(failure);
    expect(firstDone).toBe(true);
    await expect(sendClaudeTurn(input("blocked"))).rejects.toBe(failure);
    expect(processes.has(id)).toBe(true);
  },
);

it("a retired UI writer cannot poison a replacement while retaining its own physical settlement", async () => {
  autoResult = false;
  const held = deferred<void>();
  write = async (_id, message) => {
    if (message.type === "control_response") await held.promise;
  };
  const requestInput = input();
  requestInput.onEvent = (event) => {
    if (event.type === "approval.requested")
      respondClaudeApproval(SID, event.requestId, "allow");
  };
  const first = observed(sendClaudeTurn(requestInput));
  await flush();
  const old = lastId();
  request(old);
  await flush();
  result(old);
  await first;
  await stopClaudeSession(SID);
  write = undefined;
  const next = observed(sendClaudeTurn(input("replacement")));
  await flush();
  const id = lastId();
  held.reject(new Error("old UI write"));
  await flush();
  result(id);
  await next;
  autoResult = true;
  await sendClaudeTurn(input("still usable"));
  expect(lastId()).toBe(id);
  expect(inputs(id)).toHaveLength(2);
});

it("retains the first failure across multiple actual pending writers", async () => {
  autoResult = false;
  const heldA = deferred<void>();
  const heldB = deferred<void>();
  let count = 0;
  write = async (_id, message) => {
    if (message.type === "control_response") {
      count += 1;
      await (count === 1 ? heldA.promise : heldB.promise);
    }
  };
  const requestInput = input();
  requestInput.onEvent = (event) => {
    if (event.type === "approval.requested")
      respondClaudeApproval(SID, event.requestId, "allow");
  };
  const first = observed(sendClaudeTurn(requestInput));
  await flush();
  const id = lastId();
  request(id);
  request(id);
  await flush();
  result(id);
  await first;
  expect(replies(id)).toHaveLength(2);
  const firstError = new Error("first failure");
  heldA.reject(firstError);
  await flush();
  heldB.reject(new Error("second failure"));
  await flush();
  await expect(sendClaudeTurn(input("blocked"))).rejects.toBe(firstError);
});

it("blocks post-failure frames and controls without corrupting the provider binding", async () => {
  const events: HarnessEvent[] = [];
  write = async (_id, message) => {
    if (message.type === "user") throw new Error("failed input");
  };
  await expect(sendClaudeTurn(input("failed", events))).rejects.toThrow(
    "failed input",
  );
  const id = lastId();
  const provider = providers.get(id);
  const count = events.length;
  emit(id, { type: "system", subtype: "init", session_id: "foreign-provider" });
  emit(id, {
    type: "assistant",
    message: { content: [{ type: "text", text: "late" }] },
  });
  request(id);
  result(id);
  await flush();
  expect(events).toHaveLength(count);
  expect(replies(id)).toEqual([]);
  write = undefined;
  await stopClaudeSession(SID);
  await sendClaudeTurn(input("resume"));
  expect(invocations("harness_spawn").slice(-1)[0].args.args).toContain(
    provider,
  );
});

it("reclaims a failed admission on its genuine native exit", async () => {
  write = async (_id, message) => {
    if (message.type === "user") throw new Error("failed input");
  };
  await expect(sendClaudeTurn(input())).rejects.toThrow("failed input");
  const id = lastId();
  listeners.get("harness-exit")?.({
    payload: { sessionId: id, pid: processes.get(id), code: 1 },
  });
  await flush();
  write = undefined;
  await sendClaudeTurn(input("after exit"));
  expect(lastId()).not.toBe(id);
});

it("charges actual writers through result, retirement and cleanup instead of freeing the 256-write quota early", async () => {
  autoResult = false;
  const held = deferred<void>();
  write = async (_id, message) => {
    if (message.type === "user") await held.promise;
  };
  const work: Promise<void>[] = [observed(sendClaudeTurn(input()))];
  try {
    await flush();
    const id = lastId();
    for (let index = 0; index < 255; index += 1)
      work.push(
        observed(
          steerClaudeTurn({
            sessionId: SID,
            cwd: "/repo",
            model: "claude:claude-sonnet-5",
            text: `steer-${index}`,
          }),
        ),
      );
    await flush();
    expect(inputs(id)).toHaveLength(256);
    await expect(
      steerClaudeTurn({
        sessionId: SID,
        cwd: "/repo",
        model: "claude:claude-sonnet-5",
        text: "overflow",
      }),
    ).rejects.toThrow("write capacity");
    expect(inputs(id)).toHaveLength(256);
    result(id);
    await stopClaudeSession(SID);
    write = undefined;
    await expect(sendClaudeTurn(input("still full"))).rejects.toThrow(
      "write capacity",
    );
    held.resolve();
    await Promise.allSettled(work);
    await stopClaudeSession(SID);
    autoResult = true;
    await sendClaudeTurn(input("capacity recovered"));
    expect(inputs()).toHaveLength(257);
  } finally {
    await stopClaudeSession(SID);
    held.resolve();
    await Promise.allSettled(work);
  }
});

it.each(["steer", "compact"])(
  "blocks the exact actor after an actual %s input writer failure",
  async (kind) => {
    autoResult = false;
    const first = observed(sendClaudeTurn(input("first")));
    await flush();
    const id = lastId();
    if (kind === "compact") {
      result(id);
      await first;
    }
    const failure = new Error(`${kind} input failed`);
    write = async (_id, message) => {
      if (message.type === "user") throw failure;
    };
    if (kind === "steer") {
      await expect(
        steerClaudeTurn({
          sessionId: SID,
          cwd: "/repo",
          model: "claude:claude-sonnet-5",
          text: "steer",
        }),
      ).rejects.toBe(failure);
      await expect(first).rejects.toBe(failure);
    } else await expect(compactClaudeContext(input())).rejects.toBe(failure);
    await expect(sendClaudeTurn(input("blocked"))).rejects.toBe(failure);
    expect(inputs(id)).toHaveLength(2);
    expect(processes.has(id)).toBe(true);
    expect(invocations("harness_kill")).toEqual([]);
  },
);

it("normalizes a non-Error actual writer failure once and retains that same barrier", async () => {
  write = async (_id, message) => {
    if (message.type === "user")
      return Promise.reject("synthetic write rejection");
  };
  const error = await sendClaudeTurn(input()).catch(
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(Error);
  expect(error).toMatchObject({ message: "synthetic write rejection" });
  await expect(sendClaudeTurn(input("blocked"))).rejects.toBe(error);
});
