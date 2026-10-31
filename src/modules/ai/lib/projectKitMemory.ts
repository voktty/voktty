import type { UIMessage } from "ai";
import {
  resolveAiFileRootContext,
  type AiFileRootContext,
} from "@/modules/ai/lib/aiFileContext";
import type { MemoryContextPacket } from "@/modules/workspace-kit/lib/context";
import type { MemoryConversation } from "@/modules/workspace-kit/lib/memoryConversation";

export type AiProjectKitMemorySource = Readonly<{
  context: object;
  cwd: string;
  assertCurrent: () => void;
  subscribe: (listener: () => void) => () => void;
  read: (assertCallerCurrent: () => void) => Promise<MemoryContextPacket>;
}>;

let pendingReads = 0;
let contexts: WeakMap<object, object> | undefined;

function fail(code: string): never {
  throw Object.assign(new Error(`Project memory: ${code}`), { code });
}

export function captureAiProjectKitMemory(
  conversation: MemoryConversation,
  assertOwnerCurrent: () => void,
): AiProjectKitMemorySource {
  const { cwd, isCurrent, status, read, subscribe } = conversation;
  const check = () => {
    assertOwnerCurrent();
    if (!isCurrent() || status() !== "ready") fail("cancelled");
    assertOwnerCurrent();
  };
  check();
  contexts ??= new WeakMap();
  let context = contexts.get(conversation);
  if (!context) {
    context = {};
    contexts.set(conversation, context);
  }
  return Object.freeze({
    context,
    cwd,
    assertCurrent: check,
    subscribe,
    async read(assertCallerCurrent) {
      const current = () => {
        check();
        assertCallerCurrent();
        check();
      };
      current();
      if (pendingReads >= 256) fail("busy");
      pendingReads += 1;
      try {
        const result = await read();
        current();
        if (!result?.decision.contextAllowed || !result.packet)
          fail(result?.decision.reason ?? "unavailable");
        const packet = Object.freeze({ ...result.packet });
        if (
          packet.bytes > 24 * 1024 ||
          packet.text.length > 24 * 1024 ||
          packet.text.length === 0 ||
          packet.text.includes("\0") ||
          packet.bytes !== new TextEncoder().encode(packet.text).length
        )
          fail("KIT_CONTEXT_BUDGET");
        return packet;
      } finally {
        pendingReads -= 1;
      }
    },
  });
}

export function assertAiProjectKitMemoryTarget(
  source: AiProjectKitMemorySource | undefined,
  boundary: AiFileRootContext | null,
): void {
  if (!source) return;
  source.assertCurrent();
  if (
    boundary?.workspace.kind !== "local" ||
    source.cwd !== boundary.root ||
    !resolveAiFileRootContext(boundary.root, boundary.workspace)
  )
    fail("KIT_MEMORY_CONTEXT_UNSUPPORTED");
  source.assertCurrent();
}

export function prependAiProjectKitMemory(
  messages: UIMessage[],
  packet: MemoryContextPacket,
): UIMessage[] {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "user") continue;
    const result = messages.slice();
    result[index] = {
      ...message,
      parts: [{ type: "text", text: packet.text }, ...message.parts],
    };
    return result;
  }
  fail("KIT_MEMORY_USER_TURN_REQUIRED");
}
