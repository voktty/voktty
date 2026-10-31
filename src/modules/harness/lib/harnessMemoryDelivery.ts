import type {
  MemoryConversation,
  MemoryDeliveryReceipt,
} from "@/modules/workspace-kit/lib/memoryConversation";

export type HarnessMemoryDeliveryReceipt = MemoryDeliveryReceipt;
export type PreparedHarnessMemory = Readonly<{
  prefix: string | null;
  assertCurrent: () => void;
  acknowledge: (providerSessionId?: string) => boolean;
  settle: () => void;
}>;
export type HarnessMemoryTurnSource = Readonly<{
  cwd: string;
  assertCurrent: () => void;
  prepare: (
    providerContext: object,
    target:
      | string
      | Readonly<{ adapter: "agy"; providerSessionId?: string }>
      | Readonly<{ adapter: "claude"; providerSessionId: string }>,
    assertTransportCurrent: () => void,
  ) => Promise<PreparedHarnessMemory | null>;
}>;

let pending = 0;
function fail(code: string): never {
  throw Object.assign(new Error(`Project memory: ${code}`), { code });
}

function validProviderSessionId(id: unknown): id is string {
  return (
    typeof id === "string" &&
    id.length <= 4096 &&
    id.trim().length > 0 &&
    !/\p{Cc}/u.test(id)
  );
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

export function createHarnessMemoryDelivery(
  conversation: MemoryConversation,
  onReceipt?: (receipt: HarnessMemoryDeliveryReceipt) => void,
) {
  const cwd = conversation.cwd;
  let receipt: HarnessMemoryDeliveryReceipt | null = null;
  let acknowledgedContext: object | null = null;
  let sequence = 0;
  let acknowledgedSequence = 0;
  let inFlight = 0;
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
        async prepare(providerContext, target, assertTransportCurrent) {
          const current = () => {
            check();
            assertTransportCurrent();
            check();
          };
          current();
          const adapter = typeof target === "string" ? "codex" : target.adapter;
          const providerSessionId =
            typeof target === "string" ? target : target.providerSessionId;
          if (conversation.status() === "inactive") return null;
          if (conversation.status() !== "ready") fail("busy");
          if (
            (adapter !== "codex" &&
              adapter !== "agy" &&
              adapter !== "claude") ||
            (providerSessionId === undefined
              ? adapter !== "agy"
              : !validProviderSessionId(providerSessionId))
          )
            fail("unavailable");
          if (pending >= 256 || sequence === Number.MAX_SAFE_INTEGER)
            fail("busy");
          const admittedSequence = ++sequence;
          pending += 1;
          inFlight += 1;
          let handedOff = false;
          let settled = false;
          let accepted = false;
          const settle = () => {
            if (settled) return;
            settled = true;
            inFlight -= 1;
            if (!accepted) acknowledgedContext = null;
          };
          try {
            const result = await conversation.read();
            current();
            if (!result?.decision.contextAllowed || !result.packet)
              fail(result?.decision.reason ?? "unavailable");
            const packet = Object.freeze({ ...result.packet });
            const alreadyDelivered =
              (adapter === "codex" || adapter === "claude") &&
              inFlight === 1 &&
              acknowledgedContext === providerContext &&
              receipt !== null &&
              receipt.adapter === adapter &&
              receipt.providerSessionId === providerSessionId &&
              receipt.packet.projectKey === packet.projectKey &&
              receipt.packet.instructionDigest === packet.instructionDigest &&
              receipt.packet.digest === packet.digest &&
              receipt.packet.text === packet.text;
            let acknowledged: boolean | undefined;
            handedOff = true;
            return Object.freeze({
              prefix: alreadyDelivered ? null : packet.text,
              assertCurrent: current,
              settle,
              acknowledge(acceptedSessionId = providerSessionId) {
                if (settled && acknowledged === undefined) return false;
                try {
                  current();
                } catch {
                  settle();
                  return false;
                }
                if (acknowledged !== undefined) return acknowledged;
                if (
                  !validProviderSessionId(acceptedSessionId) ||
                  (providerSessionId !== undefined &&
                    acceptedSessionId !== providerSessionId)
                ) {
                  acknowledged = false;
                  settle();
                  return false;
                }
                if (admittedSequence < acknowledgedSequence) {
                  acknowledged = false;
                  settle();
                  return false;
                }
                acknowledged = true;
                acknowledgedSequence = admittedSequence;
                acknowledgedContext = providerContext;
                receipt = Object.freeze({
                  schema: 1,
                  adapter,
                  method: "managed-turn",
                  providerSessionId: acceptedSessionId,
                  packet,
                });
                accepted = true;
                settle();
                try {
                  onReceipt?.(receipt);
                } catch {
                  /* A presentation failure cannot undo provider acceptance. */
                }
                return true;
              },
            });
          } finally {
            pending -= 1;
            if (!handedOff) settle();
          }
        },
      });
    },
  };
}
