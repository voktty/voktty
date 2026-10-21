import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  it,
  vi,
} from "vitest";
import { acquireHarnessBridge, configureChildBackend } from "./child";
import * as childApi from "./child";
import {
  __codexTestReset,
  __codexTestResumeMap,
  sendCodexTurn,
  setCodexBinaryResolver,
  stopCodexSession,
} from "./codex";
import type { HarnessEvent, SendTurnInput } from "./types";

vi.mock("../fs", () => ({
  saveGeneratedImage: vi.fn(),
  deleteGeneratedImages: vi.fn(async () => undefined),
}));

type Invocation = { command: string; args: Record<string, unknown> };
type WireMessage = { id?: number; method?: string; params?: unknown };
const calls: Invocation[] = [];
const listeners = new Map<string, (event: { payload: unknown }) => void>();
const processes = new Map<string, number>();
let nextPid = 100;
let releaseBridge: (() => void) | undefined;
let writeHook: ((args: Record<string, unknown>) => Promise<void>) | undefined;
let killHook: ((args: Record<string, unknown>) => Promise<void>) | undefined;
const errors: unknown[] = [];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function emit(event: string, payload: unknown): void {
  const listener = listeners.get(event);
  if (!listener) throw new Error(`Missing ${event} listener`);
  listener({ payload });
}

function spawns(logicalId: string): Invocation[] {
  return calls.filter(
    (call) =>
      call.command === "harness_spawn" &&
      (call.args.logicalSessionId ?? call.args.sessionId) === logicalId,
  );
}

function nativeId(call: Invocation): string {
  if (typeof call.args.sessionId !== "string")
    throw new Error("Missing native id");
  return call.args.sessionId;
}

function messages(id: string): WireMessage[] {
  const latest = calls
    .slice()
    .reverse()
    .find(
      (call) => call.command === "harness_spawn" && call.args.sessionId === id,
    );
  const start = latest ? calls.indexOf(latest) : 0;
  return calls
    .slice(start)
    .filter(
      (call) => call.command === "harness_write" && call.args.sessionId === id,
    )
    .map((call) => JSON.parse(String(call.args.line)) as WireMessage);
}

function response(id: string, method: string, result: unknown): void {
  const request = messages(id)
    .slice()
    .reverse()
    .find((message) => message.method === method);
  if (request?.id === undefined) throw new Error(`Missing ${method}`);
  emit("harness-stdout", {
    sessionId: id,
    line: JSON.stringify({ id: request.id, result }),
  });
}

async function ticks(): Promise<void> {
  for (let index = 0; index < 40; index += 1) await Promise.resolve();
}

async function waitFor(predicate: () => boolean): Promise<void> {
  await vi.waitFor(() => expect(predicate()).toBe(true), { interval: 1 });
}

function input(sessionId = "same", text = ""): SendTurnInput {
  return {
    sessionId,
    cwd: "/repo",
    model: "codex:gpt-5.4",
    runtimeMode: "supervised",
    text,
    attachments: [],
    onEvent: () => undefined,
  };
}

async function ready(id: string, threadId: string): Promise<void> {
  await waitFor(() =>
    messages(id).some((message) => message.method === "initialize"),
  );
  response(id, "initialize", {});
  await waitFor(() =>
    messages(id).some(
      (message) =>
        message.method === "thread/start" || message.method === "thread/resume",
    ),
  );
  const method = messages(id).some(
    (message) => message.method === "thread/resume",
  )
    ? "thread/resume"
    : "thread/start";
  response(id, method, { thread: { id: threadId } });
  await ticks();
}

function observe(promise: Promise<void>): Promise<void> {
  return promise.catch((error: unknown) => {
    errors.push(error);
  });
}

function trackReservations() {
  const reserve = childApi.reserveRawChild;
  const closes = new Map<string, number>();
  const spy = vi
    .spyOn(childApi, "reserveRawChild")
    .mockImplementation((logicalId) => {
      const handle = reserve(logicalId);
      closes.set(handle.nativeId, 0);
      return {
        ...handle,
        get retired() {
          return handle.retired;
        },
        close: () => {
          closes.set(handle.nativeId, (closes.get(handle.nativeId) ?? 0) + 1);
          return handle.close();
        },
      };
    });
  return { closes, restore: () => spy.mockRestore() };
}

