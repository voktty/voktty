import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  it,
  vi,
} from "vitest";
import * as models from "../models";
import * as child from "./child";
import { OMP_FLAVOR, PI_FLAVOR, type PiFlavor } from "./piFlavor";
import { buildPiSpawnArgs } from "./piProtocol";
import { runTextPrompt, stopTextPrompt, warmupText } from "./piText";

type Call = { command: string; args: Record<string, unknown> };
const calls: Call[] = [];
const listeners = new Map<string, (event: { payload: unknown }) => void>();
const processes = new Map<string, number>();
let release: (() => void) | undefined;
let pid = 100;
let binary: (() => Promise<{ path: string }>) | undefined;
let spawn: ((id: string) => Promise<void>) | undefined;
let kill: ((id: string) => Promise<void>) | undefined;
let write:
  | ((id: string, command: Record<string, unknown>) => Promise<void>)
  | undefined;
let autoAnswer = true;
let autoState = true;
let fallback = "";
function observed<T>(promise: Promise<T>): Promise<T> {
  void promise.catch(() => undefined);
  return promise;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
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
function emit(id: string, record: unknown) {
  listeners.get("harness-stdout")?.({
    payload: { sessionId: id, line: JSON.stringify(record) },
  });
}
function answer(id: string, text = "generated text", retry = false) {
  if (text)
    emit(id, {
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: text },
    });
  emit(id, { type: "agent_end", willRetry: retry });
}
function invocations(command: string) {
  return calls.filter((call) => call.command === command);
}
function lastId() {
  const list = invocations("harness_spawn");
  return String(list[list.length - 1]?.args.sessionId);
}
function commands() {
  return invocations("harness_write").map(
    (call) => JSON.parse(String(call.args.line)) as Record<string, unknown>,
  );
}
beforeAll(async () => {
  child.configureChildBackend({
    async invoke<T>(
      command: string,
      args: Record<string, unknown> = {},
    ): Promise<T> {
      calls.push({ command, args });
      if (command === "harness_resolve_pi" || command === "harness_resolve_omp")
        return (await (binary?.() ??
          Promise.resolve({ path: "/synthetic/pi" }))) as T;
      const id = String(args.sessionId);
      if (command === "harness_spawn") {
        const next = pid++;
        processes.set(id, next);
        await spawn?.(id);
        return next as T;
      }
      if (command === "harness_write") {
        const rec = JSON.parse(String(args.line)) as Record<string, unknown>;
        await write?.(id, rec);
        if (rec.type !== "get_state" || autoState)
          emit(id, {
            type: "response",
            id: rec.id,
            command: rec.type,
            success: true,
            data:
              rec.type === "get_last_assistant_text" ? { text: fallback } : {},
          });
        if (rec.type === "prompt" && autoAnswer) answer(id);
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
  release = await child.acquireHarnessBridge();
});
afterAll(() => release?.());
beforeEach(() => {
  calls.length = 0;
  binary = undefined;
  spawn = undefined;
  kill = undefined;
  write = undefined;
  autoAnswer = true;
  autoState = true;
  fallback = "";
  vi.useFakeTimers();
});
afterEach(async () => {
  binary = undefined;
  spawn = undefined;
  kill = undefined;
  write = undefined;
  vi.restoreAllMocks();
  await Promise.all([stopTextPrompt(PI_FLAVOR), stopTextPrompt(OMP_FLAVOR)]);
  await child.killAllChildren();
  expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers();
});
for (const flavor of [PI_FLAVOR, OMP_FLAVOR]) {
  it(`${flavor.id} uses exact native writer and isolated flags with original logical control context`, async () => {
    await expect(
      observed(runTextPrompt(flavor, { cwd: "/repo", prompt: "Generate" })),
    ).resolves.toBe("generated text");
    const first = invocations("harness_spawn")[0];
    expect(first.args.sessionId).not.toBe(flavor.textChildId);
    expect(first.args).toMatchObject({
      logicalSessionId: flavor.textChildId,
      cwd: "/repo",
    });
    expect(first.args.args).toEqual(
      expect.arrayContaining(buildPiSpawnArgs(flavor, { isolated: true })),
    );
    expect(
      invocations("harness_write").every(
        (call) => call.args.sessionId === first.args.sessionId,
      ),
    ).toBe(true);
    expect(commands().map((rec) => rec.type)).toEqual([
      "get_state",
      "new_session",
      "set_thinking_level",
      "prompt",
    ]);
    expect(commands()[2]).toMatchObject({ level: "off" });
    expect(commands()[3]).toMatchObject({ message: "Generate" });
  });
}
it("held A binary and queued A1 retire while B, omp and a sibling proceed", async () => {
  const held = deferred<{ path: string }>();
  binary = () => held.promise;
  const old = observed(warmupText(PI_FLAVOR, "/old"));
  const queued = observed(
    runTextPrompt(PI_FLAVOR, { cwd: "/queued", prompt: "obsolete" }),
  );
  await flush();
  await stopTextPrompt(PI_FLAVOR);
  binary = undefined;
  const replacement = observed(warmupText(PI_FLAVOR, "/new"));
  const omp = observed(warmupText(OMP_FLAVOR, "/omp"));
  const sibling = child.reserveRawChild("sibling");
  await sibling.spawn("/synthetic/pi", [], "/sibling");
  await flush();
  const started = invocations("harness_spawn").map((call) => call.args.cwd);
  held.resolve({ path: "/synthetic/late" });
  await Promise.allSettled([old, queued, replacement, omp]);
  expect(started).toEqual(expect.arrayContaining(["/new", "/omp", "/sibling"]));
  expect(
    invocations("harness_spawn").some(
      (call) => call.args.cwd === "/old" || call.args.cwd === "/queued",
    ),
  ).toBe(false);
  await expect(queued).rejects.toThrow(/retired/);
  await sibling.close();
});
it("snapshots queued input, model catalog and mutable flavor resolver and flags", async () => {
  const held = deferred<{ path: string }>();
  binary = () => held.promise;
  const warming = observed(warmupText(PI_FLAVOR, "/blocking"));
  const catalog = [
    {
      id: "pi:provider/mini",
      harness: "pi" as const,
      name: "Mini",
      nativeId: "provider/mini",
    },
  ];
  vi.spyOn(models, "modelsFor").mockReturnValue(catalog);
  const resolver = vi.fn(async () => ({ path: "/synthetic/original" }));
  const flavor: PiFlavor = {
    ...PI_FLAVOR,
    resolveBinary: resolver,
    isolateFlags: ["--original"],
  };
  const input = { cwd: "/queued", prompt: "original", timeoutMs: 1234 };
  const result = observed(runTextPrompt(flavor, input));
  await flush();
  Object.assign(input, { cwd: "/mutated", prompt: "mutated" });
  catalog[0].nativeId = "provider/changed";
  flavor.resolveBinary = vi.fn(async () => ({ path: "/synthetic/mutated" }));
  (flavor.isolateFlags as string[])[0] = "--mutated";
  binary = undefined;
  held.resolve({ path: "/synthetic/pi" });
  await Promise.all([warming, result]);
  const second = invocations("harness_spawn")[1];
  expect(second.args).toMatchObject({
    cwd: "/queued",
    command: "/synthetic/original",
  });
  expect(second.args.args).toEqual(
    expect.arrayContaining(["--original", "provider/mini"]),
  );
  expect(commands().find((rec) => rec.type === "prompt")).toMatchObject({
    message: "original",
  });
});
it("stale A stdout, RPC response and positive-PID exit never settle or close B", async () => {
  await warmupText(PI_FLAVOR, "/old");
  const oldId = lastId();
  const oldPid = processes.get(oldId);
  if (typeof oldPid !== "number" || oldPid <= 0)
    throw new Error("Missing positive original child PID");
  await stopTextPrompt(PI_FLAVOR);
  autoAnswer = false;
  const result = observed(
    runTextPrompt(PI_FLAVOR, { cwd: "/new", prompt: "new" }),
  );
  await flush();
  const newId = lastId();
  answer(oldId, "obsolete");
  emit(oldId, {
    type: "response",
    command: "prompt",
    success: true,
    id: "mc_4",
  });
  listeners.get("harness-exit")?.({
    payload: { sessionId: oldId, pid: oldPid, code: 0 },
  });
  await flush();
  expect(processes.has(newId)).toBe(true);
  answer(newId, "current");
  await expect(result).resolves.toBe("current");
  expect(newId).not.toBe(oldId);
});
it("held A RPC writer and old finally close only A, never B or omp", async () => {
  const held = deferred<void>();
  write = (_, rec) =>
    rec.type === "prompt" ? held.promise : Promise.resolve();
  const old = observed(
    runTextPrompt(PI_FLAVOR, { cwd: "/old", prompt: "old" }),
  );
  await flush();
  const oldId = lastId();
  await stopTextPrompt(PI_FLAVOR);
  write = undefined;
  await warmupText(PI_FLAVOR, "/new");
  const newId = lastId();
  await warmupText(OMP_FLAVOR, "/omp");
  const ompId = lastId();
  const retry = vi.spyOn(child, "closeRetiredRawChildren");
  held.resolve();
  await Promise.allSettled([old]);
  expect(retry).not.toHaveBeenCalled();
  expect(processes.has(newId)).toBe(true);
  expect(processes.has(ompId)).toBe(true);
  expect(
    invocations("harness_write").find(
      (call) => JSON.parse(String(call.args.line)).type === "prompt",
    )?.args.sessionId,
  ).toBe(oldId);
});
it("held native spawn gets exact kill before and after settlement without killing B", async () => {
  const held = deferred<void>();
  spawn = () => held.promise;
  const old = observed(warmupText(PI_FLAVOR, "/old"));
  await flush();
  const oldId = lastId();
  const stop = observed(stopTextPrompt(PI_FLAVOR));
  spawn = undefined;
  await warmupText(PI_FLAVOR, "/new");
  const newId = lastId();
  expect(
    invocations("harness_kill").map((call) => call.args.sessionId),
  ).toEqual([oldId]);
  held.resolve();
  await Promise.all([old, stop]);
  expect(
    invocations("harness_kill").map((call) => call.args.sessionId),
  ).toEqual([oldId, oldId]);
  expect(processes.has(newId)).toBe(true);
});
it("rejects factory-return retired B before binary when same-SID cleanup admits C", async () => {
  const previous = child.reserveRawChild(PI_FLAVOR.textChildId);
  await previous.spawn("/synthetic/pi", [], "/external");
  let replacement: child.RawChildHandle | undefined;
  kill = (id) => {
    if (id === previous.nativeId && !replacement)
      replacement = child.reserveRawChild(PI_FLAVOR.textChildId);
    return Promise.resolve();
  };
  calls.length = 0;
  await warmupText(PI_FLAVOR, "/b");
  expect(replacement).toBeDefined();
  expect(invocations("harness_resolve_pi")).toHaveLength(0);
  expect(replacement?.retired).toBe(false);
  await stopTextPrompt(PI_FLAVOR);
  expect(replacement?.retired).toBe(false);
  kill = undefined;
  await replacement?.close();
});
it("epoch stop during reserve closes EXACT unpublished B before binary", async () => {
  const previous = child.reserveRawChild(PI_FLAVOR.textChildId);
  await previous.spawn("/synthetic/pi", [], "/external");
  const reserve = child.reserveRawChild;
  let returned: child.RawChildHandle | undefined;
  const close = vi.fn();
  vi.spyOn(child, "reserveRawChild").mockImplementation((id) => {
    const handle = reserve(id);
    returned = handle;
    return Object.freeze({
      ...handle,
      get retired() {
        return handle.retired;
      },
      close: () => {
        close();
        return handle.close();
      },
    });
  });
  let stopping: Promise<void> | undefined;
  kill = (id) => {
    if (id === previous.nativeId && !stopping)
      stopping = observed(stopTextPrompt(PI_FLAVOR));
    return Promise.resolve();
  };
  calls.length = 0;
  await warmupText(PI_FLAVOR, "/b");
  await stopping;
  expect(stopping).toBeDefined();
  expect(returned?.retired).toBe(true);
  expect(close).toHaveBeenCalled();
  expect(invocations("harness_resolve_pi")).toHaveLength(0);
});
it("empty stop captures only failed retired A before cleanup admits active B", async () => {
  await warmupText(PI_FLAVOR, "/old");
  const oldId = lastId();
  kill = async () => {
    throw new Error("uncertain");
  };
  await stopTextPrompt(PI_FLAVOR);
  const held = deferred<void>();
  kill = () => held.promise;
  calls.length = 0;
  const stopping = observed(stopTextPrompt(PI_FLAVOR));
  await flush();
  await warmupText(PI_FLAVOR, "/new");
  const newId = lastId();
  held.resolve();
  await stopping;
  expect(
    invocations("harness_kill").map((call) => call.args.sessionId),
  ).toEqual([oldId]);
  expect(processes.has(newId)).toBe(true);
});
it("preserves retry agent_end and last-text fallback", async () => {
  autoAnswer = false;
  fallback = "fallback text";
  const result = observed(
    runTextPrompt(OMP_FLAVOR, { cwd: "/repo", prompt: "retry" }),
  );
  await flush();
  const id = lastId();
  answer(id, "", true);
  await flush();
  expect(commands().some((rec) => rec.type === "get_last_assistant_text")).toBe(
    false,
  );
  emit(id, { type: "agent_settled" });
  await expect(result).resolves.toBe("fallback text");
});
it("keeps fifteen-second init and forty-five-second request deadlines and clears timers", async () => {
  autoState = false;
  const warm = observed(warmupText(PI_FLAVOR, "/repo"));
  await flush();
  await vi.advanceTimersByTimeAsync(14999);
  expect(processes.size).toBe(1);
  await vi.advanceTimersByTimeAsync(1);
  await warm;
  expect(processes.size).toBe(0);
  autoState = true;
  autoAnswer = false;
  const result = observed(
    runTextPrompt(PI_FLAVOR, { cwd: "/repo", prompt: "wait" }),
  );
  await flush();
  await vi.advanceTimersByTimeAsync(44999);
  expect(processes.size).toBe(1);
  await vi.advanceTimersByTimeAsync(1);
  await expect(result).rejects.toThrow("timed out");
});
it("does not duplicate caller cleanup histories after Core cleanup", async () => {
  const reserve = child.reserveRawChild;
  const closes = new Map<string, number>();
  vi.spyOn(child, "reserveRawChild").mockImplementation((id) => {
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
  for (let index = 0; index < 3; index += 1) {
    await warmupText(PI_FLAVOR, "/old");
    const id = lastId();
    kill = async () => {
      throw new Error("uncertain");
    };
    await stopTextPrompt(PI_FLAVOR);
    kill = undefined;
    await child.killAllChildren();
    const count = closes.get(id);
    await warmupText(PI_FLAVOR, "/new");
    await stopTextPrompt(PI_FLAVOR);
    expect(closes.get(id)).toBe(count);
  }
});
for (const stage of [
  "get_state",
  "new_session",
  "set_thinking_level",
  "get_last_assistant_text",
]) {
  it(`retired ${stage} completion cannot send later A RPC or touch live B`, async () => {
    const held = deferred<void>();
    let entered = false;
    write = (_, rec) => {
      if (rec.type === stage) {
        entered = true;
        return held.promise;
      }
      return Promise.resolve();
    };
    if (stage === "get_last_assistant_text") autoAnswer = false;
    const old = observed(
      runTextPrompt(PI_FLAVOR, { cwd: "/old-stage", prompt: "old" }),
    );
    await flush();
    const oldId = lastId();
    if (stage === "get_last_assistant_text") {
      answer(oldId, "");
      await flush();
    }
    expect(entered).toBe(true);
    await stopTextPrompt(PI_FLAVOR);
    write = undefined;
    await warmupText(PI_FLAVOR, "/new-stage");
    const newId = lastId();
    const before = invocations("harness_write").filter(
      (call) => call.args.sessionId === oldId,
    ).length;
    held.resolve();
    await Promise.allSettled([old]);
    expect(
      invocations("harness_write").filter(
        (call) => call.args.sessionId === oldId,
      ),
    ).toHaveLength(before);
    expect(processes.has(newId)).toBe(true);
    expect(
      invocations("harness_kill").some((call) => call.args.sessionId === newId),
    ).toBe(false);
  });
}
it("preserves an actual raw writer error without orphaned turn promises", async () => {
  const original = new Error("original raw write failure");
  write = async (_, rec) => {
    if (rec.type === "prompt") throw original;
  };
  await expect(
    observed(runTextPrompt(PI_FLAVOR, { cwd: "/repo", prompt: "fail" })),
  ).rejects.toBe(original);
  expect(commands().map((rec) => rec.type)).toEqual([
    "get_state",
    "new_session",
    "set_thinking_level",
    "prompt",
    "abort",
  ]);
});
it("invalid warmups do not resolve or allocate", async () => {
  await Promise.all([warmupText(PI_FLAVOR, ""), warmupText(OMP_FLAVOR, "~")]);
  expect(calls).toHaveLength(0);
});
