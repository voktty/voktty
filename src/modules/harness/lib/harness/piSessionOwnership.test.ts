import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import * as child from "./child";
import {
  bindSession,
  cancelTurn,
  compactContext,
  forgetSession,
  respondApproval,
  respondQuestion,
  rewindLastTurn,
  sendTurn,
  setPiBinaryResolver,
  steerTurn,
  stopSession,
} from "./piFamily";
import { OMP_FLAVOR, PI_FLAVOR, type PiFlavor } from "./piFlavor";
import type { HarnessEvent, SendTurnInput } from "./types";

type Call = { command: string; args: Record<string, unknown> };
const calls: Call[] = [];
const listeners = new Map<string, (event: { payload: unknown }) => void>();
const processes = new Map<string, number>();
const pids = new Map<string, number>();
let pid = 100;
let release: (() => void) | undefined;
let spawn: ((id: string) => Promise<void>) | undefined;
let kill: ((id: string) => Promise<void>) | undefined;
let stage:
  | ((id: string, command: Record<string, unknown>) => boolean)
  | undefined;
let autoPrompt = true;
function observed<T>(p: Promise<T>) {
  void p.catch(() => undefined);
  return p;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = observed(
    new Promise<T>((yes) => {
      resolve = yes;
    }),
  );
  return { promise, resolve };
}
async function flush() {
  for (let i = 0; i < 100; i++) await Promise.resolve();
}
function invokeCalls(command: string) {
  return calls.filter((c) => c.command === command);
}
function lastId() {
  const rows = invokeCalls("harness_spawn");
  return String(rows[rows.length - 1]?.args.sessionId);
}
function frame(id: string, value: Record<string, unknown>) {
  listeners.get("harness-stdout")?.({
    payload: { sessionId: id, line: JSON.stringify(value) },
  });
}
function response(
  id: string,
  command: Record<string, unknown>,
  data: unknown = {},
) {
  frame(id, {
    type: "response",
    id: command.id,
    command: command.type,
    success: true,
    data,
  });
}
function input(
  flavor: PiFlavor,
  events: HarnessEvent[] = [],
  text = "hello",
  sessionId = "owned-pi",
): SendTurnInput {
  return {
    sessionId,
    cwd: "/repo",
    model: `${flavor.id}:default`,
    runtimeMode: "supervised",
    text,
    onEvent: (e) => events.push(e),
  };
}
beforeAll(async () => {
  child.configureChildBackend({
    async invoke<T>(
      command: string,
      args: Record<string, unknown> = {},
    ): Promise<T> {
      calls.push({ command, args });
      const id = String(args.sessionId);
      if (command === "harness_spawn") {
        const next = pid++;
        pids.set(id, next);
        await spawn?.(id);
        processes.set(id, next);
        return next as T;
      }
      if (command === "harness_kill") {
        await kill?.(id);
        processes.delete(id);
      }
      if (command === "harness_write") {
        const req = JSON.parse(String(args.line));
        if (stage?.(id, req)) return undefined as T;
        if (req.type === "extension_ui_response") return undefined as T;
        response(
          id,
          req,
          req.type === "get_state"
            ? {
                sessionId: `provider_${id.replace(/-/g, "_")}`,
                thinkingLevel: "off",
              }
            : req.type === "get_fork_messages"
              ? { messages: [{ entryId: "entry", text: "old" }] }
              : req.type === "compact"
                ? { estimatedTokensAfter: 42 }
                : {},
        );
        if (req.type === "prompt" && autoPrompt)
          frame(id, { type: "agent_settled" });
      }
      return undefined as T;
    },
    async listen<T>(event: string, handler: (event: { payload: T }) => void) {
      listeners.set(event, handler as (event: { payload: unknown }) => void);
      return () => {
        listeners.delete(event);
      };
    },
  });
  release = await child.acquireHarnessBridge();
});
afterAll(() => release?.());
beforeEach(() => {
  calls.length = 0;
  stage = undefined;
  spawn = undefined;
  kill = undefined;
  autoPrompt = true;
  for (const flavor of [PI_FLAVOR, OMP_FLAVOR])
    setPiBinaryResolver(flavor, async () => ({ path: `/fake/${flavor.id}` }));
});
afterEach(async () => {
  vi.restoreAllMocks();
  stage = undefined;
  spawn = undefined;
  kill = undefined;
  for (const flavor of [PI_FLAVOR, OMP_FLAVOR])
    for (const id of ["owned-pi", "sibling", "mutated"])
      await forgetSession(flavor, id);
});

