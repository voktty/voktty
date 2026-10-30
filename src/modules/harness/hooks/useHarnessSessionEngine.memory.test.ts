// @vitest-environment happy-dom
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useHarnessSessionEngine } from "@/modules/harness/hooks/useHarnessSessionEngine";
import { useHarnessViewEngine } from "@/modules/harness/hooks/useHarnessViewEngine";
import { useWindowPersistenceAdmission } from "@/modules/harness/hooks/useWindowPersistenceAdmission";
import { createHarnessWindowSessionHolds } from "@/modules/harness/lib/harnessWindowSessionHolds";
import {
  createHarnessMemorySessions,
  type HarnessMemorySession,
} from "@/modules/harness/lib/harnessMemorySessions";
import { windowPersistenceAdmission } from "@/modules/harness/lib/persistenceAdmission";
import type { Session } from "@/modules/harness/lib/session";
import { createNativeMemoryPresentation } from "@/modules/workspace-kit/lib/nativeMemory";
import { trustReply } from "@/modules/workspace-kit/lib/nativeMemoryTrust.test-utils";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@/modules/harness/lib/harness", () => ({}));
vi.mock("@/modules/harness/lib/dockBadge", () => ({ syncDockBadge: vi.fn() }));
vi.mock("@/modules/harness/lib/sounds", () => ({ playCue: vi.fn() }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (value: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function chat(id = "source", patch: Partial<Session> = {}): Session {
  return {
    id,
    harness: "claude",
    model: "test",
    modelSettings: {},
    runtimeMode: "supervised",
    cwd: "/project",
    title: "named",
    blocks: [],
    ...patch,
  };
}
function packet() {
  return {
    schema: 1,
    decision: {
      schema: 1,
      policy: "manual",
      contextAllowed: true,
      captureAllowed: false,
      reason: "KIT_MEMORY_READY",
    },
    packet: {
      schema: 1,
      projectKey: "a".repeat(64),
      instructionDigest: "b".repeat(64),
      digest: "c".repeat(64),
      bytes: 2,
      text: "ñ",
      contentState: "initial",
    },
  };
}
let roots: Root[];
let scopes: HarnessMemorySession[];
let panels: ReturnType<typeof createNativeMemoryPresentation>[];
function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined)
    throw new Error("Missing test receipt");
  return value;
}
function capture(
  engine: ReturnType<typeof useHarnessSessionEngine>,
  id = "source",
) {
  const scope = required(engine.captureMemorySession(id));
  scopes.push(scope);
  return scope;
}
function mount(sessions = [chat()]) {
  let engine!: ReturnType<typeof useHarnessSessionEngine>;
  let view!: ReturnType<typeof useHarnessViewEngine>;
  const holds = createHarnessWindowSessionHolds();
  const root = createRoot(document.createElement("div"));
  roots.push(root);
  function View() {
    const { getOwner } = useWindowPersistenceAdmission(() => undefined);
    view = useHarnessViewEngine(engine, getOwner, holds);
    return null;
  }
  function Host({ visible }: { visible: boolean }) {
    engine = useHarnessSessionEngine({
      initialSessions: () => sessions,
      isForeground: () => true,
      isRemoving: () => false,
      isSwitching: () => false,
    });
    return visible ? createElement(View) : null;
  }
  const render = (visible: boolean) =>
    act(() =>
      root.render(
        createElement(StrictMode, null, createElement(Host, { visible })),
      ),
    );
  render(true);
  return {
    engine: () => engine,
    view: () => view,
    hide: () => render(false),
    show: () => render(true),
    unmount: () => act(() => root.unmount()),
  };
}
async function input(
  scope: HarnessMemorySession,
  path = scope.cwd,
  local = true,
) {
  const presentation = createNativeMemoryPresentation();
  panels.push(presentation);
  const selection = await presentation.select(
    path,
    local ? { kind: "local" } : { kind: "wsl", distro: "Test" },
  );
  const review = await presentation.reviewTrust(selection);
  return { presentation, selection, review, mode: "enabled" as const };
}
beforeEach(() => {
  roots = [];
  scopes = [];
  panels = [];
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let nextId = 10;
  invoke.mockReset().mockImplementation(async (command, args) => {
    if (command === "project_memory_open") return { id: 1, token: "panel" };
    if (command === "project_memory_select") return "selection";
    if (command === "project_memory_review_trust")
      return trustReply(args.request.revision);
    if (command === "project_memory_context_open")
      return { id: nextId++, token: "00000000-0000-4000-8000-000000000009" };
    if (command === "project_memory_context_bind")
      return { schema: 1, root: trustReply().root };
    if (command === "project_memory_context_read") return packet();
  });
});
afterEach(async () => {
  await act(async () => {
    for (const root of roots) root.unmount();
  });
  await Promise.all(scopes.map((scope) => scope.close()));
  await Promise.all(panels.map((panel) => panel.close()));
  vi.unstubAllGlobals();
});

it("keeps capture and inactive reads free of native IO and survives transcript changes", async () => {
  const f = mount();
  const scope = capture(f.engine());
  expect(scope.cwd).toBe("/project");
  expect(scope.status()).toBe("inactive");
  expect(await scope.read()).toBeNull();
  expect(invoke).not.toHaveBeenCalled();
  act(() =>
    f.engine().updateSession(
      "source",
      (session) => ({
        ...session,
        title: "changed",
        providerSessionId: "provider",
        blocks: [{ id: "message", role: "user", text: "new" }],
      }),
      "immediate",
    ),
  );
  expect(capture(f.engine())).toBe(scope);
  expect(scope.isCurrent()).toBe(true);
  expect(invoke).not.toHaveBeenCalled();
});
it("keeps admitted memory after panel and originating view close, but closes on engine removal", async () => {
  const f = mount();
  const raw = capture(f.engine());
  const view = required(f.view().captureMemorySession("source"));
  const saved = JSON.stringify(f.engine().sessions);
  await view.bind(await input(view));
  expect(JSON.stringify(f.engine().sessions)).toBe(saved);
  for (const panel of panels) await panel.close();
  f.hide();
  expect(view.isCurrent()).toBe(false);
  await expect(view.read()).rejects.toMatchObject({ code: "cancelled" });
  expect(raw.status()).toBe("ready");
  expect(await raw.read()).toEqual(packet());
  expect(
    invoke.mock.calls.some(
      ([command]) => command === "project_memory_context_close",
    ),
  ).toBe(false);
  f.show();
  expect(required(f.view().captureMemorySession("source")).status()).toBe(
    "ready",
  );
  f.unmount();
  await raw.close();
  expect(raw.isCurrent()).toBe(false);
  expect(
    invoke.mock.calls.filter(
      ([command]) => command === "project_memory_context_close",
    ),
  ).toHaveLength(1);
});
const changes: Partial<Session>[] = [
  { cwd: "/other" },
  { worktreeCwd: "/worktree" },
  { harness: "codex" },
  { runtimeMode: "auto" },
  { providerAccountId: "other-account" },
];
it.each(changes)(
  "retires exact memory across a preparation-context roundtrip: %j",
  async (patch) => {
    const f = mount([chat(), chat("sibling")]);
    const scope = capture(f.engine());
    const sibling = capture(f.engine(), "sibling");
    await scope.bind(await input(scope));
    await sibling.bind(await input(sibling));
    const original = required(f.engine().readSession("source"));
    act(() =>
      f.engine().applySessionDeltas(
        [
          {
            kind: "update",
            id: "source",
            update: (session) => ({ ...session, ...patch }),
          },
          {
            kind: "update",
            id: "source",
            update: (session) => ({
              ...session,
              cwd: original.cwd,
              worktreeCwd: original.worktreeCwd,
              harness: original.harness,
              runtimeMode: original.runtimeMode,
              providerAccountId: original.providerAccountId,
            }),
          },
        ],
        "immediate",
      ),
    );
    expect(scope.isCurrent()).toBe(false);
    await expect(scope.read()).rejects.toMatchObject({ code: "cancelled" });
    await scope.close();
    expect(capture(f.engine()).status()).toBe("inactive");
    expect(await sibling.read()).toEqual(packet());
  },
);
it.each(["scheduled", "immediate"] as const)(
  "does not reuse memory after %s removal and readmission with the same ID",
  async (scheduling) => {
    const f = mount();
    const old = capture(f.engine());
    await old.bind(await input(old));
    act(() =>
      f.engine().applySessionDeltas(
        [
          { kind: "remove", id: "source" },
          { kind: "admit", session: chat() },
        ],
        scheduling,
      ),
    );
    expect(old.isCurrent()).toBe(false);
    const next = capture(f.engine());
    expect(next).not.toBe(old);
    expect(await next.read()).toBeNull();
    await old.close();
    await next.bind(await input(next));
    expect(await next.read()).toEqual(packet());
  },
);
it("ignores rejected deltas and keeps an exact current binding", async () => {
  const f = mount();
  const scope = capture(f.engine());
  await scope.bind(await input(scope));
  act(() =>
    f.engine().applySessionDeltas(
      [
        { kind: "remove", id: "source", expected: chat() },
        { kind: "remove", id: "source", shouldRemove: () => false },
      ],
      "immediate",
    ),
  );
  expect(capture(f.engine())).toBe(scope);
  expect(await scope.read()).toEqual(packet());
});
it.each(["path", "filesystem", "namespace"])(
  "refuses another execution %s before opening native context",
  async (kind) => {
    const f = mount([
      chat("source", {
        worktreeCwd:
          kind === "namespace" ? "remote://host/project" : "/project/worktree",
      }),
    ]);
    const scope = capture(f.engine());
    const binding = await input(
      scope,
      kind === "path" ? "/project" : scope.cwd,
      kind !== "filesystem",
    );
    await expect(scope.bind(binding)).rejects.toMatchObject({
      code: "cancelled",
    });
    expect(scope.status()).toBe("inactive");
    expect(
      invoke.mock.calls.some(
        ([command]) => command === "project_memory_context_open",
      ),
    ).toBe(false);
  },
);
it("retires binding when the initiating view closes before native open finishes", async () => {
  const f = mount();
  const raw = capture(f.engine());
  const scope = required(f.view().captureMemorySession("source"));
  const binding = await input(scope);
  const open = deferred<unknown>();
  const started = deferred<void>();
  const original = invoke.getMockImplementation();
  invoke.mockImplementation((command, args) => {
    if (command === "project_memory_context_open") {
      started.resolve();
      return open.promise;
    }
    return original?.(command, args);
  });
  const pending = scope.bind(binding).catch((error: unknown) => error);
  await started.promise;
  f.hide();
  open.resolve({ id: 99, token: "00000000-0000-4000-8000-000000000099" });
  expect(await pending).toMatchObject({ code: "cancelled" });
  expect(raw.status()).toBe("retired");
  expect(
    invoke.mock.calls.some(
      ([command]) => command === "project_memory_context_bind",
    ),
  ).toBe(false);
  expect(invoke).toHaveBeenLastCalledWith("project_memory_context_close", {
    handle: { id: 99, token: "00000000-0000-4000-8000-000000000099" },
  });
});
it("rejects late packets from a removed context without touching its successor", async () => {
  const f = mount();
  const scope = capture(f.engine());
  await scope.bind(await input(scope));
  const read = deferred<unknown>();
  const started = deferred<void>();
  const original = invoke.getMockImplementation();
  invoke.mockImplementation((command, args) => {
    if (command === "project_memory_context_read") {
      started.resolve();
      return read.promise;
    }
    return original?.(command, args);
  });
  const pending = scope.read().catch((error: unknown) => error);
  await started.promise;
  act(() =>
    f
      .engine()
      .updateSession(
        "source",
        (session) => ({ ...session, cwd: "/new" }),
        "immediate",
      ),
  );
  const next = capture(f.engine());
  read.resolve(packet());
  expect(await pending).toMatchObject({ code: "cancelled" });
  expect(next.status()).toBe("inactive");
  await next.bind(await input(next));
  expect(await next.read()).toEqual(packet());
});
it("retains failed cleanup for an exact retry without retiring a replacement", async () => {
  const f = mount();
  const scope = capture(f.engine());
  await scope.bind(await input(scope));
  invoke.mockRejectedValueOnce({ code: "unavailable" });
  await expect(scope.close()).rejects.toMatchObject({ code: "unavailable" });
  const next = capture(f.engine());
  await next.bind(await input(next));
  await scope.close();
  expect(await next.read()).toEqual(packet());
});
it("bounds retained context receipts and frees them only after cleanup", async () => {
  const manager = createHarnessMemorySessions();
  for (let i = 0; i < 256; i++)
    scopes.push(manager.capture({}, "/project", "/project", () => true));
  expect(() =>
    manager.capture({}, "/other", "/other", () => true),
  ).toThrowError("busy");
  await scopes[0].close();
  scopes.push(manager.capture({}, "/other", "/other", () => true));
  manager.dispose();
  expect(invoke).not.toHaveBeenCalled();
});

it("does not revive an old view permission after close cancellation", async () => {
  const f = mount();
  const raw = capture(f.engine());
  const stale = required(f.view().captureMemorySession("source"));
  const binding = await input(stale);
  const closer = windowPersistenceAdmission.createOwner();
  const final = required(required(closer.capture()).seal());
  final.cancel();
  closer.retire();
  await expect(stale.bind(binding)).rejects.toMatchObject({
    code: "cancelled",
  });
  expect(raw.status()).toBe("inactive");
  expect(
    invoke.mock.calls.some(
      ([command]) => command === "project_memory_context_open",
    ),
  ).toBe(false);
  const fresh = required(f.view().captureMemorySession("source"));
  await fresh.bind(binding);
  expect(raw.status()).toBe("ready");
});
it("preserves an engine-owned read when the view retires during its delivery", async () => {
  const f = mount();
  const raw = capture(f.engine());
  const view = required(f.view().captureMemorySession("source"));
  await view.bind(await input(view));
  const read = deferred<unknown>();
  const started = deferred<void>();
  const original = invoke.getMockImplementation();
  invoke.mockImplementation((command, args) => {
    if (command === "project_memory_context_read") {
      started.resolve();
      return read.promise;
    }
    return original?.(command, args);
  });
  const pending = view.read().catch((error: unknown) => error);
  await started.promise;
  const engineRead = raw.read();
  f.hide();
  read.resolve(packet());
  expect(await pending).toMatchObject({ code: "cancelled" });
  expect(await engineRead).toEqual(packet());
  expect(raw.status()).toBe("ready");
  expect(
    invoke.mock.calls.some(
      ([command]) => command === "project_memory_context_close",
    ),
  ).toBe(false);
});
it("rejects a second bind while retaining the first exact admission", async () => {
  const f = mount();
  const scope = capture(f.engine());
  const binding = await input(scope);
  const bind = deferred<unknown>();
  const started = deferred<void>();
  const original = invoke.getMockImplementation();
  invoke.mockImplementation((command, args) => {
    if (command === "project_memory_context_bind") {
      started.resolve();
      return bind.promise;
    }
    return original?.(command, args);
  });
  const pending = scope.bind(binding);
  await started.promise;
  await expect(scope.bind(binding)).rejects.toMatchObject({ code: "busy" });
  await expect(scope.read()).rejects.toMatchObject({ code: "busy" });
  bind.resolve({ schema: 1, root: binding.review.snapshot.root });
  await pending;
  expect(await scope.read()).toEqual(packet());
  expect(
    invoke.mock.calls.filter(
      ([command]) => command === "project_memory_context_bind",
    ),
  ).toHaveLength(1);
});
it("reserves binding before evaluating a reentrant caller permission", async () => {
  const f = mount();
  const scope = capture(f.engine());
  const binding = await input(scope);
  let nested: Promise<unknown> | undefined;
  await scope.bind(binding, () => {
    nested ??= scope.bind(binding).catch((error: unknown) => error);
    return true;
  });
  expect(await nested).toMatchObject({ code: "busy" });
  expect(await scope.read()).toEqual(packet());
  expect(
    invoke.mock.calls.filter(
      ([command]) => command === "project_memory_context_bind",
    ),
  ).toHaveLength(1);
});
it("retains retired reads in the shared receipt budget through physical settlement", async () => {
  const manager = createHarnessMemorySessions();
  const read = deferred<unknown>();
  const pending: Promise<unknown>[] = [];
  let started = deferred<void>();
  const original = invoke.getMockImplementation();
  invoke.mockImplementation((command, args) => {
    if (command === "project_memory_context_read") {
      started.resolve();
      return read.promise;
    }
    return original?.(command, args);
  });
  for (let index = 0; index < 256; index++) {
    const scope = manager.capture({}, "/project", "/project", () => true);
    scopes.push(scope);
    await scope.bind(await input(scope));
    started = deferred<void>();
    pending.push(scope.read().catch((error: unknown) => error));
    await started.promise;
    await scope.close();
  }
  expect(() => manager.capture({}, "/next", "/next", () => true)).toThrowError(
    "busy",
  );
  read.resolve(packet());
  for (const result of await Promise.all(pending))
    expect(result).toMatchObject({ code: "cancelled" });
  scopes.push(manager.capture({}, "/next", "/next", () => true));
  manager.dispose();
});

it("publishes binding, usable readiness and retirement without native IO on subscription", async () => {
  const f = mount();
  const scope = capture(f.engine());
  const states: string[] = [];
  let read: Promise<unknown> | undefined;
  scope.subscribe(() => {
    states.push(scope.status());
    if (scope.status() === "ready") read = scope.read();
  });
  expect(invoke).not.toHaveBeenCalled();
  await scope.bind(await input(scope));
  expect(await read).toEqual(packet());
  act(() => f.engine().removeSession("source"));
  await scope.close();
  expect(states).toEqual(["binding", "ready", "retired"]);
});

it("returns to inactive after a rejected selection and allows exact unsubscription", async () => {
  const f = mount();
  const scope = capture(f.engine());
  const states: string[] = [];
  const unsubscribe = scope.subscribe(() => states.push(scope.status()));
  await expect(scope.bind(await input(scope, "/other"))).rejects.toMatchObject({
    code: "cancelled",
  });
  expect(states).toEqual(["binding", "inactive"]);
  unsubscribe();
  await scope.bind(await input(scope));
  await scope.close();
  expect(states).toEqual(["binding", "inactive"]);
});

it("isolates throwing observers and skips observers removed during notification", async () => {
  const f = mount();
  const scope = capture(f.engine());
  const removed = vi.fn();
  let unsubscribe: () => void = () => undefined;
  scope.subscribe(() => {
    unsubscribe();
    throw new Error("observer");
  });
  unsubscribe = scope.subscribe(removed);
  await scope.bind(await input(scope));
  expect(await scope.read()).toEqual(packet());
  expect(removed).not.toHaveBeenCalled();
});

it.each(["binding", "ready"])(
  "honors observer retirement during %s publication",
  async (state) => {
    const f = mount();
    const scope = capture(f.engine());
    let closing: Promise<void> | undefined;
    const states: string[] = [];
    scope.subscribe(() => {
      states.push(scope.status());
      if (scope.status() === state) closing = scope.close();
    });
    await expect(scope.bind(await input(scope))).rejects.toMatchObject({
      code: "cancelled",
    });
    await closing;
    expect(scope.status()).toBe("retired");
    expect(states[states.length - 1]).toBe("retired");
    expect(
      invoke.mock.calls.filter(
        ([command]) => command === "project_memory_context_bind",
      ),
    ).toHaveLength(state === "binding" ? 0 : 1);
  },
);

it("publishes retirement once and reserves exact cleanup before reentrant close", async () => {
  const f = mount();
  const scope = capture(f.engine());
  await scope.bind(await input(scope));
  let nested: Promise<void> | undefined;
  const observer = vi.fn(() => {
    nested = scope.close();
  });
  scope.subscribe(observer);
  const closing = scope.close();
  expect(nested).toBe(closing);
  await closing;
  await scope.close();
  expect(observer).toHaveBeenCalledTimes(1);
  expect(
    invoke.mock.calls.filter(
      ([command]) => command === "project_memory_context_close",
    ),
  ).toHaveLength(1);
  const stale = vi.fn();
  scope.subscribe(stale);
  await scope.close();
  expect(stale).not.toHaveBeenCalled();
});

it("bounds observers and releases their slots on unsubscription", async () => {
  const f = mount();
  const scope = capture(f.engine());
  const listeners = Array.from({ length: 256 }, () => () => undefined);
  const removals = listeners.map((listener) => scope.subscribe(listener));
  expect(() => scope.subscribe(() => undefined)).toThrowError("busy");
  const duplicate = scope.subscribe(listeners[0]);
  duplicate();
  const unsubscribe = scope.subscribe(() => undefined);
  unsubscribe();
  for (const remove of removals) remove();
  expect(invoke).not.toHaveBeenCalled();
});
