import type { MemoryContextPacket } from "@/modules/workspace-kit/lib/context";
import type { MemoryConversation } from "@/modules/workspace-kit/lib/memoryConversation";

export type HarnessMemoryDeliveryReceipt = Readonly<{
  schema: 1;
  adapter: "codex";
  method: "managed-turn";
  providerSessionId: string;
  packet: MemoryContextPacket;
}>;
export type PreparedHarnessMemory = Readonly<{
  prefix: string | null;
  assertCurrent: () => void;
  acknowledge: () => boolean;
}>;
export type HarnessMemoryTurnSource = Readonly<{
  cwd: string;
  assertCurrent: () => void;
  prepare: (
    providerContext: object,
    providerSessionId: string,
    assertTransportCurrent: () => void,
  ) => Promise<PreparedHarnessMemory | null>;
}>;

let pending = 0;
function fail(code: string): never {
  throw Object.assign(new Error(`Project memory: ${code}`), { code });
}

export function assertHarnessMemoryTarget(
  source: HarnessMemoryTurnSource | undefined,
  cwd: string,
) {
  if (!source) return;
  source.assertCurrent();
  if (source.cwd !== cwd) fail("cancelled");
  source.assertCurrent();
}

export function createHarnessMemoryDelivery(conversation: MemoryConversation) {
  const cwd = conversation.cwd;
  let receipt: HarnessMemoryDeliveryReceipt | null = null;
  let acknowledgedContext: object | null = null;
  let sequence = 0;
  let acknowledgedSequence = 0;
  return {
    receipt: () => receipt,
    capture(assertCallerCurrent: () => void): HarnessMemoryTurnSource {
      const check = () => {
        assertCallerCurrent();
        if (!conversation.isCurrent()) fail("cancelled");
      };
      return Object.freeze({
        cwd,
        assertCurrent: check,
        async prepare(
          providerContext,
          providerSessionId,
          assertTransportCurrent,
        ) {
          const current = () => {
            check();
            assertTransportCurrent();
            check();
          };
          current();
          if (conversation.status() === "inactive") return null;
          if (conversation.status() !== "ready") fail("busy");
          if (!providerSessionId.trim() || providerSessionId.length > 4096)
            fail("unavailable");
          if (pending >= 256 || sequence === Number.MAX_SAFE_INTEGER)
            fail("busy");
          const admittedSequence = ++sequence;
          pending += 1;
          try {
            const result = await conversation.read();
            current();
            if (!result?.decision.contextAllowed || !result.packet)
              fail(result?.decision.reason ?? "unavailable");
            const packet = Object.freeze({ ...result.packet });
            const alreadyDelivered =
              acknowledgedContext === providerContext &&
              receipt?.providerSessionId === providerSessionId &&
              receipt.packet.projectKey === packet.projectKey &&
              receipt.packet.instructionDigest === packet.instructionDigest &&
              receipt.packet.digest === packet.digest &&
              receipt.packet.text === packet.text;
            let acknowledged: boolean | undefined;
            return Object.freeze({
              prefix: alreadyDelivered ? null : packet.text,
              assertCurrent: current,
              acknowledge() {
                try {
                  current();
                } catch {
                  return false;
                }
                if (acknowledged !== undefined) return acknowledged;
                if (admittedSequence < acknowledgedSequence) {
                  acknowledged = false;
                  return false;
                }
                acknowledged = true;
                acknowledgedSequence = admittedSequence;
                acknowledgedContext = providerContext;
                receipt = Object.freeze({
                  schema: 1,
                  adapter: "codex",
                  method: "managed-turn",
                  providerSessionId,
                  packet,
                });
                return true;
              },
            });
          } finally {
            pending -= 1;
          }
        },
      });
    },
  };
}
