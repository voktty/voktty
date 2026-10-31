import { expect, it, vi } from "vitest";
import type { UIMessage } from "ai";
import type { MemoryConversation } from "@/modules/workspace-kit/lib/memoryConversation";
import type { MemoryContextResult } from "@/modules/workspace-kit/lib/context";
import {
  assertAiProjectKitMemoryTarget,
  captureAiProjectKitMemory,
  prependAiProjectKitMemory,
} from "@/modules/ai/lib/projectKitMemory";

function result(
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
function fixture(cwd = "/project") {
  let current = true;
  const read = vi.fn(async () => result());
  const conversation: MemoryConversation = {
    cwd,
    projectCwd: cwd,
    isCurrent: () => current,
    status: () => (current ? "ready" : "retired"),
    subscribe: () => () => {},
    bind: async () => {},
    read,
    close: async () => {
      current = false;
    },
  };
  const source = captureAiProjectKitMemory(conversation, () => {});
  return { read, conversation, source };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
it("reads fresh native decisions and freezes a copy of each accepted packet", async () => {
  const f = fixture();
  const original = result();
  f.read.mockResolvedValueOnce(original);
  const packet = await f.source.read(() => {});
  expect(packet).toEqual(original.packet);
  expect(packet).not.toBe(original.packet);
  expect(Object.isFrozen(f.source)).toBe(true);
  expect(Object.isFrozen(packet)).toBe(true);
  f.read.mockResolvedValueOnce(result("updated facts"));
  expect((await f.source.read(() => {})).text).toBe("updated facts");
  expect(f.read).toHaveBeenCalledTimes(2);
});
it.each(["KIT_MEMORY_POLICY_NEVER", "KIT_MEMORY_INSTRUCTIONS_CHANGED"])(
  "rejects native denial %s without a silent fallback",
  async (reason) => {
    const f = fixture();
    f.read.mockResolvedValue({
      ...result(),
      decision: { ...result().decision, contextAllowed: false, reason },
      packet: null,
    } as MemoryContextResult);
    await expect(f.source.read(() => {})).rejects.toMatchObject({
      code: reason,
    });
  },
);
it("does not read when its original owner or caller is retired", async () => {
  const f = fixture();
  await expect(
    f.source.read(() => {
      throw new Error("caller retired");
    }),
  ).rejects.toThrow("caller retired");
  await f.conversation.close();
  await expect(f.source.read(() => {})).rejects.toThrow("cancelled");
  expect(f.read).not.toHaveBeenCalled();
});
it.each(["owner", "caller"])(
  "suppresses a read retired by its %s while pending",
  async (kind) => {
    const f = fixture();
    const held = deferred<MemoryContextResult>();
    f.read.mockReturnValue(held.promise);
    let callerCurrent = true;
    const pending = f.source.read(() => {
      if (!callerCurrent) throw new Error("caller retired");
    });
    const outcome = expect(pending).rejects.toThrow();
    if (kind === "owner") await f.conversation.close();
    else callerCurrent = false;
    held.resolve(result());
    await outcome;
  },
);
it("checks the owner again after a reentrant caller guard", async () => {
  const f = fixture();
  await expect(
    f.source.read(() => {
      void f.conversation.close();
    }),
  ).rejects.toThrow("cancelled");
  expect(f.read).not.toHaveBeenCalled();
});
it("rejects a captured owner that has retired before admission", () => {
  const f = fixture();
  expect(() =>
    captureAiProjectKitMemory(f.conversation, () => {
      throw new Error("owner retired");
    }),
  ).toThrow("owner retired");
  expect(f.read).not.toHaveBeenCalled();
});
it.each(["oversize", "byte mismatch", "null byte", "empty"])(
  "rejects a %s packet before model input",
  async (kind) => {
    const f = fixture();
    const value = result(
      kind === "oversize"
        ? "á".repeat(12289)
        : kind === "null byte"
          ? "memory\0"
          : kind === "empty"
            ? ""
            : "memory",
    );
    if (!value.packet) throw new Error("Missing fixture packet");
    if (kind === "byte mismatch")
      f.read.mockResolvedValue({
        ...value,
        packet: { ...value.packet, bytes: 1 },
      });
    else f.read.mockResolvedValue(value);
    await expect(f.source.read(() => {})).rejects.toMatchObject({
      code: "KIT_CONTEXT_BUDGET",
    });
  },
);
it("accepts the exact UTF-8 ceiling without clipping characters", async () => {
  const f = fixture();
  const text = "á".repeat(12288);
  f.read.mockResolvedValue(result(text));
  expect(await f.source.read(() => {})).toMatchObject({ text, bytes: 24576 });
});
it("keeps retired reads charged until their actual settlement", async () => {
  const f = fixture();
  const sibling = fixture();
  const held = deferred<MemoryContextResult>();
  f.read.mockReturnValue(held.promise);
  const reads = Array.from({ length: 256 }, () => f.source.read(() => {}));
  const settled = Promise.allSettled(reads);
  try {
    await f.conversation.close();
    await expect(sibling.source.read(() => {})).rejects.toMatchObject({
      code: "busy",
    });
    expect(sibling.read).not.toHaveBeenCalled();
  } finally {
    held.resolve(result());
    await settled;
  }
  expect((await sibling.source.read(() => {})).text).toBe(
    result().packet?.text,
  );
});
it.each([
  null,
  { root: "/other", workspace: { kind: "local" as const } },
  { root: "/project", workspace: { kind: "wsl" as const, distro: "fixture" } },
  {
    root: "/project",
    workspace: {
      kind: "ssh" as const,
      connection: { id: "fixture", name: "fixture", host: "fixture" },
      root: "/project",
    },
  },
])(
  "rejects an unavailable or different file boundary %j before IO",
  (boundary) => {
    const f = fixture();
    expect(() => assertAiProjectKitMemoryTarget(f.source, boundary)).toThrow(
      "KIT_MEMORY_CONTEXT_UNSUPPORTED",
    );
    expect(f.read).not.toHaveBeenCalled();
  },
);
it.each(["relative", "remote://fixture/project", ""])(
  "rejects an unresolved local root %j",
  (root) => {
    const f = fixture(root);
    expect(() =>
      assertAiProjectKitMemoryTarget(f.source, {
        root,
        workspace: { kind: "local" },
      }),
    ).toThrow("KIT_MEMORY_CONTEXT_UNSUPPORTED");
  },
);
it("preserves native Windows roots by exact identity", () => {
  const f = fixture("C:\\project");
  expect(() =>
    assertAiProjectKitMemoryTarget(f.source, {
      root: "C:\\project",
      workspace: { kind: "local" },
    }),
  ).not.toThrow();
});
it("adds only a separate text block to the last user message", () => {
  const packet = result().packet;
  if (!packet) throw new Error("Missing fixture packet");
  const messages: UIMessage[] = [
    {
      id: "system",
      role: "system",
      parts: [{ type: "text", text: "user instructions" }],
    },
    {
      id: "old",
      role: "user",
      parts: [{ type: "text", text: "earlier prompt" }],
    },
    {
      id: "user",
      role: "user",
      parts: [
        {
          type: "file",
          mediaType: "image/png",
          url: "data:image/png;base64,fixture",
        },
        { type: "text", text: "original prompt" },
      ],
    },
    {
      id: "assistant",
      role: "assistant",
      parts: [{ type: "text", text: "response" }],
    },
  ];
  const injected = prependAiProjectKitMemory(messages, packet);
  expect(injected[2].parts).toEqual([
    { type: "text", text: packet.text },
    ...messages[2].parts,
  ]);
  expect(messages[2].parts).toHaveLength(2);
  expect(injected[0]).toBe(messages[0]);
  expect(injected[1]).toBe(messages[1]);
  expect(injected[3]).toBe(messages[3]);
});
it("does not invent a user turn to deliver memory", () => {
  const packet = result().packet;
  if (!packet) throw new Error("Missing fixture packet");
  expect(() => prependAiProjectKitMemory([], packet)).toThrow(
    "KIT_MEMORY_USER_TURN_REQUIRED",
  );
});
