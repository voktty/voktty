import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createHarnessMemoryDelivery } from "@/modules/harness/lib/harnessMemoryDelivery";
import type { MemoryConversation } from "@/modules/workspace-kit/lib/memoryConversation";
import type { MemoryContextResult } from "@/modules/workspace-kit/lib/context";
import type {
  HarnessEvent,
  SendTurnInput,
} from "@/modules/harness/lib/harness/types";

type Child = {
  retired: boolean;
  line: (line: string) => void;
  exit: (code: number) => void;
  writes: string[];
};
const bridge = vi.hoisted(() => ({
  children: [] as Child[],
  write: null as null | ((child: Child) => Promise<void>),
  spawn: null as null | ((child: Child) => void),
}));
vi.mock("@/modules/harness/lib/harness/child", () => ({
  resolveGeminiBinary: async () => ({ path: "/synthetic/agy" }),
  execChild: async () => "1.1.15",
  closeRetiredRawChildren: async () => {},
  reserveRawChild(logicalSessionId: string) {
    const child: Child = {
      retired: false,
      line: () => {},
      exit: () => {},
      writes: [],
    };
    bridge.children.push(child);
    return {
      nativeId: crypto.randomUUID(),
      logicalSessionId,
      get retired() {
        return child.retired;
      },
      watch(line: Child["line"], exit: Child["exit"]) {
        child.line = line;
        child.exit = exit;
        return () => {};
      },
      spawn: async () => bridge.spawn?.(child),
      async write(payload: string) {
        if (child.retired) throw new Error("retired");
        child.writes.push(payload);
        await bridge.write?.(child);
      },
      close: async () => {
        child.retired = true;
      },
    };
  },
}));
import {
  __agyTestReset,
  bindAgySession,
  cancelAgyTurn,
  sendAgyTurn,
  stopAgySession,
} from "@/modules/harness/lib/harness/agy";

