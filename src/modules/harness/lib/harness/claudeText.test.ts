import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  it,
  vi,
} from "vitest";
import * as childApi from "./child";
import { buildClaudeSpawnArgs, buildClaudeUserMessage } from "./claudeProtocol";
import {
  runClaudeTextPrompt,
  stopClaudeTextPrompt,
  warmupClaudeText,
} from "./claudeText";

type Invocation = { command: string; args: Record<string, unknown> };
const calls: Invocation[] = [];
const listeners = new Map<string, (event: { payload: unknown }) => void>();
const processes = new Map<string, number>();
const emittedPids = new Map<string, number>();
let releaseBridge: (() => void) | undefined;
let nextPid = 100;
let autoInit = true;
let autoResult = true;
let binary: (() => Promise<{ path: string }>) | undefined;
let kill: ((id: string) => Promise<void>) | undefined;
let write: ((id: string) => Promise<void>) | undefined;
let spawn: ((id: string) => Promise<void>) | undefined;
const SID = "monocode-claude-text";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  void promise.catch(() => undefined);
  return { promise, resolve, reject };
}
function observed<T>(promise: Promise<T>): Promise<T> {
  void promise.catch(() => undefined);
  return promise;
}
async function flush(): Promise<void> {
  for (let index = 0; index < 100; index += 1) await Promise.resolve();
}
function emit(id: string, record: unknown): void {
  listeners.get("harness-stdout")?.({
    payload: { sessionId: id, line: JSON.stringify(record) },
  });
}
function init(id: string): void {
  emit(id, { type: "system", subtype: "init" });
}
function answer(id: string, text = "generated text"): void {
  emit(id, {
    type: "assistant",
    message: { content: [{ type: "text", text }] },
  });
  emit(id, { type: "result", subtype: "success" });
}
function exit(id: string, pid: number): void {
  listeners.get("harness-exit")?.({
    payload: { sessionId: id, pid, code: 0 },
  });
}
function invocations(command: string): Invocation[] {
  return calls.filter((call) => call.command === command);
}
function lastId(): string {
  const spawned = invocations("harness_spawn");
  return String(spawned[spawned.length - 1]?.args.sessionId);
}

