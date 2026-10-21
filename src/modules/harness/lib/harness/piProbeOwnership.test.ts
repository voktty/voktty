import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  it,
  vi,
} from "vitest";
import * as fs from "../fs";
import * as models from "../models";
import * as child from "./child";
import {
  discoverOmpModels,
  discoverPiModels,
  refreshOmpCatalog,
  refreshPiCatalog,
} from "./piCatalog";
import { OMP_FLAVOR, PI_FLAVOR } from "./piFlavor";
import { discoverOmpCommands, discoverPiSkills } from "./piSkills";

type Call = { command: string; args: Record<string, unknown> };
const calls: Call[] = [];
const listeners = new Map<string, (event: { payload: unknown }) => void>();
let release: (() => void) | undefined;
let pid = 100;
let binary: (() => Promise<{ path: string }>) | undefined;
let spawn: ((id: string) => Promise<void>) | undefined;
let kill: ((id: string) => Promise<void>) | undefined;
let write:
  | ((id: string, record: Record<string, unknown>) => Promise<void>)
  | undefined;
let autoAnswer = true;
const heldFixtures = new Set<() => void>();
function observed<P extends Promise<unknown>>(promise: P): P {
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
  heldFixtures.add(() => resolve(undefined as T));
  return { promise, resolve, reject };
}
async function flush() {
  for (let index = 0; index < 100; index += 1) await Promise.resolve();
}
function invocations(command: string) {
  return calls.filter((call) => call.command === command);
}
function emit(id: string, record: unknown) {
  listeners.get("harness-stdout")?.({
    payload: { sessionId: id, line: JSON.stringify(record) },
  });
}
function response(
  id: string,
  command: Record<string, unknown>,
  name = "fresh",
) {
  emit(id, {
    type: "response",
    id: command.id,
    command: command.type,
    success: true,
    data:
      command.type === "get_available_models"
        ? { models: [{ id: name, provider: "test", name }] }
        : { commands: [{ name: `skill:${name}`, source: "skill" }] },
  });
}
const cases = [
  { flavor: PI_FLAVOR, kind: "models", run: discoverPiModels },
  { flavor: OMP_FLAVOR, kind: "models", run: discoverOmpModels },
  { flavor: PI_FLAVOR, kind: "skills", run: discoverPiSkills },
  { flavor: OMP_FLAVOR, kind: "skills", run: discoverOmpCommands },
];
beforeAll(async () => {
  child.configureChildBackend({
    async invoke<T>(
      command: string,
      args: Record<string, unknown> = {},
    ): Promise<T> {
      calls.push({ command, args });
      const id = String(args.sessionId);
      if (command === "harness_resolve_pi" || command === "harness_resolve_omp")
        return (await (binary?.() ??
          Promise.resolve({ path: "/synthetic/pi" }))) as T;
      if (command === "harness_spawn") {
        const next = pid++;
        await spawn?.(id);
        return next as T;
      }
      if (command === "harness_write") {
        const record = JSON.parse(String(args.line)) as Record<string, unknown>;
        await write?.(id, record);
        if (autoAnswer && record.type !== "extension_ui_response")
          response(id, record);
      }
      if (command === "harness_kill") await kill?.(id);
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
  vi.spyOn(fs, "homeDir").mockResolvedValue("/synthetic/home");
  models.resetHarnessModelOverlays();
  vi.useFakeTimers();
});
afterEach(async () => {
  binary = undefined;
  spawn = undefined;
  kill = undefined;
  write = undefined;
  for (const settle of heldFixtures) settle();
  heldFixtures.clear();
  await flush();
  vi.restoreAllMocks();
  await child.killAllChildren();
  const timers = vi.getTimerCount();
  vi.clearAllTimers();
  vi.useRealTimers();
  expect(timers).toBe(0);
});
for (const probe of cases) {
  it(`${probe.flavor.id} ${probe.kind} preserves logical context with opaque native writer and cleanup`, async () => {
    await probe.run("/repo");
    const first = invocations("harness_spawn")[0];
    const logical = String(first.args.logicalSessionId);
    expect(logical).toMatch(
      new RegExp(
        probe.kind === "models"
          ? `^${probe.flavor.probeChildId}-`
          : `^monocode-${probe.flavor.id}-skills-`,
      ),
    );
    expect(first.args.sessionId).toMatch(/^harness-child-/);
    expect(first.args.sessionId).not.toBe(logical);
    expect(first.args.cwd).toBe("/repo");
    expect(first.args.args).toEqual(
      probe.kind === "models" && probe.flavor.id === "omp"
        ? ["--mode", "rpc", "--no-session", "--no-extensions"]
        : ["--mode", "rpc", "--no-session"],
    );
    expect(invocations("harness_write")[0].args.sessionId).toBe(
      first.args.sessionId,
    );
    expect(invocations("harness_kill")[0].args.sessionId).toBe(
      first.args.sessionId,
    );
    expect(vi.getTimerCount()).toBe(0);
  });
  it(`${probe.flavor.id} ${probe.kind} retires before held binary and lets sibling proceed`, async () => {
    const held = deferred<{ path: string }>();
    binary = () => held.promise;
    const a = observed(probe.run("/old"));
    await flush();
    await child.killAllChildren();
    binary = undefined;
    await probe.run("/new");
    held.resolve({ path: "/old/bin" });
    await expect(a).rejects.toThrow(/retired/);
    expect(invocations("harness_spawn")).toHaveLength(1);
    expect(invocations("harness_spawn")[0].args.cwd).toBe("/new");
  });
  it(`${probe.flavor.id} ${probe.kind} repeats exact kill after pending native spawn settles`, async () => {
    const held = deferred<void>();
    spawn = () => held.promise;
    const a = observed(probe.run("/old"));
    await flush();
    const id = String(invocations("harness_spawn")[0].args.sessionId);
    const stopping = observed(child.killAllChildren());
    await flush();
    expect(
      invocations("harness_kill").map((call) => call.args.sessionId),
    ).toEqual([id]);
    held.resolve();
    await expect(a).rejects.toThrow(/retired/);
    await stopping;
    expect(
      invocations("harness_kill").map((call) => call.args.sessionId),
    ).toEqual([id, id]);
    expect(invocations("harness_write")).toHaveLength(0);
  });
}
for (const [flavor, refresh] of [
  [PI_FLAVOR, refreshPiCatalog],
  [OMP_FLAVOR, refreshOmpCatalog],
] as const) {
  it(`${flavor.id} refresh dedups live but replaces retired held binary without old finally deleting B`, async () => {
    const held = deferred<{ path: string }>();
    binary = () => held.promise;
    const a = refresh();
    expect(refresh()).toBe(a);
    await flush();
    await child.killAllChildren();
    binary = undefined;
    autoAnswer = false;
    const b = refresh();
    expect(b).not.toBe(a);
    await flush();
    held.resolve({ path: "/old/bin" });
    await a;
    expect(refresh()).toBe(b);
    const request = invocations("harness_write")[0];
    response(
      String(request.args.sessionId),
      JSON.parse(String(request.args.line)),
      "B",
    );
    await b;
    expect(models.modelsFor(flavor.id).map((model) => model.nativeId)).toEqual([
      "test/B",
    ]);
    expect(invocations("harness_spawn")).toHaveLength(1);
  });
}
it("held home retirement cannot spawn or publish catalog models", async () => {
  const held = deferred<string>();
  vi.mocked(fs.homeDir).mockReturnValueOnce(held.promise);
  const a = refreshPiCatalog();
  await flush();
  await child.killAllChildren();
  await refreshPiCatalog();
  held.resolve("/old/home");
  await a;
  expect(invocations("harness_spawn")).toHaveLength(1);
  expect(invocations("harness_spawn")[0].args.cwd).toBe("/synthetic/home");
});
it("held skill bridge acquisition is released finally without late spawn", async () => {
  const held = deferred<void>();
  const acquire = child.acquireHarnessBridge;
  const acquired = deferred<void>();
  let released = 0;
  vi.spyOn(child, "acquireHarnessBridge").mockImplementation(async () => {
    const exact = await acquire();
    acquired.resolve();
    await held.promise;
    return () => {
      released += 1;
      exact();
    };
  });
  const a = observed(discoverPiSkills("/old"));
  await acquired.promise;
  await child.killAllChildren();
  held.resolve();
  await expect(a).rejects.toThrow(/retired/);
  expect(released).toBe(1);
  expect(invocations("harness_spawn")).toHaveLength(0);
});
it("old positive PID, stdout and rejected native write cannot settle successor or registry", async () => {
  autoAnswer = false;
  const late = deferred<void>();
  write = () => late.promise;
  const a = observed(discoverPiModels("/old"));
  await flush();
  const old = invocations("harness_write")[0];
  const oldPid = pid - 1;
  expect(oldPid).toBeGreaterThan(0);
  await child.killAllChildren();
  write = undefined;
  const b = observed(discoverPiModels("/new"));
  await flush();
  const fresh = invocations("harness_write")[1];
  let settled = false;
  void b.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  response(
    String(old.args.sessionId),
    JSON.parse(String(old.args.line)),
    "stale",
  );
  listeners.get("harness-exit")?.({
    payload: { sessionId: old.args.sessionId, pid: oldPid, code: 1 },
  });
  late.reject(new Error("late old write"));
  await expect(a).rejects.toThrow("late old write");
  await flush();
  expect(settled).toBe(false);
  response(
    String(fresh.args.sessionId),
    JSON.parse(String(fresh.args.line)),
    "B",
  );
  await expect(b).resolves.toMatchObject([{ nativeId: "test/B" }]);
  expect(models.hasLiveCatalog("pi")).toBe(false);
});
it("skills deny captured extension UI, ignore retired UI, and retain original RPC errors", async () => {
  autoAnswer = false;
  const a = observed(discoverPiSkills("/repo"));
  await flush();
  const id = String(invocations("harness_spawn")[0].args.sessionId);
  emit(id, { type: "extension_ui_request", id: "ui", method: "confirm" });
  await flush();
  expect(JSON.parse(String(invocations("harness_write")[1].args.line))).toEqual(
    { type: "extension_ui_response", id: "ui", cancelled: true },
  );
  await child.killAllChildren();
  emit(id, { type: "extension_ui_request", id: "late", method: "input" });
  await vi.advanceTimersByTimeAsync(45_000);
  await expect(a).rejects.toThrow("Pi get_commands timed out");
  expect(invocations("harness_write")).toHaveLength(2);
});
it("catalog clears both deadline timers before held exact cleanup and cannot overwrite a replacement", async () => {
  const held = deferred<void>();
  kill = () => held.promise;
  write = async (id, record) => {
    response(id, record, "A");
  };
  const a = refreshPiCatalog();
  await flush();
  expect(vi.getTimerCount()).toBe(0);
  kill = undefined;
  write = async (id, record) => {
    response(id, record, "B");
  };
  const b = refreshPiCatalog();
  expect(b).not.toBe(a);
  await b;
  held.resolve();
  await a;
  expect(invocations("harness_spawn")).toHaveLength(2);
  expect(models.modelsFor("pi").map((model) => model.nativeId)).toEqual([
    "test/B",
  ]);
});
it("failed cleanup stays retryable exclusively in Core", async () => {
  const failure = new Error("accepted kill failed");
  kill = async () => {
    throw failure;
  };
  await discoverPiSkills("/repo");
  const id = String(invocations("harness_spawn")[0].args.sessionId);
  expect(invocations("harness_kill")).toHaveLength(1);
  kill = undefined;
  await child.killAllChildren();
  expect(
    invocations("harness_kill").map((call) => call.args.sessionId),
  ).toEqual([id, id]);
});
for (const probe of cases) {
  it(`${probe.flavor.id} ${probe.kind} rechecks the actual factory handle retired before return`, async () => {
    const reserve = child.reserveRawChild;
    vi.spyOn(child, "reserveRawChild").mockImplementation((id) => {
      const handle = reserve(id);
      observed(child.killAllChildren());
      return handle;
    });
    await expect(observed(probe.run("/repo"))).rejects.toThrow(/retired/);
    expect(invocations("harness_spawn")).toHaveLength(0);
    expect(invocations("harness_resolve_pi")).toHaveLength(0);
    expect(invocations("harness_resolve_omp")).toHaveLength(0);
  });
}
it("refresh publishes its exact promise before synchronous factory reentry", async () => {
  const reserve = child.reserveRawChild;
  let nested: Promise<void> | undefined;
  vi.spyOn(child, "reserveRawChild").mockImplementation((id) => {
    nested = refreshPiCatalog();
    return reserve(id);
  });
  const outer = refreshPiCatalog();
  expect(nested).toBe(outer);
  await outer;
  expect(invocations("harness_spawn")).toHaveLength(1);
});
it("skill bridge stays acquired until captured exact child close settles", async () => {
  const acquire = child.acquireHarnessBridge;
  const held = deferred<void>();
  let released = false;
  vi.spyOn(child, "acquireHarnessBridge").mockImplementation(async () => {
    const exact = await acquire();
    return () => {
      released = true;
      exact();
    };
  });
  kill = () => held.promise;
  const a = observed(discoverPiSkills("/repo"));
  await flush();
  expect(released).toBe(false);
  held.resolve();
  await a;
  expect(released).toBe(true);
});
it("catalog preserves empty fallback and original RPC deadline", async () => {
  const baseline = models.modelsFor("pi");
  write = async (id, record) => {
    emit(id, {
      type: "response",
      id: record.id,
      command: record.type,
      success: true,
      data: {},
    });
  };
  await refreshPiCatalog();
  expect(models.modelsFor("pi")).toEqual(baseline);
  autoAnswer = false;
  write = undefined;
  const a = observed(discoverPiModels("/repo"));
  await flush();
  await vi.advanceTimersByTimeAsync(45_000);
  await expect(a).rejects.toThrow("Pi get_available_models timed out");
  expect(vi.getTimerCount()).toBe(0);
});
for (const probe of cases.filter(
  (entry) =>
    (entry.flavor.id === "pi" && entry.kind === "models") ||
    (entry.flavor.id === "omp" && entry.kind === "skills"),
)) {
  it(`${probe.flavor.id} ${probe.kind} rejects a current positive-PID exit with its original error`, async () => {
    autoAnswer = false;
    const running = observed(probe.run("/repo"));
    await flush();
    const nativeId = String(invocations("harness_spawn")[0].args.sessionId);
    const currentPid = pid - 1;
    expect(currentPid).toBeGreaterThan(0);
    listeners.get("harness-exit")?.({
      payload: { sessionId: nativeId, pid: currentPid, code: 7 },
    });
    await expect(running).rejects.toThrow(
      `${probe.flavor.label} ${probe.kind === "models" ? "catalog" : "skill"} probe exited`,
    );
    expect(invocations("harness_kill")[0].args.sessionId).toBe(nativeId);
    expect(vi.getTimerCount()).toBe(0);
  });
}

it("flavor resolver, identity and flags are captured before binary settlement", async () => {
  const saved = { ...PI_FLAVOR };
  const held = deferred<{ path: string }>();
  PI_FLAVOR.resolveBinary = () => held.promise;
  const a = observed(discoverPiModels("/repo"));
  PI_FLAVOR.id = "omp";
  PI_FLAVOR.label = "changed";
  PI_FLAVOR.probeChildId = "changed";
  PI_FLAVOR.resolveBinary = async () => {
    throw new Error("mutable resolver");
  };
  held.resolve({ path: "/captured/bin" });
  try {
    await expect(a).resolves.toMatchObject([
      { harness: "pi", nativeId: "test/fresh" },
    ]);
    expect(invocations("harness_spawn")[0].args.args).toEqual([
      "--mode",
      "rpc",
      "--no-session",
    ]);
    expect(invocations("harness_spawn")[0].args.logicalSessionId).toMatch(
      /^monocode-pi-probe-/,
    );
  } finally {
    Object.assign(PI_FLAVOR, saved);
  }
});
