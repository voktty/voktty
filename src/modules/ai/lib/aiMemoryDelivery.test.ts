import { afterEach, expect, it, vi } from "vitest";
import {
  createAiMemoryDelivery,
  hasAiMemoryInput,
} from "@/modules/ai/lib/aiMemoryDelivery";
import type { PreparedAiMemoryInput } from "@/modules/ai/lib/projectKitMemory";
import type { MemoryConversation } from "@/modules/workspace-kit/lib/memoryConversation";
import type { MemoryContextResult } from "@/modules/workspace-kit/lib/context";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));

const text = "PROJECT MEMORY (.voktty)\nShared facts.";
function result(): MemoryContextResult {
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
      bytes: new TextEncoder().encode(text).length,
      text,
      contentState: "available",
    },
  };
}
const prepared = new Set<PreparedAiMemoryInput>();
afterEach(() => {
  for (const input of prepared) input.settle();
  prepared.clear();
});
function fixture() {
  let active = true;
  let caller = true;
  const read = vi.fn(async (): Promise<MemoryContextResult> => result());
  const conversation: MemoryConversation = {
    cwd: "/project",
    projectCwd: "/project",
    isCurrent: () => active,
    status: () => (active ? "ready" : "retired"),
    subscribe: () => () => {},
    bind: async () => {},
    close: async () => {
      active = false;
    },
    read,
  };
  const onReceipt = vi.fn();
  const source = createAiMemoryDelivery(conversation, onReceipt).capture(
    () => {},
  );
  const prepare = async (model = "ollama-local") => {
    if (!source.prepare) throw new Error("Missing API channel");
    const input = await source.prepare(model, () => {
      if (!caller) throw new Error("Caller retired");
    });
    prepared.add(input);
    return input;
  };
  return {
    read,
    source,
    prepare,
    onReceipt,
    retire: () => {
      active = false;
    },
    cancel: () => {
      caller = false;
    },
  };
}

it("records the exact packet with a local request ID only after an explicit response", async () => {
  const f = fixture();
  const input = await f.prepare();
  expect(f.onReceipt).not.toHaveBeenCalled();
  expect(input.acknowledge()).toBe(true);
  expect(input.acknowledge()).toBe(true);
  expect(f.onReceipt).toHaveBeenCalledTimes(1);
  const receipt = f.onReceipt.mock.calls[0][0];
  expect(receipt).toEqual({
    schema: 1,
    method: "model-response",
    requestId: expect.any(String),
    modelId: "ollama-local",
    packet: result().packet,
  });
  expect(receipt.requestId).toMatch(/^[0-9a-f-]{36}$/);
  expect(receipt).not.toHaveProperty("providerSessionId");
  expect(receipt).not.toHaveProperty("responseId");
  expect(Object.isFrozen(receipt)).toBe(true);
  expect(Object.isFrozen(receipt.packet)).toBe(true);
});

it.each(["cancel", "retire", "settle"] as const)(
  "rejects acknowledgments after %s",
  async (mode) => {
    const f = fixture();
    const input = await f.prepare();
    if (mode === "settle") input.settle();
    else f[mode]();
    expect(input.acknowledge()).toBe(false);
    expect(f.onReceipt).not.toHaveBeenCalled();
  },
);

it("never replaces a newer receipt with an older response and rereads every turn", async () => {
  const f = fixture();
  const old = await f.prepare();
  const next = await f.prepare();
  expect(next.acknowledge()).toBe(true);
  expect(old.acknowledge()).toBe(false);
  expect(f.onReceipt).toHaveBeenCalledTimes(1);
  expect(f.read).toHaveBeenCalledTimes(2);
});

it.each([
  "",
  "bad\0model",
  "harness@codex",
  "harness-claude",
  "harness-codex",
  "harness-agy",
  "x".repeat(4097),
])(
  "rejects unsupported model IDs before native reads: %.20s",
  async (model) => {
    const f = fixture();
    await expect(f.prepare(model)).rejects.toThrow(
      "KIT_MEMORY_MODEL_UNSUPPORTED",
    );
    expect(f.read).not.toHaveBeenCalled();
  },
);

it("does not acknowledge native policy denial", async () => {
  const f = fixture();
  f.read.mockResolvedValue({
    schema: 1,
    packet: null,
    decision: {
      schema: 1,
      policy: "never",
      contextAllowed: false,
      captureAllowed: false,
      reason: "KIT_MEMORY_POLICY_NEVER",
    },
  });
  await expect(f.prepare()).rejects.toThrow("KIT_MEMORY_POLICY_NEVER");
  expect(f.onReceipt).not.toHaveBeenCalled();
});

it("retains the shared reservation after acknowledgment until exact settlement", async () => {
  const f = fixture();
  const inputs = [];
  for (let index = 0; index < 256; index++) inputs.push(await f.prepare());
  expect(inputs[0].acknowledge()).toBe(true);
  await expect(f.prepare()).rejects.toThrow("busy");
  inputs[0].settle();
  inputs[0].settle();
  await f.prepare();
  await expect(f.prepare()).rejects.toThrow("busy");
});

it("retains cancelled native reads in the budget until their promises settle", async () => {
  const f = fixture();
  let finish!: (value: MemoryContextResult) => void;
  const held = new Promise<MemoryContextResult>((resolve) => {
    finish = resolve;
  });
  f.read.mockReturnValue(held);
  const pending = Array.from({ length: 256 }, () =>
    f.prepare().catch((error: unknown) => error),
  );
  f.retire();
  const next = fixture();
  try {
    await expect(next.prepare()).rejects.toThrow("busy");
  } finally {
    finish(result());
    const outcomes = await Promise.all(pending);
    for (const outcome of outcomes)
      expect(outcome).toMatchObject({ code: "cancelled" });
  }
  await next.prepare();
});

it("isolates a failing presentation callback after observing a response", async () => {
  const f = fixture();
  f.onReceipt.mockImplementation(() => {
    throw new Error("Presentation failed");
  });
  const input = await f.prepare();
  expect(input.acknowledge()).toBe(true);
  expect(input.acknowledge()).toBe(true);
  expect(f.onReceipt).toHaveBeenCalledTimes(1);
});

it("requires the exact first text part in the last user message", () => {
  const packet = { type: "text" as const, text };
  expect(
    hasAiMemoryInput(
      [{ role: "user", content: [packet, { type: "text", text: "task" }] }],
      text,
    ),
  ).toBe(true);
  expect(hasAiMemoryInput([{ role: "user", content: text }], text)).toBe(true);
  expect(hasAiMemoryInput([{ role: "system", content: text }], text)).toBe(
    false,
  );
  expect(
    hasAiMemoryInput(
      [
        { role: "user", content: [packet] },
        { role: "user", content: "new task" },
      ],
      text,
    ),
  ).toBe(false);
  expect(
    hasAiMemoryInput(
      [{ role: "user", content: [{ type: "text", text: "task" }, packet] }],
      text,
    ),
  ).toBe(false);
  expect(hasAiMemoryInput([{ role: "user", content: "" }], "")).toBe(false);
});
