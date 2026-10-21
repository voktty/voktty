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

const sent: string[] = [];
let onLine: ((line: string) => void) | undefined;
type Invocation = { command: string; args: Record<string, unknown> };
const calls: Invocation[] = [];
const listeners = new Map<string, (event: { payload: unknown }) => void>();
const processes = new Map<string, number>();
let latestId = "";
let releaseBridge: (() => void) | undefined;
let autoReply = false;
let nextPid = 100;
let binary: (() => Promise<{ path: string }>) | undefined;
let kill: (() => Promise<void>) | undefined;

function emit(sessionId: string, line: string): void {
  const listener = listeners.get("harness-stdout");
  if (!listener) throw new Error("Missing shared stdout listener");
  listener({ payload: { sessionId, line } });
}

beforeAll(async () => {
  configureChildBackend({
    async invoke<T>(
      command: string,
      args: Record<string, unknown> = {},
    ): Promise<T> {
      calls.push({ command, args });
      if (command === "harness_resolve_codex")
        return (await (binary?.() ??
          Promise.resolve({ path: "/fake/codex" }))) as T;
      if (command === "harness_spawn") {
        latestId = String(args.sessionId);
        onLine = (line) => emit(latestId, line);
        const pid = nextPid++;
        processes.set(latestId, pid);
        return pid as T;
      }
      if (command === "harness_kill") {
        await kill?.();
        processes.delete(String(args.sessionId));
      }
      if (command === "harness_write") {
        const line = String(args.line);
        sent.push(line);
        const message = JSON.parse(line) as RpcMessage;
        if (autoReply && message.id !== undefined) {
          const id = String(args.sessionId);
          const result =
            message.method === "thread/start"
              ? { thread: { id: `text-thread-${nextPid}` } }
              : message.method === "turn/start"
                ? { turn: { id: "text-turn" } }
                : {};
          emit(id, JSON.stringify({ id: message.id, result }));
          if (message.method === "turn/start") {
            emit(
              id,
              JSON.stringify({
                method: "item/agentMessage/delta",
                params: { delta: "auto result" },
              }),
            );
            emit(
              id,
              JSON.stringify({
                method: "turn/completed",
                params: { turn: { status: "completed" } },
              }),
            );
          }
        }
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

afterAll(() => {
  releaseBridge?.();
});

const { runCodexTextPrompt, stopCodexTextPrompt, warmupCodexText } =
  await import("./codexText");

type RpcMessage = {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
};

function messages(): RpcMessage[] {
  return sent.map((line) => JSON.parse(line) as RpcMessage);
}

function request(method: string): RpcMessage | undefined {
  return messages().find((message) => message.method === method);
}

function reply(method: string, result: unknown): void {
  const message = request(method);
  if (message?.id === undefined) throw new Error(`Missing ${method} request`);
  onLine?.(JSON.stringify({ id: message.id, result }));
}

function notify(method: string, params: unknown): void {
  onLine?.(JSON.stringify({ method, params }));
}

async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  for (let index = 0; index < 200; index += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

beforeEach(() => {
  sent.length = 0;
  calls.length = 0;
  processes.clear();
  onLine = undefined;
  autoReply = false;
  binary = undefined;
  kill = undefined;
});

afterEach(async () => {
  kill = undefined;
  await stopCodexTextPrompt();
});

it("does not revisit globally acknowledged text cleanup history after new admission", async () => {
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
  autoReply = true;
  try {
    for (let cycle = 0; cycle < 3; cycle += 1) {
      await warmupCodexText("/old");
      const oldId = latestId;
      kill = async () => {
        throw new Error("cleanup uncertain");
      };
      await stopCodexTextPrompt();
      kill = undefined;
      await childApi.killAllChildren();
      const acknowledged = closes.get(oldId);
      await warmupCodexText("/new");
      await stopCodexTextPrompt();
      expect(closes.get(oldId)).toBe(acknowledged);
    }
  } finally {
    kill = undefined;
    spy.mockRestore();
  }
});

it("retries the exact retired text receipt while a new helper becomes ready", async () => {
  autoReply = true;
  await warmupCodexText("/old");
  const oldId = latestId;
  kill = async () => {
    throw new Error("cleanup uncertain");
  };
  await stopCodexTextPrompt();
  let finish!: () => void;
  const retry = new Promise<void>((resolve) => {
    finish = resolve;
  });
  kill = async () => retry;
  const before = calls.length;
  const stopping = stopCodexTextPrompt();
  try {
    await warmupCodexText("/new");
    const nextId = latestId;
    finish();
    await stopping;
    expect(
      calls
        .slice(before)
        .filter((call) => call.command === "harness_kill")
        .map((call) => call.args.sessionId),
    ).toEqual([oldId]);
    expect(processes.has(nextId)).toBe(true);
    expect(nextId).not.toBe(oldId);
  } finally {
    finish();
    kill = undefined;
    await stopping;
  }
});

it("snapshots queued text primitives before earlier warmup settles", async () => {
  autoReply = true;
  let finish!: (value: { path: string }) => void;
  const resolved = new Promise<{ path: string }>((resolve) => {
    finish = resolve;
  });
  binary = () => resolved;
  const warming = warmupCodexText("/blocking");
  const request = {
    cwd: "/queued",
    providerAccountId: "original-account",
    prompt: "original prompt",
    model: "gpt-5.4",
  };
  const queued = runCodexTextPrompt(request);
  for (let index = 0; index < 40; index += 1) await Promise.resolve();
  request.cwd = "/mutated";
  request.providerAccountId = "mutated-account";
  request.prompt = "mutated prompt";
  request.model = "mutated-model";
  binary = undefined;
  finish({ path: "/fake/codex" });
  await Promise.all([warming, queued]);
  const spawnedChildren = calls.filter(
    (call) => call.command === "harness_spawn",
  );
  const spawned = spawnedChildren[spawnedChildren.length - 1];
  expect(spawned?.args).toMatchObject({
    cwd: "/queued",
    account: { provider: "codex", id: "original-account" },
  });
  expect(requestMessageForTurn()).toMatchObject({
    model: "gpt-5.4",
    input: [{ type: "text", text: "original prompt" }],
  });
});

function requestMessageForTurn(): Record<string, unknown> | undefined {
  return messages().find((message) => message.method === "turn/start")?.params;
}

it("does not kill a ready replacement when an old stop settles late", async () => {
  autoReply = true;
  await warmupCodexText("/old");
  const oldId = latestId;
  let finish!: () => void;
  const closing = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let first = true;
  kill = async () => {
    if (!first) return;
    first = false;
    await closing;
  };
  const stopping = stopCodexTextPrompt();
  try {
    await warmupCodexText("/new");
    const replacementId = latestId;
    expect(processes.has(replacementId)).toBe(true);
    finish();
    await stopping;
    expect(processes.has(replacementId)).toBe(true);
    expect(replacementId).not.toBe(oldId);
  } finally {
    finish();
    await stopping;
  }
});

it("ignores queued old request-one stdout on the same text helper bridge", async () => {
  autoReply = true;
  await warmupCodexText("/old");
  const oldId = latestId;
  await stopCodexTextPrompt();
  autoReply = false;
  sent.length = 0;
  const warming = warmupCodexText("/new");
  await waitFor(() => !!request("initialize"), "replacement initialize");
  emit(oldId, JSON.stringify({ id: 1, result: {} }));
  for (let index = 0; index < 40; index += 1) await Promise.resolve();
  try {
    expect(request("thread/start")).toBeUndefined();
  } finally {
    autoReply = true;
    reply("initialize", {});
    for (let index = 0; index < 40; index += 1) await Promise.resolve();
    if (request("thread/start"))
      reply("thread/start", { thread: { id: "replacement" } });
    await warming;
  }
});

it("invalidates both an unresolved warmup and already queued text work before replacement", async () => {
  autoReply = true;
  let finish!: (value: { path: string }) => void;
  const resolved = new Promise<{ path: string }>((resolve) => {
    finish = resolve;
  });
  binary = () => resolved;
  const oldWarmup = warmupCodexText("/old");
  const queued = runCodexTextPrompt({
    cwd: "/old-queued",
    prompt: "obsolete",
  }).catch(() => "retired");
  for (let index = 0; index < 40; index += 1) await Promise.resolve();
  await stopCodexTextPrompt();
  binary = undefined;
  const replacement = warmupCodexText("/new");
  try {
    for (let index = 0; index < 80; index += 1) await Promise.resolve();
    expect(
      calls.some(
        (call) => call.command === "harness_spawn" && call.args.cwd === "/new",
      ),
    ).toBe(true);
  } finally {
    finish({ path: "/late/codex" });
    await Promise.all([oldWarmup, queued, replacement]);
  }
  expect(
    calls
      .filter((call) => call.command === "harness_spawn")
      .map((call) => call.args.cwd),
  ).toEqual(["/new"]);
  expect(await queued).toBe("retired");
});

it("starts generated-text threads as ephemeral Codex sessions", async () => {
  const result = runCodexTextPrompt({ cwd: "/repo", prompt: "Generate text" });

  await waitFor(() => !!request("initialize"), "initialize");
  reply("initialize", {});
  await waitFor(() => !!request("thread/start"), "thread/start");
  expect(request("thread/start")?.params).toMatchObject({ ephemeral: true });
  reply("thread/start", { thread: { id: "text-thread" } });
  await waitFor(() => !!request("turn/start"), "turn/start");
  reply("turn/start", { turn: { id: "text-turn" } });
  notify("item/agentMessage/delta", { delta: "Generated text" });
  notify("turn/completed", {
    turn: { id: "text-turn", status: "completed" },
  });

  await expect(result).resolves.toBe("Generated text");
  expect(messages().some((message) => message.method === "thread/resume")).toBe(
    false,
  );
});