describe.each([PI_FLAVOR, OMP_FLAVOR])("$id captured ownership", (flavor) => {
  it("uses opaque process handles, consecutive turns, plan and resume controls", async () => {
    const req = input(flavor);
    req.intent = "plan";
    await observed(sendTurn(flavor, req));
    await observed(sendTurn(flavor, req));
    const call = invokeCalls("harness_spawn")[0];
    expect(call.args.logicalSessionId).toBe(req.sessionId);
    expect(call.args.sessionId).not.toBe(req.sessionId);
    expect(invokeCalls("harness_spawn")).toHaveLength(1);
    expect(call.args.args).toContain(flavor.planTools.join(","));
    await stopSession(flavor, req.sessionId);
    await observed(sendTurn(flavor, req));
    expect(invokeCalls("harness_spawn")[1].args.args).toContain(
      flavor.resumeFlag,
    );
  });
  it("deduplicates held binary A and queued A1, retires them before B and sibling progress", async () => {
    const held = deferred<{ path: string }>();
    let resolutions = 0;
    setPiBinaryResolver(flavor, () => {
      resolutions++;
      return held.promise;
    });
    const a = observed(sendTurn(flavor, input(flavor)));
    const a1 = observed(sendTurn(flavor, input(flavor, [], "A1")));
    await flush();
    await stopSession(flavor, "owned-pi");
    setPiBinaryResolver(flavor, async () => ({ path: "/fake/new" }));
    await observed(sendTurn(flavor, input(flavor, [], "B")));
    const b = lastId();
    await observed(sendTurn(flavor, input(flavor, [], "sibling", "sibling")));
    held.resolve({ path: "/fake/old" });
    await flush();
    await expect(a).rejects.toThrow(/retired/i);
    await expect(a1).rejects.toThrow(/retired/i);
    expect(resolutions).toBe(1);
    expect(invokeCalls("harness_spawn")).toHaveLength(2);
    expect(processes.has(b)).toBe(true);
  });
  it("same retained actor cancellation suppresses held model continuation", async () => {
    const warm = input(flavor);
    warm.modelSettings = { thinking: "off" };
    await observed(sendTurn(flavor, warm));
    const nativeId = lastId();
    let held: Record<string, unknown> | undefined;
    stage = (id, command) => {
      if (id === nativeId && command.type === "set_model") {
        held = command;
        return true;
      }
      return false;
    };
    const staleEvents: HarnessEvent[] = [];
    const request = input(flavor, staleEvents, "stale");
    request.model = `${flavor.id}:provider/new`;
    request.modelSettings = { thinking: "high" };
    let accepted = 0;
    request.onAccepted = () => accepted++;
    const action = observed(sendTurn(flavor, request));
    await flush();
    if (!held) throw new Error("Missing held model request");
    await cancelTurn(flavor, request.sessionId);
    const writesBefore = invokeCalls("harness_write").length;
    const eventsBefore = staleEvents.length;
    stage = undefined;
    response(nativeId, held);
    await action.catch(() => undefined);
    await flush();
    expect(invokeCalls("harness_write")).toHaveLength(writesBefore);
    expect(staleEvents).toHaveLength(eventsBefore);
    expect(accepted).toBe(0);
    expect(processes.has(nativeId)).toBe(true);
    expect(invokeCalls("harness_spawn")).toHaveLength(1);
  });
  it("snapshots queued high thinking and callback across a held model setter for only its owner", async () => {
    const events: HarnessEvent[] = [];
    const warm = input(flavor, events);
    warm.modelSettings = { thinking: "off" };
    warm.networkAllowlist = ["a.example"];
    await observed(sendTurn(flavor, warm));
    const old = lastId();
    const oldPid = pids.get(old);
    if (!oldPid || oldPid <= 0) throw new Error("Missing positive owner PID");
    let held: Record<string, unknown> | undefined;
    stage = (id, command) => {
      if (id === old && command.type === "set_model") {
        held = command;
        return true;
      }
      return false;
    };
    const req = input(flavor, events, "original");
    req.model = `${flavor.id}:provider/new`;
    req.modelSettings = { thinking: "high" };
    req.attachments = [
      {
        id: "image",
        name: "image",
        kind: "image",
        mimeType: "image/png",
        size: 1,
        data: "original",
      },
    ];
    const turn = observed(sendTurn(flavor, req));
    await flush();
    expect(held).toBeDefined();
    req.sessionId = "mutated";
    req.cwd = "/mutated";
    req.text = "mutated";
    req.modelSettings.thinking = "low";
    req.attachments[0].data = "mutated";
    const mutatedEvents: HarnessEvent[] = [];
    req.onEvent = (event) => mutatedEvents.push(event);
    stage = undefined;
    if (!held) throw new Error("Missing held request");
    response(old, held);
    await turn;
    const commands = invokeCalls("harness_write")
      .filter((c) => c.args.sessionId === old)
      .map((c) => JSON.parse(String(c.args.line)));
    expect(commands).toContainEqual(
      expect.objectContaining({ type: "set_thinking_level", level: "high" }),
    );
    expect(commands).not.toContainEqual(
      expect.objectContaining({ type: "set_thinking_level", level: "low" }),
    );
    expect(commands).toContainEqual(
      expect.objectContaining({
        type: "prompt",
        message: "original",
        images: [{ type: "image", mimeType: "image/png", data: "original" }],
      }),
    );
    expect(mutatedEvents).toEqual([]);
    expect(events.some((event) => event.type === "message.completed")).toBe(
      true,
    );
    await observed(sendTurn(flavor, input(flavor, [], "sibling", "sibling")));
    const sibling = lastId();
    expect(sibling).not.toBe(old);
    expect(
      invokeCalls("harness_write")
        .filter((c) => c.args.sessionId === sibling)
        .map((c) => JSON.parse(String(c.args.line))),
    ).not.toContainEqual(
      expect.objectContaining({ type: "set_thinking_level", level: "high" }),
    );
  });
  it("external Core retirement lets B advance while binary A is held and suppresses late A", async () => {
    const held = deferred<{ path: string }>();
    const original = child.reserveRawChild;
    const handles: child.RawChildHandle[] = [];
    vi.spyOn(child, "reserveRawChild").mockImplementation((id) => {
      const handle = original(id);
      handles.push(handle);
      return handle;
    });
    setPiBinaryResolver(flavor, () => held.promise);
    const oldEvents: HarnessEvent[] = [];
    const a = observed(sendTurn(flavor, input(flavor, oldEvents, "A")));
    const resultA = a.then(
      () => "resolved",
      (error: unknown) => error,
    );
    await flush();
    const old = handles[0];
    const external = original("owned-pi");
    setPiBinaryResolver(flavor, async () => ({ path: "/fake/B" }));
    let bSettled = false;
    const b = observed(sendTurn(flavor, input(flavor, [], "B")));
    void b.then(
      () => {
        bSettled = true;
      },
      () => undefined,
    );
    await flush();
    const current = lastId();
    const currentPid = pids.get(current);
    const before = oldEvents.length;
    const progressedWhileHeld = bSettled;
    held.resolve({ path: "/fake/A" });
    await resultA;
    await b.catch(() => undefined);
    await external.close();
    expect(progressedWhileHeld).toBe(true);
    expect(currentPid).toBeGreaterThan(0);
    expect(await resultA).toBeInstanceOf(Error);
    expect(String(await resultA)).toMatch(/retired/i);
    expect(old).toBeDefined();
    if (!old) throw new Error("Missing original handle");
    expect(old.retired).toBe(true);
    expect(oldEvents).toHaveLength(before);
    expect(invokeCalls("harness_spawn")).toHaveLength(1);
    expect(processes.has(current)).toBe(true);
    expect(
      invokeCalls("harness_kill").some((c) => c.args.sessionId === current),
    ).toBe(false);
    await stopSession(flavor, "owned-pi");
    expect(
      invokeCalls("harness_kill").filter((c) => c.args.sessionId === current),
    ).toHaveLength(1);
    expect(processes.has(current)).toBe(false);
  });
  it("isolates valid old positive PID exit, stdout, init and results from B", async () => {
    autoPrompt = false;
    const a = observed(sendTurn(flavor, input(flavor)));
    await flush();
    const old = lastId();
    const oldPid = pids.get(old);
    if (!oldPid) throw new Error("Missing positive old PID");
    await stopSession(flavor, "owned-pi");
    await a;
    const events: HarnessEvent[] = [];
    const b = observed(sendTurn(flavor, input(flavor, events)));
    await flush();
    const current = lastId();
    const before = events.length;
    frame(old, { type: "session_info_update", sessionId: "old" });
    frame(old, {
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "old" },
    });
    frame(old, { type: "agent_settled" });
    listeners.get("harness-exit")?.({
      payload: { sessionId: old, pid: oldPid, code: 1 },
    });
    expect(events).toHaveLength(before);
    frame(current, { type: "agent_settled" });
    await b;
    expect(processes.has(current)).toBe(true);
  });
  it("kills held native spawn exactly before and after settlement, never B", async () => {
    const held = deferred<void>();
    spawn = () => held.promise;
    const a = observed(sendTurn(flavor, input(flavor)));
    await flush();
    const old = lastId();
    const stop = observed(stopSession(flavor, "owned-pi"));
    await flush();
    spawn = undefined;
    await observed(sendTurn(flavor, input(flavor, [], "B")));
    const b = lastId();
    held.resolve();
    await stop;
    await expect(a).rejects.toThrow(/retired/i);
    expect(
      invokeCalls("harness_kill").filter((c) => c.args.sessionId === old),
    ).toHaveLength(2);
    expect(processes.has(b)).toBe(true);
  });
  it.each([
    "set_model",
    "compact",
    "get_fork_messages",
    "get_session_stats",
    "abort",
  ])("held %s continuation cannot publish or send to B", async (type) => {
    await observed(sendTurn(flavor, input(flavor)));
    const old = lastId();
    let held: Record<string, unknown> | undefined;
    stage = (id, req) => {
      if (id === old && req.type === type) {
        held = req;
        return true;
      }
      return false;
    };
    const req = input(flavor);
    let action: Promise<unknown>;
    if (type === "set_model") {
      req.model = `${flavor.id}:provider/new`;
      action = observed(sendTurn(flavor, req));
    } else if (type === "compact")
      action = observed(compactContext(flavor, req));
    else if (type === "get_fork_messages")
      action = observed(rewindLastTurn(flavor, req));
    else if (type === "abort") {
      autoPrompt = false;
      observed(sendTurn(flavor, req));
      await flush();
      action = observed(cancelTurn(flavor, req.sessionId));
    } else {
      autoPrompt = false;
      action = observed(sendTurn(flavor, req));
      await flush();
      frame(old, { type: "agent_settled" });
    }
    await flush();
    expect(held).toBeDefined();
    await stopSession(flavor, req.sessionId);
    stage = undefined;
    autoPrompt = true;
    const events: HarnessEvent[] = [];
    await observed(sendTurn(flavor, input(flavor, events, "B")));
    const b = lastId();
    const count = calls.length;
    if (!held) throw new Error("Missing held request");
    response(old, held, {
      sessionId: "stale",
      contextUsage: { tokens: 99 },
      messages: [{ entryId: "stale" }],
    });
    await action.catch(() => undefined);
    await flush();
    expect(calls).toHaveLength(count);
    expect(processes.has(b)).toBe(true);
    expect(events.some((e) => e.type === "context" && e.used === 99)).toBe(
      false,
    );
  });
  it("publishes approval resolver before a synchronous answer and guards reentrant stop", async () => {
    autoPrompt = false;
    const events: HarnessEvent[] = [];
    const req = input(flavor, events);
    req.onEvent = (e) => {
      events.push(e);
      if (e.type === "approval.requested")
        respondApproval(flavor, req.sessionId, e.requestId, "allow");
    };
    const turn = observed(sendTurn(flavor, req));
    await flush();
    const id = lastId();
    frame(id, {
      type: "extension_ui_request",
      id: "approve",
      method: "confirm",
      title: "Approve",
    });
    await flush();
    expect(
      invokeCalls("harness_write").map((c) => JSON.parse(String(c.args.line))),
    ).toContainEqual({
      type: "extension_ui_response",
      id: "approve",
      confirmed: true,
    });
    await stopSession(flavor, req.sessionId);
    await turn;
    const stoppedInput = input(flavor);
    let stopped: Promise<void> | undefined;
    stoppedInput.onEvent = (e) => {
      if (e.type === "approval.requested")
        stopped = observed(stopSession(flavor, stoppedInput.sessionId));
    };
    const nextTurn = observed(sendTurn(flavor, stoppedInput));
    await flush();
    const nextId = lastId();
    frame(nextId, {
      type: "extension_ui_request",
      id: "stop-now",
      method: "confirm",
      title: "Stop",
    });
    await stopped;
    await nextTurn;
    await flush();
    expect(
      invokeCalls("harness_write").some(
        (c) => JSON.parse(String(c.args.line)).id === "stop-now",
      ),
    ).toBe(false);
  });
  it("does not let stale approval IDs answer replacement B", async () => {
    await observed(sendTurn(flavor, input(flavor)));
    const oldEvents: HarnessEvent[] = [];
    autoPrompt = false;
    const a = observed(sendTurn(flavor, input(flavor, oldEvents)));
    await flush();
    frame(lastId(), {
      type: "extension_ui_request",
      id: "old",
      method: "confirm",
      title: "Old",
    });
    const old = oldEvents.find((e) => e.type === "approval.requested");
    if (old?.type !== "approval.requested")
      throw new Error("Missing old approval");
    await stopSession(flavor, "owned-pi");
    await a;
    const events: HarnessEvent[] = [];
    const b = observed(sendTurn(flavor, input(flavor, events)));
    await flush();
    const id = lastId();
    frame(id, {
      type: "extension_ui_request",
      id: "new",
      method: "confirm",
      title: "New",
    });
    const next = events.find((e) => e.type === "approval.requested");
    if (next?.type !== "approval.requested")
      throw new Error("Missing approval");
    respondApproval(flavor, "owned-pi", old.requestId, "allow");
    await flush();
    expect(next.requestId).not.toBe(old.requestId);
    expect(
      invokeCalls("harness_write").some(
        (c) => JSON.parse(String(c.args.line)).id === "new",
      ),
    ).toBe(false);
    respondApproval(flavor, "owned-pi", next.requestId, "allow");
    frame(id, { type: "agent_settled" });
    await b;
  });
  it("preserves original current native exit rejection", async () => {
    autoPrompt = false;
    const events: HarnessEvent[] = [];
    const turn = observed(sendTurn(flavor, input(flavor, events)));
    await flush();
    const id = lastId();
    const currentPid = pids.get(id);
    if (!currentPid) throw new Error("Missing current PID");
    listeners.get("harness-exit")?.({
      payload: { sessionId: id, pid: currentPid, code: 1 },
    });
    await expect(turn).rejects.toThrow(`${flavor.label} exited`);
    expect(events).toContainEqual({ type: "session.ended", code: 1 });
  });
});

