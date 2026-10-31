import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createHarnessMemoryDelivery } from "@/modules/harness/lib/harnessMemoryDelivery";
import type { MemoryConversation } from "@/modules/workspace-kit/lib/memoryConversation";
import type { MemoryContextResult } from "@/modules/workspace-kit/lib/context";
import type { SendTurnInput } from "@/modules/harness/lib/harness/types";
import { HarnessSteerRejectedError } from "@/modules/harness/lib/harness/types";

type Child = {
  retired: boolean;
  args: string[];
  line: (line: string) => void;
  exit: (code: number) => void;
  writes: Record<string, unknown>[];
};
const bridge = vi.hoisted(() => ({
  children: [] as Child[],
  version: vi.fn(async () => "2.1.312 (Claude Code)"),
  write: null as
    | null
    | ((child: Child, message: Record<string, unknown>) => Promise<void>),
}));
vi.mock("@/modules/harness/lib/harness/child", () => ({
  resolveClaudeBinary: async () => ({ path: "/synthetic/claude" }),
  execChild: bridge.version,
  closeRetiredRawChildren: async () => {},
  reserveRawChild(logicalSessionId: string) {
    const child: Child = {
      retired: false,
      args: [],
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
      async spawn(_path: string, args: string[]) {
        child.args = args;
      },
      async write(payload: string) {
        if (child.retired) throw new Error("retired");
        const message = JSON.parse(payload);
        child.writes.push(message);
        if (
          message.type === "control_request" &&
          message.request.subtype === "initialize"
        )
          child.line(
            JSON.stringify({
              type: "system",
              subtype: "init",
              session_id: "provider",
            }),
          );
        await bridge.write?.(child, message);
      },
      async close() {
        child.retired = true;
      },
    };
  },
}));
import {
  __claudeTestReset,
  cancelClaudeTurn,
  compactClaudeContext,
  sendClaudeTurn,
  steerClaudeTurn,
  stopClaudeSession,
} from "@/modules/harness/lib/harness/claude";

