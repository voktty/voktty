import { beforeEach, expect, it, vi } from "vitest";
import type { Session } from "./session";
import { createHarnessSessionRuntime } from "./harnessSessionRuntime";

function session(
  id: string,
  cwd = "/local",
  extra: Partial<Session> = {},
): Session {
  return {
    id,
    cwd,
    harness: "claude",
    model: "test",
    modelSettings: {},
    runtimeMode: "supervised",
    title: id,
    blocks: [],
    ...extra,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
let load = vi.fn<(id: string) => Promise<Session | undefined>>();
beforeEach(() => {
  load = vi
    .fn<(id: string) => Promise<Session | undefined>>()
    .mockResolvedValue(undefined);
});
function required<T>(value: T | undefined): T {
  expect(value).toBeDefined();
  if (value === undefined)
    throw new Error("Expected an admitted session token.");
  return value;
}

it("retains a live session when another view admits a persisted idle duplicate", () => {
  const runtime = createHarnessSessionRuntime({ loadSession: load });
  const live = runtime.admitSession(session("s", "/local", { busy: true }));
  expect(runtime.admitSession(session("s", "/different"))).toBe(live);
  expect(runtime.getSession("s")).toMatchObject({ cwd: "/local", busy: true });
});
it("keeps stable immutable snapshot containers and copies caller-owned root data", () => {
  const runtime = createHarnessSessionRuntime({ loadSession: load });
  const input = session("s");
  runtime.admitSession(input);
  const snapshot = runtime.getSnapshot();
  expect(runtime.getSnapshot()).toBe(snapshot);
  input.cwd = "/mutated";
  input.blocks.push({ id: "b", role: "user", text: "later" });
  input.modelSettings.speed = "changed";
  expect(runtime.getSession("s")).toMatchObject({
    cwd: "/local",
    blocks: [],
    modelSettings: {},
  });
  expect(Object.isFrozen(snapshot)).toBe(true);
  expect(Object.isFrozen(snapshot.sessions)).toBe(true);
  expect(Object.isFrozen(runtime.getSession("s"))).toBe(true);
});
it("deduplicates a load before notifying reentrant subscribers", async () => {
  const pending = deferred<Session | undefined>();
  load.mockReturnValue(pending.promise);
  const runtime = createHarnessSessionRuntime({ loadSession: load });
  let reentrant: Promise<Readonly<Session> | undefined> | undefined;
  runtime.subscribe(() => {
    if (runtime.getSnapshot().loadingSessionIds.includes("s"))
      reentrant = runtime.ensureSessionLoaded("s");
  });
  const first = runtime.ensureSessionLoaded("s");
  const second = runtime.ensureSessionLoaded("s");
  expect(first).toBe(second);
  expect(reentrant).toBe(first);
  await Promise.resolve();
  expect(load).toHaveBeenCalledTimes(1);
  pending.resolve(session("s"));
  expect(await first).toBe(runtime.getSession("s"));
});
it("does not reload or reset a busy session already owned by the runtime", async () => {
  const runtime = createHarnessSessionRuntime({ loadSession: load });
  runtime.admitSession(session("s", "/local", { busy: true }));
  await runtime.ensureSessionLoaded("s");
  expect(load).not.toHaveBeenCalled();
  expect(runtime.getSession("s")?.busy).toBe(true);
});
it("rejects an old load after removal without resurrecting the session", async () => {
  const pending = deferred<Session | undefined>();
  load.mockReturnValue(pending.promise);
  const runtime = createHarnessSessionRuntime({ loadSession: load });
  const opened = runtime.ensureSessionLoaded("s");
  const failure = expect(opened).rejects.toMatchObject({
    code: "HARNESS_SESSION_CANCELLED",
  });
  runtime.removeSession("s");
  pending.resolve(session("s"));
  await failure;
  expect(runtime.getSession("s")).toBeUndefined();
});
it("preserves a replacement admitted while an older load is pending", async () => {
  const pending = deferred<Session | undefined>();
  load.mockReturnValue(pending.promise);
  const runtime = createHarnessSessionRuntime({ loadSession: load });
  const old = runtime.ensureSessionLoaded("s");
  const failure = expect(old).rejects.toMatchObject({
    code: "HARNESS_SESSION_CANCELLED",
  });
  runtime.removeSession("s");
  const replacement = runtime.admitSession(
    session("s", "/new", { busy: true }),
  );
  pending.resolve(session("s", "/old"));
  await failure;
  expect(runtime.getSession("s")).toBe(replacement);
});
it("does not remove a newer pending load when an older cancelled load fails", async () => {
  const first = deferred<Session | undefined>();
  const second = deferred<Session | undefined>();
  load.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const runtime = createHarnessSessionRuntime({ loadSession: load });
  const old = runtime.ensureSessionLoaded("s");
  const failed = expect(old).rejects.toThrow("old failure");
  await Promise.resolve();
  runtime.removeSession("s");
  const next = runtime.ensureSessionLoaded("s");
  await Promise.resolve();
  first.reject(new Error("old failure"));
  await failed;
  expect(runtime.getSnapshot().loadingSessionIds).toEqual(["s"]);
  second.resolve(session("s", "/new"));
  expect(await next).toMatchObject({ cwd: "/new" });
});
it("counts cancelled loads until native/persistence settlement and rejects capacity atomically", async () => {
  const pending = deferred<Session | undefined>();
  load.mockReturnValue(pending.promise);
  const runtime = createHarnessSessionRuntime(
    { loadSession: load },
    { maxLoads: 1 },
  );
  const old = runtime.ensureSessionLoaded("s");
  const cancelled = expect(old).rejects.toMatchObject({
    code: "HARNESS_SESSION_CANCELLED",
  });
  await Promise.resolve();
  runtime.removeSession("s");
  const snapshot = runtime.getSnapshot();
  const listener = vi.fn();
  runtime.subscribe(listener);
  await expect(runtime.ensureSessionLoaded("other")).rejects.toMatchObject({
    code: "HARNESS_SESSION_CAPACITY",
  });
  expect(runtime.getSnapshot()).toBe(snapshot);
  expect(listener).not.toHaveBeenCalled();
  expect(load).toHaveBeenCalledTimes(1);
  pending.resolve(session("s"));
  await cancelled;
  load.mockResolvedValueOnce(session("other"));
  expect(await runtime.ensureSessionLoaded("other")).toMatchObject({
    id: "other",
  });
});
it("reserves pending session slots before allocation and permits dedup at capacity", async () => {
  const pending = deferred<Session | undefined>();
  load.mockReturnValue(pending.promise);
  const runtime = createHarnessSessionRuntime(
    { loadSession: load },
    { maxSessions: 1 },
  );
  const operation = runtime.ensureSessionLoaded("s");
  expect(runtime.ensureSessionLoaded("s")).toBe(operation);
  expect(() => runtime.admitSession(session("other"))).toThrowError(
    expect.objectContaining({ code: "HARNESS_SESSION_CAPACITY" }),
  );
  pending.resolve(session("s"));
  await operation;
});
it("rejects a mismatched persisted session id without admitting data", async () => {
  load.mockResolvedValueOnce(session("wrong"));
  const runtime = createHarnessSessionRuntime({ loadSession: load });
  await expect(runtime.ensureSessionLoaded("s")).rejects.toThrow("identity");
  expect(runtime.getSnapshot().sessions).toEqual([]);
});
it("returns missing persisted sessions without retaining a phantom owner", async () => {
  const runtime = createHarnessSessionRuntime({ loadSession: load });
  expect(await runtime.ensureSessionLoaded("s")).toBeUndefined();
  expect(runtime.getSnapshot().loadingSessionIds).toEqual([]);
});
it("admits two independent local and SSH project turns and rejects duplicate turn ownership", () => {
  const runtime = createHarnessSessionRuntime({ loadSession: load });
  runtime.admitSession(
    session("local", "/a", { providerAccountId: "account-a" }),
  );
  runtime.admitSession(
    session("remote", "remote://voktty-ssh-p1/repo", {
      providerAccountId: "account-b",
      worktreeCwd: "remote://voktty-ssh-p1/worktree",
    }),
  );
  const local = runtime.beginTurn("local");
  const remote = runtime.beginTurn("remote");
  expect(local).toBeDefined();
  expect(remote).toBeDefined();
  expect(runtime.beginTurn("local")).toBeUndefined();
  expect(runtime.getSnapshot().busySessionIds).toEqual(["local", "remote"]);
  runtime.completeTurn(required(local));
  expect(runtime.getSession("remote")).toMatchObject({
    busy: true,
    providerAccountId: "account-b",
    worktreeCwd: "remote://voktty-ssh-p1/worktree",
  });
});
it("rejects stale turn updates after completion and after replacement with the same id", () => {
  const runtime = createHarnessSessionRuntime({ loadSession: load });
  runtime.admitSession(session("s"));
  const old = required(runtime.beginTurn("s"));
  runtime.completeTurn(old);
  expect(
    runtime.updateSession(old, (current) => ({ ...current, title: "late" })),
  ).toBe(false);
  const next = required(runtime.beginTurn("s"));
  runtime.removeSession("s");
  runtime.admitSession(session("s", "/new"));
  expect(
    runtime.updateSession(next, (current) => ({ ...current, busy: false })),
  ).toBe(false);
  expect(runtime.getSession("s")).toMatchObject({ cwd: "/new", title: "s" });
});
it("does not permit a token to change another session or the captured identity", () => {
  const runtime = createHarnessSessionRuntime({ loadSession: load });
  runtime.admitSession(session("a"));
  runtime.admitSession(session("b"));
  const token = required(runtime.captureSession("a"));
  expect(() =>
    runtime.updateSession(token, (current) => ({ ...current, id: "b" })),
  ).toThrow("identity");
  expect(runtime.getSession("b")?.title).toBe("b");
});
it("keeps sessions and union references when one view closes or changes selection", () => {
  const runtime = createHarnessSessionRuntime({ loadSession: load });
  runtime.admitSession(session("a", "/a", { busy: true }));
  runtime.admitSession(session("b", "/b", { busy: true }));
  const one = runtime.registerView(1);
  const two = runtime.registerView(2);
  one.report({
    referencedSessionIds: ["a", "b"],
    foregroundSessionIds: ["a"],
    activeSessionId: "a",
  });
  two.report({
    referencedSessionIds: ["b"],
    foregroundSessionIds: ["b"],
    activeSessionId: "b",
  });
  expect(runtime.getSnapshot().referencedSessionIds).toEqual(["a", "b"]);
  one.release();
  expect(runtime.getSnapshot().referencedSessionIds).toEqual(["b"]);
  expect(runtime.getSnapshot().busySessionIds).toEqual(["a", "b"]);
  expect(load).not.toHaveBeenCalled();
});
it("survives late cleanup of an older registration for the same outer tab owner", () => {
  const runtime = createHarnessSessionRuntime({ loadSession: load });
  const old = runtime.registerView(1);
  old.report({ referencedSessionIds: ["old"] });
  const next = runtime.registerView(1);
  next.report({ referencedSessionIds: ["new"] });
  old.release();
  old.report({ referencedSessionIds: ["stale"] });
  expect(runtime.getSnapshot().referencedSessionIds).toEqual(["new"]);
  next.release();
  expect(runtime.getSnapshot().referencedSessionIds).toEqual([]);
});
it("bounds registrations and rejects a prospective reference union before publishing", () => {
  const runtime = createHarnessSessionRuntime(
    { loadSession: load },
    { maxViews: 1, maxReferences: 1 },
  );
  const view = runtime.registerView(1);
  view.report({ referencedSessionIds: ["a"] });
  const snapshot = runtime.getSnapshot();
  expect(() => runtime.registerView(2)).toThrowError(
    expect.objectContaining({ code: "HARNESS_SESSION_CAPACITY" }),
  );
  expect(() => view.report({ referencedSessionIds: ["a", "b"] })).toThrow();
  expect(runtime.getSnapshot()).toBe(snapshot);
});
it("rejects a turn for a removed worktree before changing any state", () => {
  const runtime = createHarnessSessionRuntime({ loadSession: load });
  runtime.admitSession(session("s", "/gone", { worktreeRemoved: true }));
  const snapshot = runtime.getSnapshot();
  expect(runtime.beginTurn("s")).toBeUndefined();
  expect(runtime.getSnapshot()).toBe(snapshot);
});
it("keeps pending approvals parked instead of admitting a second turn", () => {
  const runtime = createHarnessSessionRuntime({ loadSession: load });
  runtime.admitSession(
    session("s", "/local", {
      blocks: [
        {
          id: "approval",
          role: "approval",
          text: "",
          approval: { requestId: 1 },
        },
      ],
    }),
  );
  expect(runtime.beginTurn("s")).toBeUndefined();
});
it("ignores tokens minted by another runtime even with identical public fields", () => {
  const one = createHarnessSessionRuntime({ loadSession: load });
  const two = createHarnessSessionRuntime({ loadSession: load });
  one.admitSession(session("s"));
  two.admitSession(session("s"));
  const token = required(one.captureSession("s"));
  expect(two.isCurrent(token)).toBe(false);
  expect(
    two.updateSession(token, (current) => ({ ...current, title: "wrong" })),
  ).toBe(false);
  expect(one.isCurrent({ ...token })).toBe(false);
});
it("does not overwrite a reentrant replacement from an update callback", () => {
  const runtime = createHarnessSessionRuntime({ loadSession: load });
  runtime.admitSession(session("s"));
  const token = required(runtime.captureSession("s"));
  expect(
    runtime.updateSession(token, (current) => {
      runtime.removeSession("s");
      runtime.admitSession(session("s", "/new"));
      return { ...current, title: "stale" };
    }),
  ).toBe(false);
  expect(runtime.getSession("s")).toMatchObject({ cwd: "/new", title: "s" });
});
it("checks the union of separately bounded reports atomically", () => {
  const runtime = createHarnessSessionRuntime(
    { loadSession: load },
    { maxViews: 2, maxReferences: 1 },
  );
  const one = runtime.registerView(1);
  const two = runtime.registerView(2);
  one.report({ referencedSessionIds: ["a"] });
  const snapshot = runtime.getSnapshot();
  const listener = vi.fn();
  runtime.subscribe(listener);
  expect(() => two.report({ referencedSessionIds: ["b"] })).toThrowError(
    expect.objectContaining({ code: "HARNESS_SESSION_CAPACITY" }),
  );
  expect(runtime.getSnapshot()).toBe(snapshot);
  expect(listener).not.toHaveBeenCalled();
  two.report({ referencedSessionIds: ["a"] });
  one.release();
  expect(runtime.getSnapshot().referencedSessionIds).toEqual(["a"]);
});
it("does not publish equivalent reports or infer foreground from active selection", () => {
  const runtime = createHarnessSessionRuntime({ loadSession: load });
  const view = runtime.registerView(1);
  view.report({ referencedSessionIds: ["b", "a"], activeSessionId: "a" });
  const snapshot = runtime.getSnapshot();
  view.report({ referencedSessionIds: ["a", "b"], activeSessionId: "a" });
  expect(runtime.getSnapshot()).toBe(snapshot);
  expect(runtime.getSnapshot().foregroundSessionIds).toEqual([]);
});
it("isolates a throwing observer so later observers and load cleanup still run", async () => {
  load.mockResolvedValueOnce(session("s"));
  const runtime = createHarnessSessionRuntime({ loadSession: load });
  const later = vi.fn();
  runtime.subscribe(() => {
    throw new Error("view error");
  });
  runtime.subscribe(later);
  expect(await runtime.ensureSessionLoaded("s")).toMatchObject({ id: "s" });
  expect(later).toHaveBeenCalled();
  expect(runtime.getSnapshot().pendingOperationCount).toBe(0);
});
it("an explicitly admitted session supersedes a pending idle hydrate for the same slot", async () => {
  const pending = deferred<Session | undefined>();
  load.mockReturnValue(pending.promise);
  const runtime = createHarnessSessionRuntime(
    { loadSession: load },
    { maxSessions: 1 },
  );
  const old = runtime.ensureSessionLoaded("s");
  const cancelled = expect(old).rejects.toMatchObject({
    code: "HARNESS_SESSION_CANCELLED",
  });
  await Promise.resolve();
  const created = runtime.admitSession(session("s", "/new", { busy: true }));
  pending.resolve(session("s", "/old"));
  await cancelled;
  expect(runtime.getSession("s")).toBe(created);
});
it.each([0, -1, 257, 1.5, NaN, Infinity])(
  "rejects invalid runtime limits %s without admission",
  (value) => {
    expect(() =>
      createHarnessSessionRuntime(
        { loadSession: load },
        { maxSessions: value },
      ),
    ).toThrow(RangeError);
  },
);
it.each(["", " ", "s".repeat(257)])(
  "rejects an invalid identity before issuing a load",
  async (id) => {
    const runtime = createHarnessSessionRuntime({ loadSession: load });
    await expect(runtime.ensureSessionLoaded(id)).rejects.toThrow(TypeError);
    expect(load).not.toHaveBeenCalled();
  },
);
it("orders opaque ids exactly, without locale ties or unicode normalization", () => {
  const one = createHarnessSessionRuntime({ loadSession: load });
  const two = createHarnessSessionRuntime({ loadSession: load });
  const ids = ["é", "e\u0301", "__proto__", "A", "a"];
  for (const id of ids) one.admitSession(session(id, "/same", { busy: true }));
  for (const id of [...ids].reverse())
    two.admitSession(session(id, "/same", { busy: true }));
  expect(one.getSnapshot().busySessionIds).toEqual([...ids].sort());
  expect(two.getSnapshot().busySessionIds).toEqual(
    one.getSnapshot().busySessionIds,
  );
});
it("does not invoke a removed load when cancellation occurs before the deferred loader starts", async () => {
  const runtime = createHarnessSessionRuntime({ loadSession: load });
  const pending = runtime.ensureSessionLoaded("s");
  const cancelled = expect(pending).rejects.toMatchObject({
    code: "HARNESS_SESSION_CANCELLED",
  });
  runtime.removeSession("s");
  await cancelled;
  expect(load).not.toHaveBeenCalled();
});