it("Pi empty stop cannot kill active omp replacement with same logical ID", async () => {
  await observed(sendTurn(PI_FLAVOR, input(PI_FLAVOR)));
  await stopSession(PI_FLAVOR, "owned-pi");
  await observed(sendTurn(OMP_FLAVOR, input(OMP_FLAVOR)));
  const b = lastId();
  await stopSession(PI_FLAVOR, "owned-pi");
  expect(processes.has(b)).toBe(true);
});

it.each(["stop", "C"])(
  "exact closes unpublished B on factory reentrant %s",
  async (mode) => {
    const a = child.reserveRawChild("owned-pi");
    await a.spawn("/fake/pi", [], "/repo");
    const original = child.reserveRawChild;
    const handles: child.RawChildHandle[] = [];
    vi.spyOn(child, "reserveRawChild").mockImplementation((id) => {
      const handle = original(id);
      handles.push(handle);
      return handle;
    });
    let entered = false;
    let callback: Promise<void> | undefined;
    kill = async (id) => {
      if (id === a.nativeId && !entered) {
        entered = true;
        const replacement = input(PI_FLAVOR, [], "C");
        replacement.cwd = "/replacement";
        callback = observed(
          mode === "stop"
            ? stopSession(PI_FLAVOR, "owned-pi")
            : sendTurn(PI_FLAVOR, replacement),
        );
      }
    };
    const b = observed(sendTurn(PI_FLAVOR, input(PI_FLAVOR)));
    await flush();
    await expect(b).rejects.toThrow(/retired/i);
    await callback;
    expect(
      handles.find((handle) => handle.nativeId !== lastId())?.retired,
    ).toBe(true);
  },
);

