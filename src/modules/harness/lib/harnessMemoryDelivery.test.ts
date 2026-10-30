import { expect, it, vi } from "vitest";
import { createHarnessMemoryDelivery } from "@/modules/harness/lib/harnessMemoryDelivery";
import type { MemoryConversation } from "@/modules/workspace-kit/lib/memoryConversation";
import type { MemoryContextResult } from "@/modules/workspace-kit/lib/context";

function result(text = "PROJECT MEMORY (.voktty)"): MemoryContextResult {
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
      text,
      bytes: new TextEncoder().encode(text).length,
      contentState: "available",
    },
  };
}
function fixture() {
  let active = true;
  const read = vi.fn(async () => result());
  const conversation: MemoryConversation = {
    projectCwd: "/project",
    cwd: "/project",
    isCurrent: () => active,
    status: () => (active ? "ready" : "retired"),
    subscribe: () => () => {},
    bind: async () => {},
    read,
    close: async () => {
      active = false;
    },
  };
  const delivery = createHarnessMemoryDelivery(conversation);
  const source = delivery.capture(() => {});
  return { conversation, delivery, source, read };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

it("records acceptance separately from preparation and reads policy even for an unchanged provider", async () => {
  const f = fixture();
  const provider = {};
  const prepared = await f.source.prepare(provider, "provider", () => {});
  expect(prepared?.prefix).toBe(result().packet?.text);
  expect(f.delivery.receipt()).toBeNull();
  expect(prepared?.acknowledge()).toBe(true);
  expect(f.delivery.receipt()).toEqual({
    schema: 1,
    adapter: "codex",
    method: "managed-turn",
    providerSessionId: "provider",
    packet: result().packet,
  });
  const again = await f.source.prepare(provider, "provider", () => {});
  expect(again?.prefix).toBeNull();
  expect(f.read).toHaveBeenCalledTimes(2);
});

it("reintroduces memory after transport replacement, compaction epoch or provider change", async () => {
  const f = fixture();
  const context = {};
  (await f.source.prepare(context, "first", () => {}))?.acknowledge();
  expect((await f.source.prepare({}, "first", () => {}))?.prefix).toBe(
    result().packet?.text,
  );
  expect((await f.source.prepare(context, "second", () => {}))?.prefix).toBe(
    result().packet?.text,
  );
});

it("reintroduces changed factual text even when an input digest is unchanged", async () => {
  const f = fixture();
  const context = {};
  (await f.source.prepare(context, "provider", () => {}))?.acknowledge();
  f.read.mockResolvedValue(result("Updated facts"));
  expect((await f.source.prepare(context, "provider", () => {}))?.prefix).toBe(
    "Updated facts",
  );
});

it("does not start IO for inactive memory", async () => {
  const f = fixture();
  const delivery = createHarnessMemoryDelivery({
    ...f.conversation,
    status: () => "inactive",
  });
  expect(
    await delivery.capture(() => {}).prepare({}, "provider", () => {}),
  ).toBeNull();
  expect(f.read).not.toHaveBeenCalled();
});

it("blocks revoked policy despite a previous accepted receipt", async () => {
  const f = fixture();
  const context = {};
  (await f.source.prepare(context, "provider", () => {}))?.acknowledge();
  const denied: MemoryContextResult = {
    schema: 1,
    decision: {
      schema: 1,
      policy: "never",
      contextAllowed: false,
      captureAllowed: false,
      reason: "KIT_MEMORY_POLICY_NEVER",
    },
    packet: null,
  };
  f.read.mockResolvedValue(denied);
  await expect(
    f.source.prepare(context, "provider", () => {}),
  ).rejects.toMatchObject({ code: "KIT_MEMORY_POLICY_NEVER" });
});

it.each(["caller", "transport", "conversation"])(
  "rejects retirement of the original %s during reads and before acceptance",
  async (kind) => {
    const f = fixture();
    let active = true;
    const check = () => {
      if (!active) throw new Error("retired");
    };
    const source = f.delivery.capture(kind === "caller" ? check : () => {});
    const transport = kind === "transport" ? check : () => {};
    const old = await source.prepare({}, "provider", transport);
    const read = deferred<MemoryContextResult>();
    f.read.mockReturnValue(read.promise);
    const pending = source
      .prepare({}, "provider", transport)
      .catch((error: unknown) => error);
    if (kind === "conversation") await f.conversation.close();
    else active = false;
    read.resolve(result());
    expect(await pending).toBeInstanceOf(Error);
    expect(old?.acknowledge()).toBe(false);
    expect(f.delivery.receipt()).toBeNull();
  },
);

it("does not let an older acknowledgment overwrite a newer packet", async () => {
  const f = fixture();
  const old = await f.source.prepare({}, "old", () => {});
  const next = await f.source.prepare({}, "next", () => {});
  expect(next?.acknowledge()).toBe(true);
  expect(old?.acknowledge()).toBe(false);
  expect(old?.acknowledge()).toBe(false);
  expect(f.delivery.receipt()?.providerSessionId).toBe("next");
});

it("retains an immutable copy of the packet actually prepared for delivery", async () => {
  const f = fixture();
  const original = result().packet;
  if (!original) throw new Error("Missing packet");
  const packet = { ...original };
  f.read.mockResolvedValue({ ...result(), packet });
  const prepared = await f.source.prepare({}, "provider", () => {});
  packet.text = "later mutation";
  expect(prepared?.prefix).toBe(result().packet?.text);
  expect(prepared?.acknowledge()).toBe(true);
  expect(f.delivery.receipt()?.packet.text).toBe(result().packet?.text);
  expect(Object.isFrozen(f.delivery.receipt()?.packet)).toBe(true);
});

it("retains shared capacity through actual read settlement, including retired callers", async () => {
  const read = deferred<MemoryContextResult>();
  let active = true;
  const f = fixture();
  f.read.mockReturnValue(read.promise);
  const source = f.delivery.capture(() => {
    if (!active) throw new Error("retired");
  });
  const work = Array.from({ length: 256 }, () =>
    source.prepare({}, "provider", () => {}).catch((error: unknown) => error),
  );
  await expect(source.prepare({}, "provider", () => {})).rejects.toMatchObject({
    code: "busy",
  });
  active = false;
  await expect(
    f.source.prepare({}, "provider", () => {}),
  ).rejects.toMatchObject({ code: "busy" });
  read.resolve(result());
  expect(
    (await Promise.all(work)).every((value) => value instanceof Error),
  ).toBe(true);
  expect(await f.source.prepare({}, "provider", () => {})).not.toBeNull();
});