const base: SendTurnInput = {
  sessionId: "memory-claude",
  cwd: "/project",
  model: "claude:sonnet",
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
function fixture(onReceipt?: () => void) {
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
  const delivery = createHarnessMemoryDelivery(conversation, onReceipt);
  return { read, conversation, delivery, source: delivery.capture(() => {}) };
}
function observed<T>(promise: Promise<T>) {
  void promise.catch(() => {});
  return promise;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
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
function emit(child: Child, message: Record<string, unknown>) {
  child.line(JSON.stringify(message));
}
function users(child: Child) {
  return child.writes.filter((message) => message.type === "user");
}
function content(message: Record<string, unknown>) {
  return (message.message as { content: unknown[] }).content;
}
function echo(
  child: Child,
  message = users(child).slice(-1)[0],
  patch: Record<string, unknown> = {},
) {
  const replayed = { ...message };
  delete replayed.client_composed;
  emit(child, {
    ...replayed,
    isReplay: true,
    parent_tool_use_id: null,
    ...patch,
  });
}
function result(child: Child) {
  emit(child, {
    type: "result",
    subtype: "success",
    session_id: "provider",
    result: "done",
  });
}
async function written(index = 0, count = 1) {
  await flush();
  const child = bridge.children[index];
  expect(users(child)).toHaveLength(count);
  return child;
}
beforeEach(() => {
  bridge.children = [];
  bridge.write = null;
  bridge.version.mockReset().mockResolvedValue("2.1.312 (Claude Code)");
});
afterEach(async () => {
  bridge.write = null;
  await stopClaudeSession(base.sessionId);
  __claudeTestReset();
  vi.useRealTimers();
});

it("preserves ordinary arguments and input without probing the CLI", async () => {
  const turn = observed(sendClaudeTurn(base));
  const child = await written();
  expect(bridge.version).not.toHaveBeenCalled();
  expect(child.args).not.toContain("--replay-user-messages");
  expect(users(child)[0]).toEqual({
    type: "user",
    session_id: "",
    parent_tool_use_id: null,
    message: { role: "user", content: [{ type: "text", text: base.text }] },
  });
  result(child);
  await turn;
});
it("requires the exact echo and resolved write before recording memory acceptance", async () => {
  const f = fixture();
  const write = deferred<void>();
  bridge.write = async (_child, message) => {
    if (message.type === "user") await write.promise;
  };
  const turn = observed(sendClaudeTurn({ ...base, projectMemory: f.source }));
  const child = await written();
  expect(child.args).toContain("--replay-user-messages");
  expect(bridge.version).toHaveBeenCalledWith("/synthetic/claude", [
    "--version",
  ]);
  expect(content(users(child)[0])).toEqual([
    { type: "text", text: packet().packet?.text },
    { type: "text", text: base.text },
  ]);
  echo(child);
  expect(f.delivery.receipt()).toBeNull();
  write.resolve();
  await flush();
  expect(f.delivery.receipt()).toMatchObject({
    adapter: "claude",
    providerSessionId: "provider",
    packet: packet().packet,
  });
  result(child);
  await turn;
});
it("does not acknowledge an echo when the physical write subsequently fails", async () => {
  const f = fixture();
  const write = deferred<void>();
  bridge.write = async (_child, message) => {
    if (message.type === "user") await write.promise;
  };
  const turn = observed(sendClaudeTurn({ ...base, projectMemory: f.source }));
  const child = await written();
  echo(child);
  write.reject(new Error("writer failed"));
  await expect(turn).rejects.toThrow("writer failed");
  expect(f.delivery.receipt()).toBeNull();
});
it.each(["result", "ordinary user", "foreign echo", "synthetic echo"])(
  "does not infer acceptance from %s",
  async (kind) => {
    const f = fixture();
    const turn = observed(sendClaudeTurn({ ...base, projectMemory: f.source }));
    const child = await written();
    if (kind === "ordinary user") echo(child, undefined, { isReplay: false });
    if (kind === "foreign echo")
      echo(child, undefined, { session_id: "foreign" });
    if (kind === "synthetic echo")
      echo(child, undefined, { isSynthetic: true });
    result(child);
    await turn;
    expect(f.delivery.receipt()).toBeNull();
    echo(child);
    expect(f.delivery.receipt()).toBeNull();
    const next = observed(sendClaudeTurn({ ...base, projectMemory: f.source }));
    await written(0, 2);
    expect(users(child)[1].session_id).toBe("provider");
    expect(content(users(child)[1])).toHaveLength(2);
    result(child);
    await next;
  },
);
it("reuses acknowledged context while still rechecking policy and echoing each input", async () => {
  const f = fixture();
  let turn = observed(sendClaudeTurn({ ...base, projectMemory: f.source }));
  const child = await written();
  echo(child);
  result(child);
  await turn;
  const first = users(child)[0];
  turn = observed(sendClaudeTurn({ ...base, projectMemory: f.source }));
  await written(0, 2);
  expect(content(users(child)[1])).toEqual([{ type: "text", text: base.text }]);
  expect(users(child)[1].uuid).not.toBe(first.uuid);
  expect(f.read).toHaveBeenCalledTimes(2);
  echo(child);
  result(child);
  await turn;
  f.read.mockResolvedValue(packet("updated facts"));
  turn = observed(sendClaudeTurn({ ...base, projectMemory: f.source }));
  await written(0, 3);
  expect(content(users(child)[2])[0]).toEqual({
    type: "text",
    text: "updated facts",
  });
  result(child);
  await turn;
});
it.each(["compact", "provider change", "cancel", "restart"])(
  "reintroduces memory after %s",
  async (boundary) => {
    const f = fixture();
    let turn = observed(sendClaudeTurn({ ...base, projectMemory: f.source }));
    let child = await written();
    echo(child);
    result(child);
    await turn;
    if (boundary === "compact")
      emit(child, {
        type: "system",
        subtype: "compact_boundary",
        session_id: "provider",
      });
    if (boundary === "provider change")
      emit(child, {
        type: "system",
        subtype: "init",
        session_id: "new-provider",
      });
    if (boundary === "cancel") await cancelClaudeTurn(base.sessionId);
    if (boundary === "restart") await stopClaudeSession(base.sessionId);
    turn = observed(sendClaudeTurn({ ...base, projectMemory: f.source }));
    child = await written(
      boundary === "restart" ? 1 : 0,
      boundary === "restart" ? 1 : 2,
    );
    expect(content(users(child).slice(-1)[0])).toHaveLength(2);
    result(child);
    await turn;
  },
);
it("restarts and resumes an ordinary warm actor when memory is first requested", async () => {
  let turn = observed(sendClaudeTurn(base));
  const old = await written();
  result(old);
  await turn;
  const f = fixture();
  turn = observed(sendClaudeTurn({ ...base, projectMemory: f.source }));
  const child = await written(1);
  expect(old.retired).toBe(true);
  expect(child.args).toContain("--replay-user-messages");
  expect(child.args).toContain("--resume");
  expect(child.args).toContain("provider");
  echo(old);
  expect(f.delivery.receipt()).toBeNull();
  echo(child);
  result(child);
  await turn;
});
it.each(["2.1.311", "2.1.312-beta", "unknown"])(
  "rejects memory on unsupported version %s before spawning",
  async (version) => {
    bridge.version.mockResolvedValue(version);
    const f = fixture();
    await expect(
      sendClaudeTurn({ ...base, projectMemory: f.source }),
    ).rejects.toThrow("2.1.312");
    expect(bridge.children[0].args).toEqual([]);
    expect(f.read).not.toHaveBeenCalled();
  },
);
it("sanitizes a failed version probe", async () => {
  bridge.version.mockRejectedValue(new Error("private probe output"));
  await expect(
    sendClaudeTurn({ ...base, projectMemory: fixture().source }),
  ).rejects.toThrow("Unable to verify the Claude CLI version");
  expect(bridge.children[0].args).toEqual([]);
});
it("rejects remote memory before probing or spawning a local CLI", async () => {
  const cwd = "remote://synthetic/project";
  const f = fixture();
  const source = { ...f.source, cwd };
  await expect(
    sendClaudeTurn({ ...base, cwd, projectMemory: source }),
  ).rejects.toThrow("requires a local CLI");
  expect(bridge.version).not.toHaveBeenCalled();
  expect(bridge.children[0].args).toEqual([]);
  expect(f.read).not.toHaveBeenCalled();
});
it("does not spawn after stop retires an in-flight version probe", async () => {
  const version = deferred<string>();
  bridge.version.mockReturnValue(version.promise);
  const turn = observed(
    sendClaudeTurn({ ...base, projectMemory: fixture().source }),
  );
  await flush();
  await stopClaudeSession(base.sessionId);
  version.resolve("2.1.312");
  await expect(turn).rejects.toThrow();
  expect(bridge.children[0].args).toEqual([]);
});
it("rejects memory slash commands before opening or reading", async () => {
  const f = fixture();
  await expect(
    sendClaudeTurn({ ...base, text: " /compact", projectMemory: f.source }),
  ).rejects.toThrow("slash command");
  expect(bridge.children).toHaveLength(0);
  expect(f.read).not.toHaveBeenCalled();
});
it("rejects memory steering on an ordinary actor with an explicit queue instruction", async () => {
  const turn = observed(sendClaudeTurn(base));
  const child = await written();
  const f = fixture();
  await expect(
    steerClaudeTurn({ ...base, projectMemory: f.source }),
  ).rejects.toThrow("Queue the follow-up");
  expect(users(child)).toHaveLength(1);
  expect(f.read).not.toHaveBeenCalled();
  result(child);
  await turn;
});
it("can acknowledge a replay-enabled steering input after its write has returned", async () => {
  const f = fixture();
  const turn = observed(sendClaudeTurn({ ...base, projectMemory: f.source }));
  const child = await written();
  echo(child);
  await steerClaudeTurn({
    ...base,
    text: "follow up",
    projectMemory: f.source,
  });
  expect(content(users(child)[1])).toEqual([
    { type: "text", text: "follow up" },
  ]);
  echo(child);
  expect(f.delivery.receipt()?.adapter).toBe("claude");
  result(child);
  await turn;
});
it("does not acknowledge a steering candidate retired by a later control writer failure", async () => {
  const f = fixture();
  const turn = observed(sendClaudeTurn({ ...base, projectMemory: f.source }));
  const child = await written();
  await steerClaudeTurn({ ...base, projectMemory: f.source });
  bridge.write = async () => {
    throw new Error("control writer failed");
  };
  await cancelClaudeTurn(base.sessionId);
  echo(child);
  expect(f.delivery.receipt()).toBeNull();
  await turn;
  await expect(
    sendClaudeTurn({ ...base, projectMemory: f.source }),
  ).rejects.toThrow("control writer failed");
});
it("does not let a forged replay replace the provider binding or acknowledge another input", async () => {
  const f = fixture();
  const turn = observed(sendClaudeTurn({ ...base, projectMemory: f.source }));
  const child = await written();
  echo(child, undefined, { uuid: "unknown", session_id: "foreign" });
  await steerClaudeTurn({ ...base, projectMemory: f.source });
  expect(users(child)[1].session_id).toBe("provider");
  expect(f.delivery.receipt()).toBeNull();
  echo(child);
  expect(f.delivery.receipt()?.providerSessionId).toBe("provider");
  result(child);
  await turn;
});
it("keeps later source-less inputs unchanged on a replay-enabled actor", async () => {
  const f = fixture();
  let turn = observed(sendClaudeTurn({ ...base, projectMemory: f.source }));
  const child = await written();
  echo(child);
  result(child);
  await turn;
  turn = observed(sendClaudeTurn(base));
  await written(0, 2);
  expect(users(child)[1]).toEqual({
    type: "user",
    session_id: "",
    parent_tool_use_id: null,
    message: { role: "user", content: [{ type: "text", text: base.text }] },
  });
  expect(f.read).toHaveBeenCalledTimes(1);
  result(child);
  await turn;
});
it.each(["cancel", "stop", "exit", "compact", "source retired"])(
  "ignores pending echoes after %s",
  async (boundary) => {
    const f = fixture();
    const turn = observed(sendClaudeTurn({ ...base, projectMemory: f.source }));
    const child = await written();
    if (boundary === "cancel") await cancelClaudeTurn(base.sessionId);
    if (boundary === "stop") await stopClaudeSession(base.sessionId);
    if (boundary === "exit") child.exit(1);
    if (boundary === "compact")
      emit(child, {
        type: "system",
        subtype: "compact_boundary",
        session_id: "provider",
      });
    if (boundary === "source retired") await f.conversation.close();
    echo(child);
    expect(f.delivery.receipt()).toBeNull();
    result(child);
    if (boundary === "exit") await expect(turn).rejects.toThrow();
    else await turn;
  },
);
it("retires an asynchronous packet read without emitting the user input", async () => {
  const f = fixture();
  const read = deferred<MemoryContextResult>();
  f.read.mockReturnValue(read.promise);
  const turn = observed(sendClaudeTurn({ ...base, projectMemory: f.source }));
  await flush();
  await stopClaudeSession(base.sessionId);
  read.resolve(packet());
  await turn;
  expect(users(bridge.children[0])).toHaveLength(0);
});
it("invalidates a packet read if compaction crosses its captured context", async () => {
  const f = fixture();
  const read = deferred<MemoryContextResult>();
  f.read.mockReturnValue(read.promise);
  const turn = observed(sendClaudeTurn({ ...base, projectMemory: f.source }));
  await flush();
  const child = bridge.children[0];
  emit(child, {
    type: "system",
    subtype: "compact_boundary",
    session_id: "provider",
  });
  read.resolve(packet());
  await expect(turn).rejects.toThrow("memory context changed");
  expect(users(child)).toHaveLength(0);
});
it("cannot revive a pending physical input after cancellation", async () => {
  const f = fixture();
  const write = deferred<void>();
  bridge.write = async (_child, message) => {
    if (message.type === "user") await write.promise;
  };
  const turn = observed(sendClaudeTurn({ ...base, projectMemory: f.source }));
  const child = await written();
  echo(child);
  await cancelClaudeTurn(base.sessionId);
  write.resolve();
  await turn;
  echo(child);
  expect(f.delivery.receipt()).toBeNull();
  bridge.write = null;
  const next = observed(sendClaudeTurn({ ...base, projectMemory: f.source }));
  await written(0, 2);
  expect(content(users(child)[1])).toHaveLength(2);
  result(child);
  await next;
});
it("detaches acceptance before a reentrant receipt observer retires the actor", async () => {
  let closing: Promise<void> | undefined;
  const f = fixture(() => {
    closing = stopClaudeSession(base.sessionId);
  });
  const turn = observed(sendClaudeTurn({ ...base, projectMemory: f.source }));
  const child = await written();
  echo(child);
  await closing;
  await turn;
  expect(child.retired).toBe(true);
  expect(f.delivery.receipt()?.adapter).toBe("claude");
  echo(child);
});
it("expires an unacknowledged steering entry and rejects its late echo", async () => {
  vi.useFakeTimers();
  const f = fixture();
  const turn = observed(sendClaudeTurn({ ...base, projectMemory: f.source }));
  const child = await written();
  await steerClaudeTurn({ ...base, projectMemory: f.source });
  const stale = users(child)[1];
  await vi.advanceTimersByTimeAsync(30_000);
  echo(child, stale);
  expect(f.delivery.receipt()).toBeNull();
  await steerClaudeTurn({ ...base, projectMemory: f.source });
  expect(content(users(child)[2])).toHaveLength(2);
  echo(child);
  expect(f.delivery.receipt()?.adapter).toBe("claude");
  result(child);
  await turn;
});
it("bounds logical pending acknowledgements and releases them on timeout", async () => {
  vi.useFakeTimers();
  const f = fixture();
  const turn = observed(sendClaudeTurn({ ...base, projectMemory: f.source }));
  const child = await written();
  for (let i = 1; i < 256; i += 1)
    await steerClaudeTurn({ ...base, projectMemory: f.source });
  await expect(
    steerClaudeTurn({ ...base, projectMemory: f.source }),
  ).rejects.toThrow("capacity");
  expect(users(child)).toHaveLength(256);
  await vi.advanceTimersByTimeAsync(30_000);
  await steerClaudeTurn({ ...base, projectMemory: f.source });
  expect(users(child)).toHaveLength(257);
  echo(child);
  result(child);
  await turn;
});
it("keeps the dedicated compact command free of memory and invalidates reuse", async () => {
  const f = fixture();
  let turn = observed(sendClaudeTurn({ ...base, projectMemory: f.source }));
  const child = await written();
  echo(child);
  result(child);
  await turn;
  const compact = observed(compactClaudeContext(base));
  await written(0, 2);
  expect(content(users(child)[1])).toEqual([
    { type: "text", text: "/compact" },
  ]);
  emit(child, {
    type: "system",
    subtype: "compact_boundary",
    session_id: "provider",
  });
  result(child);
  await compact;
  turn = observed(sendClaudeTurn({ ...base, projectMemory: f.source }));
  await written(0, 3);
  expect(content(users(child)[2])).toHaveLength(2);
  result(child);
  await turn;
});

it("does not deliver a delayed memory follow-up into a replacement turn on the same actor", async () => {
  const f = fixture();
  const first = observed(sendClaudeTurn({ ...base, projectMemory: f.source }));
  const child = await written();
  echo(child);
  const read = deferred<MemoryContextResult>();
  f.read.mockReturnValueOnce(read.promise);
  const steer = observed(
    steerClaudeTurn({
      ...base,
      text: "late follow-up",
      projectMemory: f.source,
    }),
  );
  await flush();
  result(child);
  await first;
  const next = observed(sendClaudeTurn({ ...base, text: "next turn" }));
  await written(0, 2);
  read.resolve(packet());
  await expect(steer).rejects.toBeInstanceOf(HarnessSteerRejectedError);
  expect(users(child)).toHaveLength(2);
  expect(content(users(child)[1])).toEqual([
    { type: "text", text: "next turn" },
  ]);
  result(child);
  await next;
});