it("retries only captured failed receipts and retains no duplicate history", async () => {
  await observed(sendTurn(PI_FLAVOR, input(PI_FLAVOR)));
  const old = lastId();
  kill = async () => {
    throw new Error("failed cleanup");
  };
  await stopSession(PI_FLAVOR, "owned-pi");
  let b: Promise<void> | undefined;
  let entered = false;
  kill = async (id) => {
    if (id === old && !entered) {
      entered = true;
      b = observed(sendTurn(PI_FLAVOR, input(PI_FLAVOR, [], "B")));
    }
  };
  await stopSession(PI_FLAVOR, "owned-pi");
  await b;
  expect(entered).toBe(true);
  expect(processes.has(lastId())).toBe(true);
  await stopSession(PI_FLAVOR, "owned-pi");
  const count = calls.length;
  await stopSession(PI_FLAVOR, "owned-pi");
  expect(calls).toHaveLength(count);
});

it("restores unretired A after replacement UUID failure", async () => {
  await observed(sendTurn(PI_FLAVOR, input(PI_FLAVOR)));
  const a = lastId();
  const uuid = vi.spyOn(crypto, "randomUUID").mockImplementationOnce(() => {
    throw new Error("UUID failure");
  });
  const req = input(PI_FLAVOR);
  req.cwd = "/other";
  await expect(observed(sendTurn(PI_FLAVOR, req))).rejects.toThrow(
    "UUID failure",
  );
  uuid.mockRestore();
  await observed(sendTurn(PI_FLAVOR, input(PI_FLAVOR)));
  expect(lastId()).toBe(a);
  expect(invokeCalls("harness_spawn")).toHaveLength(1);
});

