import { beforeEach, expect, it, vi } from "vitest";
import { createNativeMemoryPresentation } from "@/modules/workspace-kit/lib/nativeMemory";
import {
  createNativeMemoryContext,
  type NativeMemoryContext,
} from "@/modules/workspace-kit/lib/nativeMemoryContext";
import { trustReply } from "@/modules/workspace-kit/lib/nativeMemoryTrust.test-utils";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
const handle = { id: 9, token: "00000000-0000-4000-8000-000000000009" };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
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
      contentState: "initial",
      text: "ñ",
    },
  };
}
beforeEach(() => {
  invoke.mockReset();
  invoke.mockImplementation(async (command, args) => {
    if (command === "project_memory_open") return { id: 1, token: "panel" };
    if (command === "project_memory_select") return "selection";
    if (command === "project_memory_review_trust")
      return trustReply(args.request.revision);
    if (command === "project_memory_context_open") return handle;
    if (command === "project_memory_context_bind")
      return { schema: 1, root: trustReply().root };
    if (command === "project_memory_context_read") return packet();
  });
});
async function setup(isCurrent = () => true) {
  const owner = createNativeMemoryPresentation();
  const selection = await owner.select("/project", { kind: "local" });
  const review = await owner.reviewTrust(selection);
  const context = createNativeMemoryContext(isCurrent);
  return { owner, selection, review, context };
}
it("opens only on explicit bind, consumes the exact review and survives panel closure", async () => {
  const { owner, selection, review, context } = await setup();
  expect(
    invoke.mock.calls.some(([name]) => name === "project_memory_context_open"),
  ).toBe(false);
  await expect(context.read()).rejects.toMatchObject({ code: "cancelled" });
  await owner.bindContext(selection, review, context, "enabled");
  expect(invoke).toHaveBeenLastCalledWith("project_memory_context_bind", {
    handle: { id: 1, token: "panel" },
    selection: "selection",
    context: handle,
    request: { review: trustReply().review, mode: "enabled" },
  });
  expect(owner.isTrustReviewCurrent(selection, review)).toBe(false);
  await owner.close();
  expect(await context.read()).toEqual(packet());
  const closing = context.close();
  expect(context.close()).toBe(closing);
  await closing;
  expect(invoke).toHaveBeenLastCalledWith("project_memory_context_close", {
    handle,
  });
  await expect(context.read()).rejects.toMatchObject({ code: "cancelled" });
  expect(
    invoke.mock.calls.some(([name]) => name === "project_memory_confirm_trust"),
  ).toBe(false);
});
it("rejects fabricated reviews and contexts without native allocation", async () => {
  const { owner, selection, review, context } = await setup();
  await expect(
    owner.bindContext(selection, { ...review }, context, "enabled"),
  ).rejects.toMatchObject({ code: "cancelled" });
  await expect(
    owner.bindContext(selection, review, { ...context }, "enabled"),
  ).rejects.toMatchObject({ code: "cancelled" });
  expect(
    invoke.mock.calls.some(([name]) => name === "project_memory_context_open"),
  ).toBe(false);
  await context.close();
  await owner.close();
});
it.each(["panel", "conversation", "context"] as const)(
  "cleans up the exact late handle when %s retires during open",
  async (retirement) => {
    let current = true;
    const { owner, selection, review, context } = await setup(() => current);
    const opening = deferred<typeof handle>();
    const started = deferred<void>();
    const original = invoke.getMockImplementation();
    invoke.mockImplementation((command, args) => {
      if (command === "project_memory_context_open") {
        started.resolve();
        return opening.promise;
      }
      return original?.(command, args);
    });
    const pending = owner
      .bindContext(selection, review, context, "enabled")
      .catch((error: unknown) => error);
    await started.promise;
    if (retirement === "panel") await owner.close();
    if (retirement === "conversation") current = false;
    const closing = retirement === "context" ? context.close() : null;
    opening.resolve(handle);
    expect(await pending).toMatchObject({ code: "cancelled" });
    await closing;
    expect(
      invoke.mock.calls.filter(
        ([name]) => name === "project_memory_context_close",
      ),
    ).toEqual([["project_memory_context_close", { handle }]]);
    expect(
      invoke.mock.calls.some(
        ([name]) => name === "project_memory_context_bind",
      ),
    ).toBe(false);
    await owner.close();
  },
);
it("coalesces reads and rejects late data after original conversation retirement", async () => {
  let current = true;
  const { owner, selection, review, context } = await setup(() => current);
  await owner.bindContext(selection, review, context, "inherit");
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
  const first = context.read();
  expect(context.read()).toBe(first);
  const settled = first.catch((error: unknown) => error);
  await started.promise;
  current = false;
  read.resolve(packet());
  expect(await settled).toMatchObject({ code: "cancelled" });
  current = true;
  await expect(context.read()).rejects.toMatchObject({ code: "cancelled" });
  await context.close();
  await owner.close();
});
it("retains failed exact cleanup for retry and never rebinds the retired resource", async () => {
  const { owner, selection, review, context } = await setup();
  await owner.bindContext(selection, review, context, "disabled");
  invoke.mockRejectedValueOnce("close failed");
  await expect(context.close()).rejects.toBe("close failed");
  await expect(context.read()).rejects.toMatchObject({ code: "cancelled" });
  await context.close();
  expect(
    invoke.mock.calls.filter(
      ([name]) => name === "project_memory_context_close",
    ),
  ).toEqual([
    ["project_memory_context_close", { handle }],
    ["project_memory_context_close", { handle }],
  ]);
  await owner.close();
});
it.each(["root", "schema", "failure"])(
  "closes a failed bind (%s)",
  async (kind) => {
    const { owner, selection, review, context } = await setup();
    const original = invoke.getMockImplementation();
    invoke.mockImplementation((command, args) =>
      command === "project_memory_context_bind"
        ? kind === "failure"
          ? Promise.reject({ code: "denied" })
          : Promise.resolve({
              schema: kind === "schema" ? 2 : 1,
              root: "/wrong",
            })
        : original?.(command, args),
    );
    await expect(
      owner.bindContext(selection, review, context, "enabled"),
    ).rejects.toMatchObject({
      code: kind === "failure" ? "denied" : "unavailable",
    });
    expect(invoke).toHaveBeenLastCalledWith("project_memory_context_close", {
      handle,
    });
    await owner.close();
  },
);
it.each([
  "bytes",
  "budget",
  "unicode",
  "digest",
  "capture",
  "decision",
  "missing",
])("rejects malformed context replies (%s)", async (kind) => {
  const { owner, selection, review, context } = await setup();
  await owner.bindContext(selection, review, context, "enabled");
  const wire = packet();
  if (kind === "bytes") wire.packet.bytes = 1;
  if (kind === "budget") {
    wire.packet.text = "ñ".repeat(12289);
    wire.packet.bytes = 24578;
  }
  if (kind === "unicode") {
    wire.packet.text = "\ud800";
    wire.packet.bytes = 3;
  }
  if (kind === "digest") wire.packet.digest = "bad";
  if (kind === "capture") wire.decision.captureAllowed = true;
  if (kind === "decision") wire.decision.reason = "KIT_MEMORY_TRUST_REQUIRED";
  invoke.mockResolvedValueOnce(
    kind === "missing" ? { ...wire, packet: null } : wire,
  );
  await expect(context.read()).rejects.toMatchObject({ code: "unavailable" });
  await context.close();
  await owner.close();
});
it("bounds resources across owners until cleanup succeeds", async () => {
  const owners: Awaited<ReturnType<typeof setup>>[] = [];
  const contexts: NativeMemoryContext[] = [];
  for (let index = 0; index < 256; index++) {
    const item = await setup();
    owners.push(item);
    contexts.push(item.context);
    await item.owner.bindContext(
      item.selection,
      item.review,
      item.context,
      "enabled",
    );
  }
  const extra = await setup();
  await expect(
    extra.owner.bindContext(
      extra.selection,
      extra.review,
      extra.context,
      "enabled",
    ),
  ).rejects.toMatchObject({ code: "busy" });
  await contexts[0].close();
  const nextReview = await extra.owner.reviewTrust(extra.selection);
  await extra.owner.bindContext(
    extra.selection,
    nextReview,
    extra.context,
    "enabled",
  );
  await Promise.all(contexts.map((context) => context.close()));
  await extra.context.close();
  await Promise.all([...owners, extra].map(({ owner }) => owner.close()));
});