beforeAll(async () => {
  configureChildBackend({
    async invoke<T>(
      command: string,
      args: Record<string, unknown> = {},
    ): Promise<T> {
      calls.push({ command, args });
      if (command === "harness_spawn") {
        const pid = nextPid++;
        processes.set(String(args.sessionId), pid);
        return pid as T;
      }
      if (command === "harness_write") await writeHook?.(args);
      if (command === "harness_kill") {
        await killHook?.(args);
        processes.delete(String(args.sessionId));
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
  releaseBridge = await acquireHarnessBridge();
});

beforeEach(() => {
  __codexTestReset();
  calls.length = 0;
  errors.length = 0;
  processes.clear();
  writeHook = undefined;
  killHook = undefined;
  setCodexBinaryResolver(async () => ({ path: "/fake/codex" }));
});

afterEach(async () => {
  writeHook = undefined;
  killHook = undefined;
  await Promise.all([stopCodexSession("same"), stopCodexSession("sibling")]);
  __codexTestReset();
});

afterAll(() => {
  releaseBridge?.();
});

it("does not revisit globally acknowledged cleanup history after admitting a successor", async () => {
  const tracked = trackReservations();
  try {
    for (let cycle = 0; cycle < 3; cycle += 1) {
      const first = sendCodexTurn(input());
      await waitFor(() => spawns("same").length === cycle * 2 + 1);
      const oldSpawns = spawns("same");
      const oldId = nativeId(oldSpawns[oldSpawns.length - 1]);
      await ready(oldId, `old-${cycle}`);
      await first;
      killHook = async () => {
        throw new Error("cleanup uncertain");
      };
      await stopCodexSession("same");
      killHook = undefined;
      await childApi.killAllChildren();
      const acknowledged = tracked.closes.get(oldId);
      const next = sendCodexTurn(input());
      await waitFor(() => spawns("same").length === cycle * 2 + 2);
      const nextSpawns = spawns("same");
      const nextId = nativeId(nextSpawns[nextSpawns.length - 1]);
      await ready(nextId, `next-${cycle}`);
      await next;
      await stopCodexSession("same");
      expect(tracked.closes.get(oldId)).toBe(acknowledged);
    }
  } finally {
    killHook = undefined;
    tracked.restore();
  }
});

it("retries only the retired receipt captured by an empty stop while a replacement becomes ready", async () => {
  const first = sendCodexTurn(input());
  await waitFor(() => spawns("same").length === 1);
  const oldId = nativeId(spawns("same")[0]);
  await ready(oldId, "old");
  await first;
  killHook = async () => {
    throw new Error("cleanup uncertain");
  };
  await stopCodexSession("same");
  const retry = deferred<void>();
  killHook = async () => retry.promise;
  const before = calls.length;
  const stopping = stopCodexSession("same");
  try {
    const next = sendCodexTurn(input());
    const sibling = sendCodexTurn(input("sibling"));
    await waitFor(
      () => spawns("same").length === 2 && spawns("sibling").length === 1,
    );
    const nextId = nativeId(spawns("same")[1]);
    const siblingId = nativeId(spawns("sibling")[0]);
    await ready(nextId, "next");
    await ready(siblingId, "sibling");
    await Promise.all([next, sibling]);
    retry.resolve();
    await stopping;
    expect(
      calls
        .slice(before)
        .filter((call) => call.command === "harness_kill")
        .map((call) => call.args.sessionId),
    ).toEqual([oldId]);
    expect(processes.has(nextId)).toBe(true);
    expect(processes.has(siblingId)).toBe(true);
  } finally {
    retry.resolve();
    killHook = undefined;
    await stopping;
  }
});

it("snapshots admitted identity and process settings before binary resolution", async () => {
  const sibling = sendCodexTurn(input("sibling"));
  await waitFor(() => spawns("sibling").length === 1);
  const siblingId = nativeId(spawns("sibling")[0]);
  await ready(siblingId, "thread-C");
  await sibling;
  const binary = deferred<{ path: string }>();
  setCodexBinaryResolver(() => binary.promise);
  const request = {
    ...input(),
    providerAccountId: "account-A",
    networkAllowlist: ["original.example"],
    modelSettings: { serviceTier: "fast", reasoningEffort: "low" },
  };
  const opening = observe(sendCodexTurn(request));
  await ticks();
  request.sessionId = "sibling";
  request.cwd = "/mutated";
  request.providerAccountId = "account-C";
  request.networkAllowlist[0] = "mutated.example";
  request.model = "codex:mutated";
  request.modelSettings.serviceTier = "mutated";
  binary.resolve({ path: "/fake/codex" });
  await waitFor(() => spawns("same").length === 1);
  const spawned = spawns("same")[0];
  const admittedId = nativeId(spawned);
  await ready(admittedId, "thread-A");
  await opening;
  expect(spawned.args).toMatchObject({
    logicalSessionId: "same",
    cwd: "/repo",
    account: { provider: "codex", id: "account-A" },
    networkAllowlist: ["original.example"],
  });
  expect(
    messages(admittedId).find((message) => message.method === "thread/start")
      ?.params,
  ).toMatchObject({ cwd: "/repo", model: "gpt-5.4", serviceTier: "fast" });
  expect(__codexTestResumeMap().get("same")?.threadId).toBe("thread-A");
  expect(__codexTestResumeMap().get("sibling")?.threadId).toBe("thread-C");
  expect(processes.has(siblingId)).toBe(true);
});

it("does not publish a handle synchronously retired by reentrant successor admission", async () => {
  const first = sendCodexTurn(input());
  await waitFor(() => spawns("same").length === 1);
  const oldId = nativeId(spawns("same")[0]);
  await ready(oldId, "thread-A");
  await first;
  let replacement: Promise<void> | undefined;
  killHook = async (args) => {
    if (args.sessionId === oldId && !replacement)
      replacement = observe(sendCodexTurn({ ...input(), cwd: "/C" }));
  };
  const displaced = observe(sendCodexTurn({ ...input(), cwd: "/B" }));
  try {
    await waitFor(() => spawns("same").length === 2);
    const successor = spawns("same")[1];
    expect(successor.args.cwd).toBe("/C");
    await ready(nativeId(successor), "thread-C");
    await Promise.all([displaced, replacement]);
    expect(__codexTestResumeMap().get("same")).toMatchObject({
      cwd: "/C",
      threadId: "thread-C",
    });
  } finally {
    killHook = undefined;
    await stopCodexSession("same");
    await Promise.all([displaced, replacement]);
  }
});

it("retires an opening before binary resolution without spawning over its successor", async () => {
  const binary = deferred<{ path: string }>();
  setCodexBinaryResolver(() => binary.promise);
  const old = observe(sendCodexTurn(input()));
  await ticks();
  await stopCodexSession("same");
  setCodexBinaryResolver(async () => ({ path: "/fake/codex" }));
  const successor = sendCodexTurn(input());
  await waitFor(() => spawns("same").length === 1);
  const successorId = nativeId(spawns("same")[0]);
  await ready(successorId, "thread-B");
  await successor;
  binary.resolve({ path: "/late/codex" });
  await ticks();
  expect(spawns("same")).toHaveLength(1);
  expect(processes.has(successorId)).toBe(true);
  expect(__codexTestResumeMap().get("same")?.threadId).toBe("thread-B");
  void old;
});

it("does not close ready successor or sibling when an old initialize write rejects late", async () => {
  const write = deferred<void>();
  let oldId = "";
  writeHook = async (args) => {
    if (!oldId) oldId = String(args.sessionId);
    if (args.sessionId === oldId) await write.promise;
  };
  const old = observe(sendCodexTurn(input()));
  await waitFor(() => !!oldId);
  await stopCodexSession("same");
  writeHook = undefined;
  const successor = sendCodexTurn(input());
  const sibling = sendCodexTurn(input("sibling"));
  await waitFor(
    () => spawns("same").length === 2 && spawns("sibling").length === 1,
  );
  const successorId = nativeId(spawns("same")[1]);
  const siblingId = nativeId(spawns("sibling")[0]);
  await ready(successorId, "thread-B");
  await ready(siblingId, "thread-C");
  await Promise.all([successor, sibling]);
  const before = calls.length;
  write.reject(new Error("old initialize failed"));
  await old;
  expect(
    calls
      .slice(before)
      .filter(
        (call) =>
          call.command === "harness_kill" &&
          (call.args.sessionId === successorId ||
            call.args.sessionId === siblingId),
      ),
  ).toEqual([]);
  expect(processes.has(successorId)).toBe(true);
  expect(processes.has(siblingId)).toBe(true);
  expect(__codexTestResumeMap().get("same")?.threadId).toBe("thread-B");
});

it("ignores queued old stdout request one on the same installed bridge", async () => {
  const write = deferred<void>();
  let oldId = "";
  writeHook = async (args) => {
    oldId = String(args.sessionId);
    await write.promise;
  };
  const old = observe(sendCodexTurn(input()));
  await waitFor(() => !!oldId);
  await stopCodexSession("same");
  writeHook = undefined;
  const successor = observe(sendCodexTurn(input()));
  await waitFor(() => spawns("same").length === 2);
  const successorId = nativeId(spawns("same")[1]);
  await waitFor(() =>
    messages(successorId).some((message) => message.method === "initialize"),
  );
  emit("harness-stdout", {
    sessionId: oldId,
    line: JSON.stringify({ id: 1, result: {} }),
  });
  await ticks();
  try {
    expect(
      messages(successorId).some(
        (message) => message.method === "thread/start",
      ),
    ).toBe(false);
  } finally {
    write.reject(new Error("retired write"));
    await old;
    await stopCodexSession("same");
    void successor;
  }
});

it("does not let queued old stderr contaminate the successor exit error", async () => {
  const first = sendCodexTurn(input());
  await waitFor(() => spawns("same").length === 1);
  const oldId = nativeId(spawns("same")[0]);
  await ready(oldId, "thread-A");
  await first;
  await stopCodexSession("same");
  const events: HarnessEvent[] = [];
  const successor = sendCodexTurn({
    ...input("same", "prompt"),
    onEvent: (event) => events.push(event),
  });
  const rejected = expect(successor).rejects.toThrow("Codex app-server exited");
  await waitFor(() => spawns("same").length === 2);
  const successorId = nativeId(spawns("same")[1]);
  emit("harness-stderr", {
    sessionId: oldId,
    line: "old stderr must not cross",
  });
  await ready(successorId, "thread-B");
  await waitFor(() =>
    messages(successorId).some((message) => message.method === "turn/start"),
  );
  response(successorId, "turn/start", { turn: { id: "turn-B" } });
  await ticks();
  const pid = processes.get(successorId);
  emit("harness-exit", { sessionId: successorId, pid, code: 1 });
  await rejected;
  expect(events).not.toContainEqual({
    type: "session.error",
    message: "old stderr must not cross",
  });
});
