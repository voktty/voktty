import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { MemoryContextResult } from "@/modules/workspace-kit/lib/context";
import type { MemoryConversation } from "@/modules/workspace-kit/lib/memoryConversation";
import {
  createMemoryConversations,
  qualifyMemoryConversation,
} from "@/modules/workspace-kit/lib/memoryConversations";
import { createNativeMemoryPresentation } from "@/modules/workspace-kit/lib/nativeMemory";
import { trustReply } from "@/modules/workspace-kit/lib/nativeMemoryTrust.test-utils";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
const packet: MemoryContextResult = {
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
let scopes: MemoryConversation[];
let panels: ReturnType<typeof createNativeMemoryPresentation>[];
function capture(manager = createMemoryConversations(), owner = {}) {
  const scope = manager.capture(owner, "/project", "/project", () => true);
  scopes.push(scope);
  return scope;
}
async function bind(scope: MemoryConversation) {
  const presentation = createNativeMemoryPresentation();
  panels.push(presentation);
  const selection = await presentation.select(scope.cwd, { kind: "local" });
  const review = await presentation.reviewTrust(selection);
  await scope.bind({ presentation, selection, review, mode: "enabled" });
}
beforeEach(() => {
  scopes = [];
  panels = [];
  let nextId = 1;
  invoke.mockReset().mockImplementation(async (command, args) => {
    if (command === "project_memory_open") return { id: 1, token: "panel" };
    if (command === "project_memory_select") return "selection";
    if (command === "project_memory_review_trust")
      return trustReply(args.request.revision);
    if (command === "project_memory_context_open")
      return { id: nextId++, token: "00000000-0000-4000-8000-000000000009" };
    if (command === "project_memory_context_bind")
      return { schema: 1, root: trustReply().root };
    if (command === "project_memory_context_read") return packet;
  });
});
afterEach(async () => {
  await Promise.all(scopes.map((scope) => scope.close()));
  await Promise.all(panels.map((panel) => panel.close()));
});

it("does not allocate native resources or enable delivery without an adapter", async () => {
  const manager = createMemoryConversations();
  const owner = {};
  const scope = capture(manager, owner);
  expect(manager.capture(owner, "/project", "/project", () => true, true)).toBe(
    scope,
  );
  expect(scope.delivery?.getSnapshot().supported).toBe(false);
  expect(await scope.read()).toBeNull();
  expect(manager.turnSource(owner, () => undefined)).toBeUndefined();
  expect(invoke).not.toHaveBeenCalled();
  await bind(scope);
  expect(await scope.read()).toEqual(packet);
  if (!packet.packet) throw new Error("Missing fixture packet");
  await expect(
    scope.delivery?.enable(packet.packet, () => true),
  ).rejects.toMatchObject({
    code: "cancelled",
  });
});

it("keeps model ownership independent of a retired presentation capture", async () => {
  const scope = capture();
  let visible = true;
  const view = qualifyMemoryConversation(scope, () => visible);
  await bind(view);
  visible = false;
  await expect(view.read()).rejects.toMatchObject({ code: "cancelled" });
  await expect(view.close()).rejects.toMatchObject({ code: "cancelled" });
  expect(await scope.read()).toEqual(packet);
  expect(scope.status()).toBe("ready");
});

it("retires only removed owners while preserving a sibling at the same root", async () => {
  const manager = createMemoryConversations();
  const owner = {};
  const siblingOwner = {};
  const old = capture(manager, owner);
  const sibling = capture(manager, siblingOwner);
  await bind(old);
  await bind(sibling);
  const observed: string[] = [];
  old.subscribe(() => observed.push(old.status()));
  manager.reconcile([siblingOwner]);
  expect(observed).toEqual(["retired"]);
  expect(old.isCurrent()).toBe(false);
  const replacement = capture(manager, owner);
  expect(replacement).not.toBe(old);
  expect(await replacement.read()).toBeNull();
  expect(await sibling.read()).toEqual(packet);
  manager.dispose();
  expect(sibling.isCurrent()).toBe(false);
});

it("shares the resource budget across consumers until retired reads settle", async () => {
  const first = createMemoryConversations();
  const second = createMemoryConversations();
  const scope = capture(first);
  await bind(scope);
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
  await scope.close();
  for (let index = 0; index < 255; index++) capture(second);
  expect(() => capture(first)).toThrowError("busy");
  read.resolve(packet);
  expect(await pending).toMatchObject({ code: "cancelled" });
  expect(capture(first).status()).toBe("inactive");
  first.dispose();
  second.dispose();
});

it("retains failed cleanup for retry without closing a successor", async () => {
  const manager = createMemoryConversations();
  const owner = {};
  const old = capture(manager, owner);
  await bind(old);
  const original = invoke.getMockImplementation();
  let failed = false;
  invoke.mockImplementation((command, args) => {
    if (command === "project_memory_context_close" && !failed) {
      failed = true;
      return Promise.reject({ code: "unavailable" });
    }
    return original?.(command, args);
  });
  await expect(old.close()).rejects.toMatchObject({ code: "unavailable" });
  const next = capture(manager, owner);
  await bind(next);
  await old.close();
  expect(await next.read()).toEqual(packet);
});

async function deliveryFixture() {
  const manager = createMemoryConversations((_conversation, onReceipt) => ({
    capture: (assertCurrent: () => void) => ({ assertCurrent, onReceipt }),
  }));
  const owner = {};
  const scope = manager.capture(
    owner,
    "/project",
    "/project",
    () => true,
    true,
  );
  scopes.push(scope);
  await bind(scope);
  if (!packet.packet || !scope.delivery) throw new Error("Missing delivery");
  await scope.delivery.enable(packet.packet, () => true);
  return {
    manager,
    owner,
    scope,
    delivery: scope.delivery,
    input: packet.packet,
  };
}

it("disables future delivery without native writes, losing the binding or affecting siblings", async () => {
  const f = await deliveryFixture();
  const sibling = await deliveryFixture();
  const source = f.manager.turnSource(f.owner, () => undefined);
  expect(source).toBeDefined();
  const calls = invoke.mock.calls.length;
  f.delivery.disable(() => true);
  expect(invoke.mock.calls).toHaveLength(calls);
  expect(f.scope.status()).toBe("ready");
  expect(f.delivery.getSnapshot().enabled).toBe(false);
  expect(f.manager.turnSource(f.owner, () => undefined)).toBeUndefined();
  expect(sibling.delivery.getSnapshot().enabled).toBe(true);
  expect(await f.scope.read()).toEqual(packet);
  await f.delivery.enable(f.input, () => true);
  expect(f.delivery.getSnapshot().enabled).toBe(true);
  expect(() => source?.assertCurrent()).toThrowError("cancelled");
  expect(() =>
    f.manager.turnSource(f.owner, () => undefined)?.assertCurrent(),
  ).not.toThrow();
});

it("withdraws an in-flight enable when disabled and requires a new native check", async () => {
  const f = await deliveryFixture();
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
  const enabling = f.delivery
    .enable(f.input, () => true)
    .catch((error: unknown) => error);
  await started.promise;
  f.delivery.disable(() => true);
  read.resolve(packet);
  expect(await enabling).toMatchObject({ code: "cancelled" });
  expect(f.delivery.getSnapshot().enabled).toBe(false);
  expect(f.scope.status()).toBe("ready");
  if (!original) throw new Error("Missing native fixture");
  invoke.mockImplementation(original);
  await f.delivery.enable(f.input, () => true);
  expect(f.delivery.getSnapshot().enabled).toBe(true);
});

it("refuses disable from a retired presentation or caller", async () => {
  const f = await deliveryFixture();
  let visible = true;
  const view = qualifyMemoryConversation(f.scope, () => visible);
  expect(() => view.delivery?.disable(() => false)).toThrowError("cancelled");
  visible = false;
  expect(() => view.delivery?.disable(() => true)).toThrowError("cancelled");
  expect(f.delivery.getSnapshot().enabled).toBe(true);
});