it("same retained OMP actor cancellation suppresses a late fast-mode failure fallback", async () => {
  const warm = input(OMP_FLAVOR);
  warm.modelSettings = { thinking: "off" };
  await observed(sendTurn(OMP_FLAVOR, warm));
  const nativeId = lastId();
  let held: Record<string, unknown> | undefined;
  stage = (id, command) => {
    if (id === nativeId && command.type === "set_fast_mode") {
      held = command;
      return true;
    }
    return false;
  };
  const staleEvents: HarnessEvent[] = [];
  const request = input(OMP_FLAVOR, staleEvents, "stale fast");
  request.modelSettings = { fast: "true" };
  const action = observed(sendTurn(OMP_FLAVOR, request));
  await flush();
  if (!held) throw new Error("Missing held fast-mode request");
  await cancelTurn(OMP_FLAVOR, request.sessionId);
  const writesBefore = invokeCalls("harness_write").length;
  const eventsBefore = staleEvents.length;
  stage = undefined;
  frame(nativeId, {
    type: "response",
    id: held.id,
    command: held.type,
    success: false,
    error: "late fast failure",
  });
  await action.catch(() => undefined);
  await flush();
  expect(invokeCalls("harness_write")).toHaveLength(writesBefore);
  expect(staleEvents).toHaveLength(eventsBefore);
  expect(processes.has(nativeId)).toBe(true);
  expect(invokeCalls("harness_spawn")).toHaveLength(1);
});

