import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createHarnessMemoryDelivery } from "@/modules/harness/lib/harnessMemoryDelivery";
import type { MemoryContextResult } from "@/modules/workspace-kit/lib/context";
import type { MemoryConversation } from "@/modules/workspace-kit/lib/memoryConversation";

const bridge = vi.hoisted(() => ({
  messages: [] as {
    id?: number;
    method?: string;
    params?: Record<string, unknown>;
  }[],
  line: null as null | ((line: string) => void),
}));
vi.mock("@/modules/harness/lib/fs", () => ({
  deleteGeneratedImages: vi.fn(),
  saveGeneratedImage: vi.fn(),
}));
vi.mock("@/modules/harness/lib/harness/child", () => ({
  closeRetiredRawChildren: async () => {},
  resolveCodexBinary: async () => ({ path: "/fake/codex" }),
  reserveRawChild(logicalSessionId: string) {
    let retired = false;
    let line: ((value: string) => void) | undefined;
    return {
      nativeId: crypto.randomUUID(),
      logicalSessionId,
      get retired() {
        return retired;
      },
      spawn: async () => {},
      watch: (callback: (value: string) => void) => {
        line = callback;
        bridge.line = callback;
        return () => {};
      },
      async write(payload: string) {
        if (retired) throw new Error("retired");
        const message = JSON.parse(payload);
        bridge.messages.push(message);
        const result =
          message.method === "initialize"
            ? {}
            : message.method === "thread/start" ||
                message.method === "thread/resume"
              ? { thread: { id: "provider-thread" } }
              : message.method === "thread/revert" ||
                  message.method === "turn/interrupt" ||
                  message.method === "thread/compact/start"
                ? {}
                : undefined;
        if (result)
          queueMicrotask(() =>
            line?.(JSON.stringify({ id: message.id, result })),
          );
      },
      close: async () => {
        retired = true;
        if (bridge.line === line) bridge.line = null;
      },
    };
  },
}));
import {
  __codexTestReset,
  compactCodexContext,
  rewindCodexLastTurn,
  sendCodexTurn,
  steerCodexTurn,
  stopCodexSession,
} from "@/modules/harness/lib/harness/codex";
import type { SendTurnInput } from "@/modules/harness/lib/harness/types";
import {
  registerHarness,
  resetHarnessIdlePark,
  sendHarnessTurn,
  steerHarnessTurn,
  type HarnessAdapter,
} from "@/modules/harness/lib/harness/registry";

const base: SendTurnInput = {
  sessionId: "memory-test",
  cwd: "/project",
  model: "codex:gpt-5.4",
  runtimeMode: "supervised",
  text: "user task",
  onEvent: () => {},
};
function result(): MemoryContextResult {
  const text = "PROJECT MEMORY (.voktty)\nread the project context";
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
    status: () => (active ? "ready" : "retired"),
    isCurrent: () => active,
    subscribe: () => () => {},
    bind: async () => {},
    read,
    close: async () => {
      active = false;
    },
  };
  const delivery = createHarnessMemoryDelivery(conversation);
  return { read, delivery, conversation, source: delivery.capture(() => {}) };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
function notify(method: string, params: unknown) {
  bridge.line?.(JSON.stringify({ method, params }));
}
function acknowledge(method: string) {
  const message = [...bridge.messages]
    .reverse()
    .find((message) => message.method === method);
  if (!message) throw new Error("Missing request");
  bridge.line?.(
    JSON.stringify({
      id: message.id,
      result:
        method === "turn/steer"
          ? { turnId: "turn" }
          : { turn: { id: "turn", status: "inProgress" } },
    }),
  );
  return message;
}
async function wait(method: string, count = 1) {
  await vi.waitFor(() =>
    expect(
      bridge.messages.filter((message) => message.method === method),
    ).toHaveLength(count),
  );
  return bridge.messages.filter((message) => message.method === method)[
    count - 1
  ];
}
async function finish(pending: Promise<void>) {
  acknowledge("turn/start");
  notify("turn/completed", {
    threadId: "provider-thread",
    turn: { id: "turn", status: "completed" },
  });
  await pending;
}
beforeEach(() => {
  bridge.messages = [];
  bridge.line = null;
});
afterEach(async () => {
  await stopCodexSession(base.sessionId);
  __codexTestReset();
  resetHarnessIdlePark();
});

it("preserves the existing RPC input byte for byte when memory is absent", async () => {
  const pending = sendCodexTurn(base);
  const request = await wait("turn/start");
  expect(request.params?.input).toEqual([{ type: "text", text: "user task" }]);
  await finish(pending);
});

