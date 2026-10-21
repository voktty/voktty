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
  __agyTestReset,
  bindAgySession,
  cancelAgyTurn,
  forgetAgySession,
  sendAgyTurn,
  stopAgySession,
} from "./agy";
import * as childApi from "./child";
import type { HarnessEvent, SendTurnInput } from "./types";

type Call = { command: string; args: Record<string, unknown> };
const calls: Call[] = [];
const listeners = new Map<string, (event: { payload: unknown }) => void>();
const processes = new Map<string, number>();
const pids = new Map<string, number>();
let nextPid = 100;
let releaseBridge: (() => void) | undefined;
let binary: (() => Promise<{ path: string }>) | undefined;
let spawn: ((id: string) => Promise<void>) | undefined;
let write: ((id: string) => Promise<void>) | undefined;
let kill: ((id: string) => Promise<void>) | undefined;
let autoResult = true;
const SID = "agy-owned";
function observed<T>(promise: Promise<T>): Promise<T> {
  void promise.catch(() => undefined);
  return promise;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = observed(
    new Promise<T>((yes, no) => {
      resolve = yes;
      reject = no;
    }),
  );
  return { promise, resolve, reject };
}
async function flush() {
  for (let index = 0; index < 100; index += 1) await Promise.resolve();
}
function invocations(command: string) {
  return calls.filter((call) => call.command === command);
}
function lastId() {
  const values = invocations("harness_spawn");
  return String(values[values.length - 1]?.args.sessionId);
}
function emit(id: string, record: unknown) {
  listeners.get("harness-stdout")?.({
    payload: { sessionId: id, line: JSON.stringify(record) },
  });
}
function result(id: string, conversationId?: string) {
  emit(id, {
    event: "result",
    status: "SUCCESS",
    conversation_id: conversationId,
  });
}
function input(
  text = "hello",
  events: HarnessEvent[] = [],
  sessionId = SID,
): SendTurnInput {
  return {
    sessionId,
    cwd: "/repo",
    model: "gemini:gemini-3.7-flash",
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
      if (command === "harness_resolve_gemini")
        return (await (binary?.() ??
          Promise.resolve({ path: "/synthetic/agy" }))) as T;
      if (command === "harness_spawn") {
        const pid = nextPid++;
        pids.set(id, pid);
        await spawn?.(id);
        processes.set(id, pid);
        return pid as T;
      }
      if (command === "harness_write") {
        if (autoResult) result(id);
        await write?.(id);
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
  pids.clear();
  binary = undefined;
  spawn = undefined;
  write = undefined;
  kill = undefined;
  autoResult = true;
});
afterEach(async () => {
  vi.restoreAllMocks();
  binary = undefined;
  spawn = undefined;
  write = undefined;
  kill = undefined;
  await stopAgySession(SID);
  await stopAgySession("sibling");
  await childApi.killAllChildren();
  __agyTestReset();
});
it("uses exact opaque stdin and original logical control context for happy consecutive turns", async () => {
  await observed(sendAgyTurn(input()));
  await observed(sendAgyTurn(input("again")));
  const call = invocations("harness_spawn")[0];
  expect(call.args).toMatchObject({
    logicalSessionId: SID,
    cwd: "/repo",
    networkAllowlist: null,
  });
  expect(call.args.sessionId).not.toBe(SID);
  expect(invocations("harness_spawn")).toHaveLength(1);
  expect(
    invocations("harness_write").map((value) => value.args.sessionId),
  ).toEqual([call.args.sessionId, call.args.sessionId]);
});
it("retires held binary A and queued A1 while B and C progress without awaiting A", async () => {
  const held = deferred<{ path: string }>();
  let resolutions = 0;
  binary = () => {
    resolutions += 1;
    return held.promise;
  };
  const a = observed(sendAgyTurn(input("A")));
  const a1 = observed(sendAgyTurn(input("A1")));
  await flush();
  await stopAgySession(SID);
  binary = undefined;
  await observed(sendAgyTurn(input("B")));
  const b = lastId();
  await observed(sendAgyTurn(input("C", [], "sibling")));
  held.resolve({ path: "/synthetic/agy" });
  await flush();
  expect(resolutions).toBe(1);
  await expect(a).rejects.toThrow(/retired/i);
  await expect(a1).rejects.toThrow(/retired/i);
  expect(invocations("harness_spawn")).toHaveLength(2);
  expect(processes.has(b)).toBe(true);
});
it("rejects stale stdout init result and valid old PID exit without changing B or resume binding", async () => {
  autoResult = false;
  const oldEvents: HarnessEvent[] = [];
  const a = observed(sendAgyTurn(input("A", oldEvents)));
  await flush();
  const old = lastId();
  const pid = pids.get(old);
  if (!pid) throw new Error("Missing positive old PID");
  await stopAgySession(SID);
  await a;
  const events: HarnessEvent[] = [];
  const b = observed(sendAgyTurn(input("B", events)));
  await flush();
  const current = lastId();
  emit(old, { event: "init", conversation_id: "stale" });
  emit(old, { event: "text_delta", text: "old" });
  result(old, "stale-result");
  listeners.get("harness-exit")?.({
    payload: { sessionId: old, pid, code: 0 },
  });
  expect(
    events.filter(
      (event) =>
        event.type === "session.providerBound" ||
        event.type === "message.delta" ||
        event.type === "session.ended",
    ),
  ).toEqual([]);
  result(current, "B-conversation");
  await b;
  await stopAgySession(SID);
  autoResult = true;
  await observed(sendAgyTurn(input("resume")));
  expect(invocations("harness_spawn")[2].args.args).toContain("B-conversation");
});
it("captures mutable session cwd model settings account network attachments and text before binary await", async () => {
  const held = deferred<{ path: string }>();
  binary = () => held.promise;
  const request = input("original");
  request.providerAccountId = "account-a";
  request.networkAllowlist = ["a.example"];
  request.attachments = [
    {
      id: "file",
      name: "file",
      kind: "file",
      mimeType: "text/plain",
      size: 1,
      path: "/original",
    },
  ];
  const turn = observed(sendAgyTurn(request));
  await flush();
  request.sessionId = "mutated";
  request.cwd = "/mutated";
  request.model = "mutated";
  if (request.modelSettings) request.modelSettings.effort = "low";
  request.providerAccountId = "account-b";
  request.networkAllowlist[0] = "b.example";
  request.attachments[0].path = "/mutated";
  request.text = "mutated";
  held.resolve({ path: "/synthetic/agy" });
  await turn;
  const args = invocations("harness_spawn")[0].args;
  expect(args).toMatchObject({
    logicalSessionId: SID,
    cwd: "/repo",
    networkAllowlist: ["a.example"],
  });
  expect(args.args).toContain("high");
  expect(args.args).not.toContain("mutated");
  expect(
    JSON.parse(String(invocations("harness_write")[0].args.line)).message
      .content,
  ).toBe("original\n\nAttached files:\n- /original");
});
it("late native spawn A is killed before and after settlement without touching B", async () => {
  const held = deferred<void>();
  spawn = () => held.promise;
  const a = observed(sendAgyTurn(input("A")));
  await flush();
  const old = lastId();
  const stopped = observed(stopAgySession(SID));
  await flush();
  spawn = undefined;
  await observed(sendAgyTurn(input("B")));
  const b = lastId();
  expect(
    invocations("harness_kill").some((call) => call.args.sessionId === old),
  ).toBe(true);
  held.resolve();
  await stopped;
  await expect(a).rejects.toThrow(/retired/i);
  expect(
    invocations("harness_kill").filter((call) => call.args.sessionId === old),
  ).toHaveLength(2);
  expect(processes.has(old)).toBe(false);
  expect(processes.has(b)).toBe(true);
});
it("old pending native write rejection and finally cannot close or unwatch replacement B", async () => {
  const held = deferred<void>();
  write = () => held.promise;
  autoResult = false;
  const a = observed(sendAgyTurn(input("A")));
  await flush();
  const old = lastId();
  await stopAgySession(SID);
  write = undefined;
  autoResult = true;
  await observed(sendAgyTurn(input("B")));
  const b = lastId();
  held.reject(new Error("old write"));
  await a;
  await observed(sendAgyTurn(input("B2")));
  expect(lastId()).toBe(b);
  expect(processes.has(b)).toBe(true);
  expect(old).not.toBe(b);
});
it("rejects returned retired B when predecessor kill synchronously admits C", async () => {
  const a = childApi.reserveRawChild(SID);
  await a.spawn("/synthetic/agy", [], "/repo");
  let c: Promise<void> | undefined;
  let entered = false;
  kill = async (id) => {
    if (id === a.nativeId && !entered) {
      entered = true;
      c = observed(sendAgyTurn(input("C")));
    }
  };
  const b = observed(sendAgyTurn(input("B")));
  await flush();
  await expect(b).rejects.toThrow(/retired/i);
  await c;
  expect(invocations("harness_spawn")).toHaveLength(2);
  expect(invocations("harness_write")).toHaveLength(1);
});
it("rejects and exact closes unpublished B when predecessor factory kill synchronously stops caller", async () => {
  const a = childApi.reserveRawChild(SID);
  await a.spawn("/synthetic/agy", [], "/repo");
  const reserve = childApi.reserveRawChild;
  const handles: childApi.RawChildHandle[] = [];
  vi.spyOn(childApi, "reserveRawChild").mockImplementation((id) => {
    const handle = reserve(id);
    handles.push(handle);
    return handle;
  });
  let stopped: Promise<void> | undefined;
  let entered = false;
  kill = async (id) => {
    if (id === a.nativeId && !entered) {
      entered = true;
      stopped = observed(stopAgySession(SID));
    }
  };
  const b = observed(sendAgyTurn(input("B")));
  await flush();
  await expect(b).rejects.toThrow(/retired/i);
  await stopped;
  expect(handles[0]?.retired).toBe(true);
  expect(invocations("harness_spawn")).toHaveLength(1);
  expect(invocations("harness_write")).toHaveLength(0);
  kill = undefined;
  await observed(sendAgyTurn(input("retry")));
  expect(invocations("harness_spawn")).toHaveLength(2);
});
it("empty stop retries failed captured receipt but excludes reentrant new active B", async () => {
  await observed(sendAgyTurn(input("A")));
  const old = lastId();
  kill = async () => {
    throw new Error("cleanup failed");
  };
  await stopAgySession(SID);
  let b: Promise<void> | undefined;
  let entered = false;
  kill = async (id) => {
    if (id === old && !entered) {
      entered = true;
      b = observed(sendAgyTurn(input("B")));
    }
  };
  await stopAgySession(SID);
  await b;
  expect(entered).toBe(true);
  expect(processes.has(lastId())).toBe(true);
});
it("does not keep duplicate caller cleanup history after successful Core global cleanup", async () => {
  await observed(sendAgyTurn(input()));
  kill = async () => {
    throw new Error("failed");
  };
  await stopAgySession(SID);
  kill = undefined;
  await childApi.killAllChildren();
  const count = invocations("harness_kill").length;
  await stopAgySession(SID);
  await stopAgySession(SID);
  expect(invocations("harness_kill")).toHaveLength(count);
});
it("binds cold conversations and preserves cancel before live, fresh retry and forget controls", async () => {
  bindAgySession(SID, " conversation ", "/repo");
  await cancelAgyTurn(SID);
  await observed(sendAgyTurn(input("cancelled")));
  expect(invocations("harness_write")).toHaveLength(0);
  expect(invocations("harness_spawn")[0].args.args).toContain("conversation");
  await observed(sendAgyTurn(input("retry")));
  await forgetAgySession(SID);
  await observed(sendAgyTurn(input("fresh")));
  expect(invocations("harness_spawn")[1].args.args).not.toContain(
    "conversation",
  );
});

it("guards each callback delivery after reentrant stop during result binding", async () => {
  autoResult = false;
  const events: HarnessEvent[] = [];
  let stopped: Promise<void> | undefined;
  const request = input();
  request.onEvent = (event) => {
    events.push(event);
    if (event.type === "session.providerBound")
      stopped = observed(stopAgySession(SID));
  };
  const turn = observed(sendAgyTurn(request));
  await flush();
  emit(lastId(), {
    event: "result",
    conversation_id: "bound",
    response: "must not deliver",
    usage: { total_tokens: 42 },
  });
  await turn;
  await stopped;
  expect(
    events.some(
      (event) =>
        event.type === "message.delta" ||
        event.type === "context" ||
        event.type === "message.completed",
    ),
  ).toBe(false);
});

it("preserves live A when UUID factory fails before reserving replacement B", async () => {
  await observed(sendAgyTurn(input("A")));
  const a = lastId();
  const factory = vi.spyOn(crypto, "randomUUID").mockImplementationOnce(() => {
    throw new Error("UUID failure");
  });
  const request = input("B");
  request.modelSettings = { effort: "low" };
  await expect(observed(sendAgyTurn(request))).rejects.toThrow("UUID failure");
  factory.mockRestore();
  await observed(sendAgyTurn(input("A2")));
  expect(invocations("harness_spawn")).toHaveLength(1);
  expect(processes.has(a)).toBe(true);
});

it("cancels an already issued native opening without delivering or writing after settlement", async () => {
  const held = deferred<void>();
  spawn = () => held.promise;
  const events: HarnessEvent[] = [];
  const turn = observed(sendAgyTurn(input("opening", events)));
  await flush();
  const old = lastId();
  const cancelled = observed(cancelAgyTurn(SID));
  await flush();
  held.resolve();
  await cancelled;
  await expect(turn).rejects.toThrow(/retired/i);
  expect(
    invocations("harness_kill").filter((call) => call.args.sessionId === old),
  ).toHaveLength(2);
  expect(invocations("harness_write")).toHaveLength(0);
  expect(events).toEqual([]);
});

it("rejects the waiting turn on current positive PID exit without treating failure as cancellation", async () => {
  autoResult = false;
  const events: HarnessEvent[] = [];
  const turn = observed(sendAgyTurn(input("waiting", events)));
  await flush();
  const id = lastId();
  const pid = pids.get(id);
  if (!pid) throw new Error("Missing current PID");
  listeners.get("harness-exit")?.({ payload: { sessionId: id, pid, code: 1 } });
  await expect(turn).rejects.toThrow("Antigravity exited");
  expect(events).toContainEqual({ type: "session.ended", code: 1 });
});