it("OMP stale question IDs cannot resolve B", async () => {
  autoPrompt = false;
  const oldEvents: HarnessEvent[] = [];
  const a = observed(sendTurn(OMP_FLAVOR, input(OMP_FLAVOR, oldEvents)));
  await flush();
  frame(lastId(), {
    type: "extension_ui_request",
    id: "old",
    method: "input",
    title: "Old",
  });
  const old = oldEvents.find((e) => e.type === "question.asked");
  if (old?.type !== "question.asked") throw new Error("Missing old question");
  await stopSession(OMP_FLAVOR, "owned-pi");
  await a;
  const events: HarnessEvent[] = [];
  const b = observed(sendTurn(OMP_FLAVOR, input(OMP_FLAVOR, events)));
  await flush();
  const id = lastId();
  frame(id, {
    type: "extension_ui_request",
    id: "new",
    method: "input",
    title: "New",
  });
  const next = events.find((e) => e.type === "question.asked");
  if (next?.type !== "question.asked") throw new Error("Missing question");
  respondQuestion(OMP_FLAVOR, "owned-pi", old.requestId, { kind: "skipped" });
  await flush();
  expect(next.requestId).not.toBe(old.requestId);
  expect(
    invokeCalls("harness_write").some(
      (c) => JSON.parse(String(c.args.line)).id === "new",
    ),
  ).toBe(false);
  respondQuestion(OMP_FLAVOR, "owned-pi", next.requestId, { kind: "skipped" });
  frame(id, { type: "agent_settled" });
  await b;
});