it("prepends a separate memory item and records the provider ACK even after turn/started", async () => {
  const f = fixture();
  const accepted = vi.fn();
  const pending = sendCodexTurn({
    ...base,
    projectMemory: f.source,
    onAccepted: accepted,
  });
  const request = await wait("turn/start");
  expect(request.params?.input).toEqual([
    { type: "text", text: result().packet?.text },
    { type: "text", text: base.text },
  ]);
  expect(f.delivery.receipt()).toBeNull();
  notify("turn/started", {
    threadId: "provider-thread",
    turn: { id: "turn", status: "inProgress" },
  });
  acknowledge("turn/start");
  await vi.waitFor(() => expect(accepted).toHaveBeenCalledOnce());
  expect(f.delivery.receipt()?.providerSessionId).toBe("provider-thread");
  notify("turn/completed", {
    threadId: "provider-thread",
    turn: { id: "turn", status: "completed" },
  });
  await pending;
  const next = sendCodexTurn({ ...base, projectMemory: f.source });
  expect((await wait("turn/start", 2)).params?.input).toEqual([
    { type: "text", text: base.text },
  ]);
  expect(f.read).toHaveBeenCalledTimes(2);
  await finish(next);
});

it.each(["resume", "manual compact", "automatic compact", "rewind"])(
  "reintroduces memory after %s",
  async (kind) => {
    const f = fixture();
    const pending = sendCodexTurn({ ...base, projectMemory: f.source });
    await wait("turn/start");
    await finish(pending);
    if (kind === "resume") await stopCodexSession(base.sessionId);
    else if (kind === "manual compact") {
      const compact = compactCodexContext(base);
      await wait("thread/compact/start");
      notify("turn/completed", {
        threadId: "provider-thread",
        turn: { id: "compact", status: "completed" },
      });
      await compact;
    } else if (kind === "automatic compact") {
      notify("item/completed", {
        threadId: "provider-thread",
        item: { type: "contextCompaction", id: "compact" },
      });
    } else await rewindCodexLastTurn({ ...base, providerTurnId: "old-turn" });
    const next = sendCodexTurn({ ...base, projectMemory: f.source });
    expect((await wait("turn/start", 2)).params?.input).toEqual([
      { type: "text", text: result().packet?.text },
      { type: "text", text: base.text },
    ]);
    await finish(next);
  },
);

it("delivers an enabled packet through steering without starting another turn", async () => {
  const pending = sendCodexTurn(base);
  await wait("turn/start");
  acknowledge("turn/start");
  notify("turn/started", {
    threadId: "provider-thread",
    turn: { id: "turn", status: "inProgress" },
  });
  const f = fixture();
  const steer = steerCodexTurn({ ...base, projectMemory: f.source });
  const request = await wait("turn/steer");
  expect(request.params?.input).toEqual([
    { type: "text", text: result().packet?.text },
    { type: "text", text: base.text },
  ]);
  acknowledge("turn/steer");
  await steer;
  expect(f.delivery.receipt()?.providerSessionId).toBe("provider-thread");
  notify("turn/completed", {
    threadId: "provider-thread",
    turn: { id: "turn", status: "completed" },
  });
  await pending;
});

it("blocks a revoked policy before the provider turn without falling back to an unprefixed prompt", async () => {
  const f = fixture();
  f.read.mockResolvedValue({
    schema: 1,
    decision: {
      schema: 1,
      policy: "never",
      contextAllowed: false,
      captureAllowed: false,
      reason: "KIT_MEMORY_POLICY_NEVER",
    },
    packet: null,
  });
  await expect(
    sendCodexTurn({ ...base, projectMemory: f.source }),
  ).rejects.toMatchObject({ code: "KIT_MEMORY_POLICY_NEVER" });
  expect(
    bridge.messages.some((message) => message.method === "turn/start"),
  ).toBe(false);
  expect(f.delivery.receipt()).toBeNull();
});

it("refuses memory from another execution directory before native startup", async () => {
  const f = fixture();
  await expect(
    sendCodexTurn({ ...base, cwd: "/other", projectMemory: f.source }),
  ).rejects.toMatchObject({ code: "cancelled" });
  expect(bridge.messages).toEqual([]);
  expect(f.read).not.toHaveBeenCalled();
});