const base: SendTurnInput = {
  sessionId: "memory-agy",
  cwd: "/project",
  model: "gemini:gemini-3.8-flash",
  runtimeMode: "supervised",
  text: "original task",
  onEvent: () => {},
};
function packet(
  text = "PROJECT MEMORY (.voktty)\nshared context",
): MemoryContextResult {
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
  const read = vi.fn(async () => packet());
  const conversation: MemoryConversation = {
    cwd: base.cwd,
    projectCwd: base.cwd,
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
  return { read, conversation, delivery, source: delivery.capture(() => {}) };
}
function observed<T>(promise: Promise<T>): Promise<T> {
  void promise.catch(() => {});
  return promise;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = observed(
    new Promise<T>((yes, no) => {
      resolve = yes;
      reject = no;
    }),
  );
  return { promise, resolve, reject };
}
async function flush() {
  for (let i = 0; i < 100; i += 1) await Promise.resolve();
}
async function written(index = 0, count = 1) {
  await flush();
  const child = bridge.children[index];
  expect(child?.writes).toHaveLength(count);
  return child;
}
function result(child: Child, patch: Record<string, unknown> = {}) {
  child.line(
    JSON.stringify({
      event: "result",
      result: {
        status: "SUCCESS",
        conversation_id: "real-provider",
        num_turns: 1,
        ...patch,
      },
    }),
  );
}
function content(child: Child, index = 0) {
  return JSON.parse(child.writes[index]).message.content;
}
beforeEach(() => {
  bridge.children = [];
  bridge.write = null;
  bridge.spawn = null;
});
afterEach(async () => {
  bridge.write = null;
  await stopAgySession(base.sessionId);
  __agyTestReset();
});

it("preserves ordinary input when memory is absent", async () => {
  const turn = observed(sendAgyTurn(base));
  const child = await written();
  expect(content(child)).toBe(base.text);
  result(child);
  await turn;
});

it("sends memory as a separate text block without storing it in the original prompt", async () => {
  const f = fixture();
  const request = { ...base, projectMemory: f.source };
  const turn = observed(sendAgyTurn(request));
  const child = await written();
  expect(content(child)).toEqual([
    { type: "text", text: packet().packet?.text },
    { type: "text", text: base.text },
  ]);
  expect(request.text).toBe(base.text);
  expect(f.delivery.receipt()).toBeNull();
  child.line(
    JSON.stringify({ event: "init", conversation_id: "real-provider" }),
  );
  child.line(
    JSON.stringify({
      event: "step_update",
      step_update: { step_type: "user_input", state: "DONE" },
    }),
  );
  expect(f.delivery.receipt()).toBeNull();
  result(child);
  await turn;
  expect(f.delivery.receipt()).toMatchObject({
    adapter: "agy",
    providerSessionId: "real-provider",
    packet: packet().packet,
  });
});

it("waits for actual write completion even if the successful result arrives first", async () => {
  const f = fixture();
  const write = deferred<void>();
  bridge.write = () => write.promise;
  const turn = observed(sendAgyTurn({ ...base, projectMemory: f.source }));
  const child = await written();
  result(child);
  expect(f.delivery.receipt()).toBeNull();
  write.resolve();
  await turn;
  expect(f.delivery.receipt()?.providerSessionId).toBe("real-provider");
});

it("never acknowledges a successful result whose actual write later fails", async () => {
  const f = fixture();
  const write = deferred<void>();
  bridge.write = () => write.promise;
  const turn = observed(sendAgyTurn({ ...base, projectMemory: f.source }));
  const child = await written();
  result(child);
  write.reject(new Error("write failed"));
  await expect(turn).rejects.toThrow("write failed");
  expect(f.delivery.receipt()).toBeNull();
});

it.each([
  { status: undefined },
  { status: "ERROR" },
  { num_turns: undefined },
  { num_turns: 0 },
  { num_turns: -1 },
  { num_turns: 0.5 },
  { num_turns: Number.MAX_SAFE_INTEGER + 1 },
  { conversation_id: undefined },
  { conversation_id: "" },
])(
  "does not mistake an incomplete or failed result for memory acceptance: %j",
  async (patch) => {
    const f = fixture();
    const turn = observed(sendAgyTurn({ ...base, projectMemory: f.source }));
    const child = await written();
    result(child, patch);
    await turn;
    expect(f.delivery.receipt()).toBeNull();
  },
);

it("does not replace a known resumed conversation identity in an acknowledgment", async () => {
  const f = fixture();
  bindAgySession(base.sessionId, "expected-provider", base.cwd);
  const turn = observed(sendAgyTurn({ ...base, projectMemory: f.source }));
  const child = await written();
  result(child);
  await turn;
  expect(f.delivery.receipt()).toBeNull();
});

it("reads and delivers a fresh packet on every turn and refuses repeated cumulative counts", async () => {
  const f = fixture();
  const first = observed(sendAgyTurn({ ...base, projectMemory: f.source }));
  const child = await written();
  result(child);
  await first;
  const accepted = f.delivery.receipt();
  f.read.mockResolvedValue(packet("new facts"));
  const second = observed(
    sendAgyTurn({ ...base, text: "next", projectMemory: f.source }),
  );
  await written(0, 2);
  expect(content(child, 1)).toEqual([
    { type: "text", text: "new facts" },
    { type: "text", text: "next" },
  ]);
  result(child);
  await second;
  expect(f.delivery.receipt()).toBe(accepted);
  const third = observed(sendAgyTurn({ ...base, projectMemory: f.source }));
  await written(0, 3);
  result(child, { num_turns: 2 });
  await third;
  expect(f.read).toHaveBeenCalledTimes(3);
  expect(f.delivery.receipt()?.packet.text).toBe("new facts");
});

it.each(["stop", "cancel", "exit", "disable"])(
  "retires a candidate before publication after %s while write is pending",
  async (kind) => {
    const f = fixture();
    const write = deferred<void>();
    bridge.write = () => write.promise;
    const turn = observed(sendAgyTurn({ ...base, projectMemory: f.source }));
    const child = await written();
    result(child);
    if (kind === "stop") await stopAgySession(base.sessionId);
    else if (kind === "cancel") await cancelAgyTurn(base.sessionId);
    else if (kind === "exit") child.exit(0);
    else await f.conversation.close();
    write.resolve();
    if (kind === "exit") await expect(turn).rejects.toThrow(/retired/);
    else await turn;
    expect(f.delivery.receipt()).toBeNull();
  },
);

it("does not acknowledge after a result callback reentrantly stops the original child", async () => {
  const f = fixture();
  const onEvent = (event: HarnessEvent) => {
    if (event.type === "session.providerBound")
      void stopAgySession(base.sessionId);
  };
  const turn = observed(
    sendAgyTurn({ ...base, onEvent, projectMemory: f.source }),
  );
  const child = await written();
  result(child);
  await turn;
  expect(f.delivery.receipt()).toBeNull();
});

it("does not let a second result repair the first terminal result before write settlement", async () => {
  const f = fixture();
  const write = deferred<void>();
  bridge.write = () => write.promise;
  const turn = observed(sendAgyTurn({ ...base, projectMemory: f.source }));
  const child = await written();
  result(child, { status: "ERROR" });
  result(child, { num_turns: 2 });
  write.resolve();
  await turn;
  expect(f.delivery.receipt()).toBeNull();
});

it("rejects stale preparation after stop without sending input to its child or replacement", async () => {
  const f = fixture();
  const read = deferred<MemoryContextResult>();
  f.read.mockReturnValue(read.promise);
  const old = observed(sendAgyTurn({ ...base, projectMemory: f.source }));
  await flush();
  expect(f.read).toHaveBeenCalledTimes(1);
  await stopAgySession(base.sessionId);
  const next = observed(sendAgyTurn(base));
  const child = await written(1);
  result(child);
  await next;
  read.resolve(packet());
  await old;
  expect(bridge.children[0].writes).toEqual([]);
  expect(child.retired).toBe(false);
  expect(f.delivery.receipt()).toBeNull();
});

it("ignores result and pending write completion from an old child after replacement", async () => {
  const f = fixture();
  const write = deferred<void>();
  bridge.write = () => write.promise;
  const old = observed(sendAgyTurn({ ...base, projectMemory: f.source }));
  const oldChild = await written();
  await stopAgySession(base.sessionId);
  bridge.write = null;
  const next = observed(sendAgyTurn({ ...base, projectMemory: f.source }));
  const child = await written(1);
  result(oldChild, { conversation_id: "old-provider", num_turns: 9 });
  write.resolve();
  await old;
  expect(f.delivery.receipt()).toBeNull();
  result(child);
  await next;
  expect(f.delivery.receipt()?.providerSessionId).toBe("real-provider");
});

it("does not read memory or spawn for a mismatched target or slash command", async () => {
  const f = fixture();
  await expect(
    sendAgyTurn({ ...base, cwd: "/other", projectMemory: f.source }),
  ).rejects.toThrow("cancelled");
  await expect(
    sendAgyTurn({ ...base, text: " /model", projectMemory: f.source }),
  ).rejects.toThrow("slash command");
  expect(f.read).not.toHaveBeenCalled();
  expect(bridge.children).toEqual([]);
});

it("does not accept a startup result as evidence for the input sent afterwards", async () => {
  const f = fixture();
  bridge.spawn = (child) => result(child);
  const turn = observed(sendAgyTurn({ ...base, projectMemory: f.source }));
  const child = await written();
  await turn;
  expect(f.delivery.receipt()).toBeNull();
  result(child);
  expect(f.delivery.receipt()).toBeNull();
});

it("requires progress beyond turns completed before memory was enabled", async () => {
  const first = observed(sendAgyTurn(base));
  const child = await written();
  result(child, { num_turns: 4 });
  await first;
  const f = fixture();
  const next = observed(sendAgyTurn({ ...base, projectMemory: f.source }));
  await written(0, 2);
  result(child, { num_turns: 4 });
  await next;
  expect(f.delivery.receipt()).toBeNull();
});

it("reintroduces memory after parking and accepts the resumed provider's new result", async () => {
  const f = fixture();
  const first = observed(sendAgyTurn({ ...base, projectMemory: f.source }));
  result(await written());
  await first;
  const original = f.delivery.receipt();
  await stopAgySession(base.sessionId);
  const resumed = observed(sendAgyTurn({ ...base, projectMemory: f.source }));
  const child = await written(1);
  expect(content(child)).toEqual([
    { type: "text", text: packet().packet?.text },
    { type: "text", text: base.text },
  ]);
  expect(f.delivery.receipt()).toBe(original);
  result(child, { num_turns: 7 });
  await resumed;
  expect(f.delivery.receipt()).not.toBe(original);
  expect(f.delivery.receipt()?.providerSessionId).toBe("real-provider");
  expect(f.read).toHaveBeenCalledTimes(2);
});

it("blocks input after native policy revocation instead of silently sending without requested memory", async () => {
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
    sendAgyTurn({ ...base, projectMemory: f.source }),
  ).rejects.toThrow("KIT_MEMORY_POLICY_NEVER");
  expect(bridge.children[0].writes).toEqual([]);
  expect(f.delivery.receipt()).toBeNull();
});

it("rechecks the exact queued memory source before preparing or writing", async () => {
  const first = observed(sendAgyTurn(base));
  const child = await written();
  const f = fixture();
  const queued = observed(sendAgyTurn({ ...base, projectMemory: f.source }));
  await flush();
  await f.conversation.close();
  result(child);
  await first;
  await expect(queued).rejects.toThrow("cancelled");
  expect(f.read).not.toHaveBeenCalled();
  expect(child.writes).toHaveLength(1);
});