it("preserves bind/forget/cancel retry and steer controls", async () => {
  bindSession(PI_FLAVOR, "owned-pi", "cold", "/repo");
  await cancelTurn(PI_FLAVOR, "owned-pi");
  await observed(sendTurn(PI_FLAVOR, input(PI_FLAVOR)));
  expect(
    invokeCalls("harness_write").some(
      (c) => JSON.parse(String(c.args.line)).type === "prompt",
    ),
  ).toBe(false);
  autoPrompt = false;
  const turn = observed(sendTurn(PI_FLAVOR, input(PI_FLAVOR)));
  await flush();
  const id = lastId();
  await steerTurn(PI_FLAVOR, { ...input(PI_FLAVOR), text: "steer" });
  frame(id, { type: "agent_settled" });
  await turn;
  await forgetSession(PI_FLAVOR, "owned-pi");
  autoPrompt = true;
  await observed(sendTurn(PI_FLAVOR, input(PI_FLAVOR)));
  expect(invokeCalls("harness_spawn")[1].args.args).not.toContain("cold");
});

it.each([PI_FLAVOR, OMP_FLAVOR])(
  "$id cancels captured cold initialization before a replacement can start",
  async (flavor) => {
    let held: Record<string, unknown> | undefined;
    let old = "";
    stage = (id, command) => {
      if (!held && command.type === "get_state") {
        old = id;
        held = command;
        return true;
      }
      return false;
    };
    const a = observed(sendTurn(flavor, input(flavor)));
    await flush();
    if (!held || !old) throw new Error("Missing held initialization");
    const oldPid = pids.get(old);
    expect(oldPid).toBeGreaterThan(0);
    await cancelTurn(flavor, "owned-pi");
    const b = observed(sendTurn(flavor, input(flavor, [], "replacement")));
    await flush();
    const current = lastId();
    expect(current).not.toBe(old);
    const before = calls.length;
    response(old, held, { sessionId: "stale" });
    await a.catch(() => undefined);
    await b;
    expect(calls).toHaveLength(before);
    expect(processes.has(current)).toBe(true);
  },
);