it.each(["caller", "child"])(
  "does not issue a late turn after the original %s retires during the memory read",
  async (kind) => {
    const f = fixture();
    const read = deferred<MemoryContextResult>();
    f.read.mockReturnValue(read.promise);
    const pending = sendCodexTurn({ ...base, projectMemory: f.source }).catch(
      (error: unknown) => error,
    );
    await vi.waitFor(() => expect(f.read).toHaveBeenCalledOnce());
    if (kind === "caller") await f.conversation.close();
    else await stopCodexSession(base.sessionId);
    read.resolve(result());
    await pending;
    expect(
      bridge.messages.some((message) => message.method === "turn/start"),
    ).toBe(false);
    expect(f.delivery.receipt()).toBeNull();
  },
);

it("does not publish a delivery receipt for a caller retired before its ACK", async () => {
  const f = fixture();
  const pending = sendCodexTurn({ ...base, projectMemory: f.source });
  await wait("turn/start");
  await f.conversation.close();
  await finish(pending);
  expect(f.delivery.receipt()).toBeNull();
});

it("does not record a rejected RPC as delivery and retries with the packet intact", async () => {
  const f = fixture();
  const pending = sendCodexTurn({ ...base, projectMemory: f.source }).catch(
    (error: unknown) => error,
  );
  const request = await wait("turn/start");
  bridge.line?.(
    JSON.stringify({
      id: request.id,
      error: { code: -32602, message: "Rejected turn" },
    }),
  );
  expect(await pending).toBeInstanceOf(Error);
  expect(f.delivery.receipt()).toBeNull();
  const next = sendCodexTurn({ ...base, projectMemory: f.source });
  expect((await wait("turn/start", 2)).params?.input).toEqual([
    { type: "text", text: result().packet?.text },
    { type: "text", text: base.text },
  ]);
  await finish(next);
});

it("rejects steering if its original turn completes during a memory read", async () => {
  const pending = sendCodexTurn(base);
  await wait("turn/start");
  acknowledge("turn/start");
  notify("turn/started", {
    threadId: "provider-thread",
    turn: { id: "turn", status: "inProgress" },
  });
  const f = fixture();
  const read = deferred<MemoryContextResult>();
  f.read.mockReturnValue(read.promise);
  const steer = steerCodexTurn({ ...base, projectMemory: f.source }).catch(
    (error: unknown) => error,
  );
  await vi.waitFor(() => expect(f.read).toHaveBeenCalledOnce());
  notify("turn/completed", {
    threadId: "provider-thread",
    turn: { id: "turn", status: "completed" },
  });
  await pending;
  read.resolve(result());
  expect(await steer).toBeInstanceOf(Error);
  expect(
    bridge.messages.some((message) => message.method === "turn/steer"),
  ).toBe(false);
  expect(f.delivery.receipt()).toBeNull();
});

it("retains an actual acceptance receipt when normal completion precedes its ACK", async () => {
  const f = fixture();
  const pending = sendCodexTurn({ ...base, projectMemory: f.source });
  await wait("turn/start");
  notify("turn/completed", {
    threadId: "provider-thread",
    turn: { id: "turn", status: "completed" },
  });
  acknowledge("turn/start");
  await pending;
  expect(f.delivery.receipt()?.providerSessionId).toBe("provider-thread");
});

it("does not invalidate parent memory after a child thread compacts", async () => {
  const f = fixture();
  const pending = sendCodexTurn({ ...base, projectMemory: f.source });
  await wait("turn/start");
  await finish(pending);
  notify("item/completed", {
    threadId: "child-thread",
    item: { type: "contextCompaction", id: "compact" },
  });
  const next = sendCodexTurn({ ...base, projectMemory: f.source });
  expect((await wait("turn/start", 2)).params?.input).toEqual([
    { type: "text", text: base.text },
  ]);
  await finish(next);
});

it.each(["send", "steer"])(
  "rejects an undeclared memory capability before %s adapter dispatch",
  async (method) => {
    const f = fixture();
    const dispatch = vi.fn(async () => {});
    const adapter: HarnessAdapter = {
      id: "cursor",
      live: true,
      sendTurn: dispatch,
      steerTurn: dispatch,
      cancelTurn: async () => {},
      respondApproval: () => {},
      stopSession: async () => {},
      forgetSession: async () => {},
      bindSession: () => {},
    };
    registerHarness(adapter);
    const request = {
      ...base,
      harness: "cursor" as const,
      projectMemory: f.source,
    };
    await expect(
      method === "send" ? sendHarnessTurn(request) : steerHarnessTurn(request),
    ).rejects.toThrow("KIT_MEMORY_CONTEXT_UNSUPPORTED");
    expect(dispatch).not.toHaveBeenCalled();
    expect(f.read).not.toHaveBeenCalled();
  },
);