it.each(["projectKey", "instructionDigest"] as const)(
  "rejects a packet from a different reviewed %s",
  async (field) => {
    const { owner, selection, review, context } = await setup();
    await owner.bindContext(selection, review, context, "enabled");
    const wire = packet();
    wire.packet[field] = "d".repeat(64);
    invoke.mockResolvedValueOnce(wire);
    await expect(context.read()).rejects.toMatchObject({ code: "unavailable" });
    await context.close();
    await owner.close();
  },
);
it("returns a denied decision without a packet and drops unrelated native fields", async () => {
  const { owner, selection, review, context } = await setup();
  await owner.bindContext(selection, review, context, "disabled");
  const decision = {
    ...packet().decision,
    contextAllowed: false,
    reason: "KIT_MEMORY_SESSION_DISABLED",
  };
  invoke.mockResolvedValueOnce({
    schema: 1,
    decision: { ...decision, privateData: "discard" },
    packet: null,
  });
  const result = await context.read();
  expect(result).toEqual({ schema: 1, decision, packet: null });
  expect(Object.isFrozen(result.decision)).toBe(true);
  await context.close();
  await owner.close();
});
it.each(["policy", "contentState"])(
  "rejects coerced %s values",
  async (field) => {
    const { owner, selection, review, context } = await setup();
    await owner.bindContext(selection, review, context, "enabled");
    const wire = packet();
    if (field === "policy")
      Object.assign(wire.decision, { policy: ["manual"] });
    else Object.assign(wire.packet, { contentState: ["initial"] });
    invoke.mockResolvedValueOnce(wire);
    await expect(context.read()).rejects.toMatchObject({ code: "unavailable" });
    await context.close();
    await owner.close();
  },
);
it("cleans up a bind acknowledgement after its panel closes", async () => {
  const { owner, selection, review, context } = await setup();
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
  const pending = owner
    .bindContext(selection, review, context, "enabled")
    .catch((error: unknown) => error);
  await started.promise;
  await owner.close();
  bind.resolve({ schema: 1, root: review.snapshot.root });
  expect(await pending).toMatchObject({ code: "cancelled" });
  expect(invoke).toHaveBeenLastCalledWith("project_memory_context_close", {
    handle,
  });
});
it("rechecks the conversation after the presentation request await before binding", async () => {
  let current = true;
  let retireAfterCheck = false;
  const { owner, selection, review, context } = await setup(() => {
    if (retireAfterCheck) {
      retireAfterCheck = false;
      queueMicrotask(() => {
        current = false;
      });
    }
    return current;
  });
  const original = invoke.getMockImplementation();
  invoke.mockImplementation((command, args) => {
    if (command === "project_memory_context_open") retireAfterCheck = true;
    return original?.(command, args);
  });
  await expect(
    owner.bindContext(selection, review, context, "enabled"),
  ).rejects.toMatchObject({ code: "cancelled" });
  expect(
    invoke.mock.calls.some(
      ([command]) => command === "project_memory_context_bind",
    ),
  ).toBe(false);
  expect(invoke).toHaveBeenLastCalledWith("project_memory_context_close", {
    handle,
  });
  await owner.close();
});
it("rejects concurrent and repeated binding without closing the incumbent", async () => {
  const { owner, selection, review, context } = await setup();
  const other = await setup();
  await owner.bindContext(selection, review, context, "enabled");
  await expect(
    other.owner.bindContext(other.selection, other.review, context, "enabled"),
  ).rejects.toMatchObject({ code: "cancelled" });
  expect(await context.read()).toEqual(packet());
  await context.close();
  await owner.close();
  await other.context.close();
  await other.owner.close();
});
it("keeps admitted reads counted across close until their actual settlement", async () => {
  const owners: Awaited<ReturnType<typeof setup>>[] = [];
  const pending: Promise<unknown>[] = [];
  const holds: ReturnType<typeof deferred<unknown>>[] = [];
  const original = invoke.getMockImplementation();
  let started = deferred<void>();
  invoke.mockImplementation((command, args) => {
    if (command === "project_memory_context_read") {
      const hold = deferred<unknown>();
      holds.push(hold);
      started.resolve();
      return hold.promise;
    }
    return original?.(command, args);
  });
  for (let index = 0; index < 256; index++) {
    const item = await setup();
    owners.push(item);
    await item.owner.bindContext(
      item.selection,
      item.review,
      item.context,
      "enabled",
    );
    started = deferred<void>();
    pending.push(item.context.read().catch((error: unknown) => error));
    await started.promise;
    await item.context.close();
  }
  const extra = await setup();
  await expect(
    extra.owner.bindContext(
      extra.selection,
      extra.review,
      extra.context,
      "enabled",
    ),
  ).rejects.toMatchObject({ code: "busy" });
  holds[0].resolve(packet());
  expect(await pending[0]).toMatchObject({ code: "cancelled" });
  const next = await extra.owner.reviewTrust(extra.selection);
  await extra.owner.bindContext(
    extra.selection,
    next,
    extra.context,
    "enabled",
  );
  for (const hold of holds) hold.resolve(packet());
  expect(
    (await Promise.all(pending)).every(
      (value) => (value as { code: string }).code === "cancelled",
    ),
  ).toBe(true);
  await extra.context.close();
  await Promise.all([...owners, extra].map(({ owner }) => owner.close()));
});