it.each([
  [PI_FLAVOR, OMP_FLAVOR],
  [OMP_FLAVOR, PI_FLAVOR],
])(
  "settles the captured active sibling flavor %s before replacement %s",
  async (from, to) => {
    autoPrompt = false;
    let settled = false;
    const a = observed(sendTurn(from, input(from)));
    void a.then(() => {
      settled = true;
    });
    await flush();
    const old = lastId();
    autoPrompt = true;
    await observed(sendTurn(to, input(to, [], "B")));
    const current = lastId();
    expect(current).not.toBe(old);
    expect(settled).toBe(true);
    await a;
    await stopSession(from, "owned-pi");
    expect(processes.has(current)).toBe(true);
  },
);

it.each([PI_FLAVOR, OMP_FLAVOR])(
  "$id settles cancellation despite a throwing completion callback",
  async (flavor) => {
    await observed(sendTurn(flavor, input(flavor)));
    autoPrompt = false;
    let shouldThrow = true;
    let settled = false;
    const req = input(flavor);
    req.onEvent = (event) => {
      if (event.type === "message.completed" && shouldThrow) {
        shouldThrow = false;
        throw new Error("completion callback failed");
      }
    };
    const a = observed(sendTurn(flavor, req));
    void a.then(() => {
      settled = true;
    });
    await flush();
    await expect(cancelTurn(flavor, req.sessionId)).rejects.toThrow(
      "completion callback failed",
    );
    await flush();
    expect(settled).toBe(true);
    expect(
      invokeCalls("harness_write").some(
        (c) => JSON.parse(String(c.args.line)).type === "abort",
      ),
    ).toBe(true);
    await a;
    autoPrompt = true;
    await observed(sendTurn(flavor, input(flavor, [], "B")));
  },
);

it.each([PI_FLAVOR, OMP_FLAVOR])(
  "$id closes its exact child despite a throwing exit callback",
  async (flavor) => {
    const req = input(flavor);
    req.onEvent = (event) => {
      if (event.type === "session.ended")
        throw new Error("exit callback failed");
    };
    await observed(sendTurn(flavor, req));
    const old = lastId();
    const oldPid = pids.get(old);
    expect(oldPid).toBeGreaterThan(0);
    expect(() =>
      listeners.get("harness-exit")?.({
        payload: { sessionId: old, pid: oldPid, code: 1 },
      }),
    ).toThrow("exit callback failed");
    await flush();
    expect(
      invokeCalls("harness_kill").some((c) => c.args.sessionId === old),
    ).toBe(true);
    expect(processes.has(old)).toBe(false);
    await observed(sendTurn(flavor, input(flavor, [], "B")));
  },
);

it.each([PI_FLAVOR, OMP_FLAVOR])(
  "$id rejects already-settled fork state after actor retirement",
  async (flavor) => {
    await observed(sendTurn(flavor, input(flavor)));
    const old = lastId();
    let held: Record<string, unknown> | undefined;
    stage = (id, command) => {
      if (id === old && command.type === "get_state") {
        held = command;
        return true;
      }
      return false;
    };
    const action = observed(rewindLastTurn(flavor, input(flavor)));
    await flush();
    if (!held) throw new Error("Missing fork state");
    response(old, held, { sessionId: "retired_fork" });
    const stopping = observed(stopSession(flavor, "owned-pi"));
    stage = undefined;
    const b = observed(sendTurn(flavor, input(flavor, [], "B")));
    await expect(action).rejects.toThrow(/retired/i);
    await stopping;
    await b;
    expect(processes.has(lastId())).toBe(true);
  },
);