beforeAll(async () => {
  childApi.configureChildBackend({
    async invoke<T>(
      command: string,
      args: Record<string, unknown> = {},
    ): Promise<T> {
      calls.push({ command, args });
      if (command === "harness_resolve_claude")
        return (await (binary?.() ??
          Promise.resolve({ path: "/synthetic/claude" }))) as T;
      const id = String(args.sessionId);
      if (command === "harness_spawn") {
        const pid = nextPid++;
        processes.set(id, pid);
        emittedPids.set(id, pid);
        if (autoInit) init(id);
        await spawn?.(id);
        return pid as T;
      }
      if (command === "harness_write") {
        if (autoResult) answer(id);
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
  emittedPids.clear();
  autoInit = true;
  autoResult = true;
  binary = undefined;
  kill = undefined;
  write = undefined;
  spawn = undefined;
  vi.useFakeTimers();
});
afterEach(async () => {
  binary = undefined;
  kill = undefined;
  write = undefined;
  vi.restoreAllMocks();
  await stopClaudeTextPrompt();
  await childApi.killAllChildren();
  vi.useRealTimers();
});

it("uses an opaque native child and preserves isolated stream-json and logical control context", async () => {
  const result = observed(
    runClaudeTextPrompt({
      cwd: "/repo",
      prompt: "Generate",
      model: "explicit-model",
      providerAccountId: "account-a",
    }),
  );
  await expect(result).resolves.toBe("generated text");
  const spawned = invocations("harness_spawn")[0];
  expect(spawned.args).toMatchObject({
    logicalSessionId: SID,
    cwd: "/repo",
    account: { provider: "claude", id: "account-a" },
    args: buildClaudeSpawnArgs({ isolated: true, model: "explicit-model" }),
  });
  expect(spawned.args.sessionId).not.toBe(SID);
  expect(invocations("harness_write")[0].args).toEqual({
    sessionId: spawned.args.sessionId,
    line: JSON.stringify(buildClaudeUserMessage({ text: "Generate" })),
  });
  expect(processes.has(String(spawned.args.sessionId))).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
});

it("reuses matching warmup but respawns for a different model or account", async () => {
  await warmupClaudeText("/repo");
  const warmId = lastId();
  await observed(runClaudeTextPrompt({ cwd: "/repo", prompt: "cheap" }));
  expect(invocations("harness_spawn")).toHaveLength(1);
  expect(invocations("harness_write")[0].args.sessionId).toBe(warmId);
  await warmupClaudeText("/repo");
  await observed(
    runClaudeTextPrompt({
      cwd: "/repo",
      prompt: "custom",
      model: "different-model",
    }),
  );
  expect(invocations("harness_spawn")).toHaveLength(3);
  await warmupClaudeText("/repo");
  await observed(
    runClaudeTextPrompt({
      cwd: "/repo",
      prompt: "account",
      providerAccountId: "different-account",
    }),
  );
  expect(invocations("harness_spawn")).toHaveLength(5);
});

it("keeps the eight-second ready soft fallback and forty-five-second default timeout", async () => {
  autoInit = false;
  autoResult = false;
  const result = observed(
    runClaudeTextPrompt({ cwd: "/repo", prompt: "wait" }),
  );
  await flush();
  await vi.advanceTimersByTimeAsync(7_999);
  expect(invocations("harness_write")).toHaveLength(0);
  await vi.advanceTimersByTimeAsync(1);
  expect(invocations("harness_write")).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(44_999);
  expect(processes.size).toBe(1);
  await vi.advanceTimersByTimeAsync(1);
  await expect(result).rejects.toThrow("timed out");
  expect(vi.getTimerCount()).toBe(0);
});

it("retires held binary A and queued A1 while B proceeds without awaiting A", async () => {
  const held = deferred<{ path: string }>();
  binary = () => held.promise;
  const warming = observed(warmupClaudeText("/old"));
  const queued = observed(
    runClaudeTextPrompt({ cwd: "/old-queued", prompt: "obsolete" }),
  );
  await flush();
  await stopClaudeTextPrompt();
  binary = undefined;
  const replacement = observed(warmupClaudeText("/new"));
  await flush();
  const newStarted = invocations("harness_spawn").some(
    (call) => call.args.cwd === "/new",
  );
  held.resolve({ path: "/synthetic/late-claude" });
  await Promise.allSettled([warming, queued, replacement]);
  expect(newStarted).toBe(true);
  expect(invocations("harness_spawn").map((call) => call.args.cwd)).toEqual([
    "/new",
  ]);
  await expect(queued).rejects.toThrow(/retired/);
});

it("snapshots queued cwd, account, model and prompt before input mutation", async () => {
  const held = deferred<{ path: string }>();
  binary = () => held.promise;
  const warming = observed(warmupClaudeText("/blocking"));
  const input = {
    cwd: "/queued",
    providerAccountId: "original-account",
    model: "original-model",
    prompt: "original prompt",
  };
  const queued = observed(runClaudeTextPrompt(input));
  await flush();
  Object.assign(input, {
    cwd: "/mutated",
    providerAccountId: "mutated-account",
    model: "mutated-model",
    prompt: "mutated prompt",
  });
  binary = undefined;
  held.resolve({ path: "/synthetic/claude" });
  await Promise.all([warming, queued]);
  const spawned = invocations("harness_spawn")[1];
  expect(spawned.args).toMatchObject({
    cwd: "/queued",
    account: { provider: "claude", id: "original-account" },
    args: buildClaudeSpawnArgs({ isolated: true, model: "original-model" }),
  });
  expect(JSON.parse(String(invocations("harness_write")[0].args.line))).toEqual(
    buildClaudeUserMessage({ text: "original prompt" }),
  );
});

it("does not let old A init, stdout, result or exit settle or close B", async () => {
  await warmupClaudeText("/old");
  const oldId = lastId();
  const oldPid = emittedPids.get(oldId);
  expect(oldPid).toBeDefined();
  if (typeof oldPid !== "number" || oldPid <= 0)
    throw new Error("Missing positive original child PID");
  await stopClaudeTextPrompt();
  autoInit = false;
  autoResult = false;
  const result = observed(runClaudeTextPrompt({ cwd: "/new", prompt: "new" }));
  await flush();
  const newId = lastId();
  init(oldId);
  answer(oldId, "obsolete");
  exit(oldId, oldPid);
  await flush();
  const prematureWrites = invocations("harness_write").length;
  init(newId);
  await flush();
  answer(oldId, "obsolete");
  exit(oldId, oldPid);
  await flush();
  const alive = processes.has(newId);
  answer(newId, "current");
  await expect(result).resolves.toBe("current");
  expect(prematureWrites).toBe(0);
  expect(alive).toBe(true);
  expect(newId).not.toBe(oldId);
});

it("captures A writer and late finally cleanup without killing B or a sibling", async () => {
  const heldWrite = deferred<void>();
  write = () => heldWrite.promise;
  const old = observed(runClaudeTextPrompt({ cwd: "/old", prompt: "old" }));
  await flush();
  const oldId = lastId();
  const sibling = childApi.reserveRawChild("sibling");
  await sibling.spawn("/synthetic/claude", [], "/sibling");
  await stopClaudeTextPrompt();
  write = undefined;
  const replacement = observed(warmupClaudeText("/new"));
  await flush();
  const newId = lastId();
  const retry = vi.spyOn(childApi, "closeRetiredRawChildren");
  heldWrite.resolve();
  await Promise.allSettled([old, replacement]);
  expect(retry).not.toHaveBeenCalled();
  retry.mockRestore();
  expect(invocations("harness_write")[0].args.sessionId).toBe(oldId);
  expect(processes.has(newId)).toBe(true);
  expect(processes.has(sibling.nativeId)).toBe(true);
  expect(
    invocations("harness_kill").some(
      (call) =>
        call.args.sessionId === newId ||
        call.args.sessionId === sibling.nativeId,
    ),
  ).toBe(false);
  await sibling.close();
});

it("captures pending native opening and re-kills only A after late settlement", async () => {
  const held = deferred<void>();
  spawn = () => held.promise;
  const warming = observed(warmupClaudeText("/old"));
  await flush();
  const oldId = lastId();
  const stopping = observed(stopClaudeTextPrompt());
  spawn = undefined;
  await warmupClaudeText("/new");
  const newId = lastId();
  held.resolve();
  await Promise.all([warming, stopping]);
  expect(newId).not.toBe(oldId);
  expect(processes.has(newId)).toBe(true);
  expect(
    invocations("harness_kill").map((call) => call.args.sessionId),
  ).toEqual([oldId, oldId]);
});

it("rejects a factory-return B synchronously retired by same-SID reentrant C before publication", async () => {
  const previous = childApi.reserveRawChild(SID);
  await previous.spawn("/synthetic/claude", [], "/external-old");
  let replacement: childApi.RawChildHandle | undefined;
  kill = (id) => {
    if (id === previous.nativeId && !replacement)
      replacement = childApi.reserveRawChild(SID);
    return Promise.resolve();
  };
  const before = calls.length;
  await warmupClaudeText("/attempt-b");
  expect(replacement).toBeDefined();
  expect(
    calls
      .slice(before)
      .some(
        (call) =>
          call.command === "harness_resolve_claude" ||
          call.command === "harness_spawn",
      ),
  ).toBe(false);
  expect(replacement?.retired).toBe(false);
  kill = undefined;
  await replacement?.close();
});

it("empty stop retries only the failed exact receipt captured before replacement admission", async () => {
  await warmupClaudeText("/old");
  const oldId = lastId();
  kill = async () => {
    throw new Error("cleanup uncertain");
  };
  await stopClaudeTextPrompt();
  const held = deferred<void>();
  kill = () => held.promise;
  const before = calls.length;
  const stopping = observed(stopClaudeTextPrompt());
  await flush();
  const replacement = observed(warmupClaudeText("/new"));
  await flush();
  const newId = lastId();
  held.resolve();
  await Promise.all([stopping, replacement]);
  expect(
    calls
      .slice(before)
      .filter((call) => call.command === "harness_kill")
      .map((call) => call.args.sessionId),
  ).toEqual([oldId]);
  expect(newId).not.toBe(oldId);
  expect(processes.has(newId)).toBe(true);
});

it("does not retain caller cleanup histories after successful global Core cleanup", async () => {
  const reserve = childApi.reserveRawChild;
  const closes = new Map<string, number>();
  const spy = vi.spyOn(childApi, "reserveRawChild").mockImplementation((id) => {
    const handle = reserve(id);
    closes.set(handle.nativeId, 0);
    return Object.freeze({
      ...handle,
      get retired() {
        return handle.retired;
      },
      close: () => {
        closes.set(handle.nativeId, (closes.get(handle.nativeId) ?? 0) + 1);
        return handle.close();
      },
    });
  });
  for (let cycle = 0; cycle < 3; cycle += 1) {
    await warmupClaudeText("/old");
    const oldId = lastId();
    kill = async () => {
      throw new Error("uncertain");
    };
    await stopClaudeTextPrompt();
    kill = undefined;
    await childApi.killAllChildren();
    const acknowledged = closes.get(oldId);
    await warmupClaudeText("/new");
    await stopClaudeTextPrompt();
    expect(closes.get(oldId)).toBe(acknowledged);
  }
  expect(closes.size).toBe(6);
  spy.mockRestore();
});

it("observes internal turn failure during held write and preserves the original write error", async () => {
  autoResult = false;
  const held = deferred<void>();
  write = () => held.promise;
  const result = observed(
    runClaudeTextPrompt({ cwd: "/repo", prompt: "fail" }),
  );
  await flush();
  emit(lastId(), {
    type: "result",
    subtype: "error",
    errors: ["provider failure"],
  });
  await flush();
  const original = new Error("original write failure");
  held.reject(original);
  await expect(result).rejects.toBe(original);
  expect(vi.getTimerCount()).toBe(0);
});

it("clears ready and request timers on stop and abort without delaying a replacement", async () => {
  autoInit = false;
  const warming = observed(warmupClaudeText("/waiting-ready"));
  await flush();
  expect(vi.getTimerCount()).toBe(1);
  await stopClaudeTextPrompt();
  await warming;
  expect(vi.getTimerCount()).toBe(0);
  autoInit = true;
  autoResult = false;
  const controller = new AbortController();
  const result = observed(
    runClaudeTextPrompt({
      cwd: "/repo",
      prompt: "cancel",
      signal: controller.signal,
    }),
  );
  await flush();
  expect(vi.getTimerCount()).toBe(1);
  controller.abort();
  await expect(result).rejects.toThrow("cancelled");
  expect(vi.getTimerCount()).toBe(0);
});

it("merges partial and assistant snapshots and preserves failed and empty result behavior", async () => {
  autoResult = false;
  const result = observed(
    runClaudeTextPrompt({ cwd: "/repo", prompt: "stream" }),
  );
  await flush();
  emit(lastId(), {
    type: "stream_event",
    event: { delta: { type: "text_delta", text: "hello" } },
  });
  answer(lastId(), "hello world");
  await expect(result).resolves.toBe("hello world");
  const failed = observed(
    runClaudeTextPrompt({ cwd: "/repo", prompt: "error" }),
  );
  await flush();
  emit(lastId(), {
    type: "result",
    subtype: "error",
    errors: ["provider failure"],
  });
  await expect(failed).rejects.toThrow("provider failure");
  const empty = observed(
    runClaudeTextPrompt({ cwd: "/repo", prompt: "empty" }),
  );
  await flush();
  emit(lastId(), { type: "result", subtype: "success" });
  await expect(empty).rejects.toThrow("empty output");
  expect(vi.getTimerCount()).toBe(0);
});

it("retires unpublished B when predecessor cleanup synchronously stops the text epoch", async () => {
  const previous = childApi.reserveRawChild(SID);
  await previous.spawn("/synthetic/claude", [], "/external-old");
  const sibling = childApi.reserveRawChild("sibling-c");
  await sibling.spawn("/synthetic/claude", [], "/sibling-c");
  const reserve = childApi.reserveRawChild;
  let returned: childApi.RawChildHandle | undefined;
  const spy = vi.spyOn(childApi, "reserveRawChild").mockImplementation((id) => {
    const handle = reserve(id);
    returned = handle;
    return handle;
  });
  let stopping: Promise<void> | undefined;
  kill = (id) => {
    if (id === previous.nativeId && !stopping)
      stopping = observed(stopClaudeTextPrompt());
    return Promise.resolve();
  };
  const held = deferred<{ path: string }>();
  binary = () => held.promise;
  calls.length = 0;
  const warming = observed(warmupClaudeText("/unpublished-b"));
  try {
    await flush();
    await stopping;
    const resolverCalls = invocations("harness_resolve_claude").length;
    const retiredBeforeBinarySettlement = returned?.retired;
    held.resolve({ path: "/synthetic/claude" });
    await warming;
    expect(stopping).toBeDefined();
    expect(returned).toBeDefined();
    expect(resolverCalls).toBe(0);
    expect(retiredBeforeBinarySettlement).toBe(true);
    expect(invocations("harness_spawn")).toHaveLength(0);
    expect(
      invocations("harness_kill").map((call) => call.args.sessionId),
    ).toEqual([previous.nativeId]);
    expect(processes.has(sibling.nativeId)).toBe(true);
    expect(sibling.retired).toBe(false);
  } finally {
    held.resolve({ path: "/synthetic/claude" });
    await warming;
    kill = undefined;
    spy.mockRestore();
    await returned?.close();
    await sibling.close();
  }
});

it("ignores invalid warmup folders without resolving a binary", async () => {
  await Promise.all([warmupClaudeText(""), warmupClaudeText("~")]);
  expect(invocations("harness_resolve_claude")).toHaveLength(0);
});
