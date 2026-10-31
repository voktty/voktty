import type { ModelMessage } from "ai";
import { resolveModel } from "@/modules/ai/config";
import {
  captureAiProjectKitMemory,
  type AiProjectKitMemorySource,
} from "@/modules/ai/lib/projectKitMemory";
import type {
  MemoryConversation,
  ModelMemoryDeliveryReceipt,
} from "@/modules/workspace-kit/lib/memoryConversation";

export type AiMemoryDeliveryReceipt = ModelMemoryDeliveryReceipt;

let pending = 0;

function fail(code: string): never {
  throw Object.assign(new Error(`Project memory: ${code}`), { code });
}

export function hasAiMemoryInput(
  messages: readonly ModelMessage[],
  text: string,
): boolean {
  if (!text || text.length > 24 * 1024) return false;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "user") continue;
    return typeof message.content === "string"
      ? message.content === text
      : message.content[0]?.type === "text" && message.content[0].text === text;
  }
  return false;
}

export function createAiMemoryDelivery(
  conversation: MemoryConversation,
  onReceipt: (receipt: AiMemoryDeliveryReceipt) => void,
) {
  let sequence = 0;
  let acknowledgedSequence = 0;
  return {
    capture(assertOwnerCurrent: () => void): AiProjectKitMemorySource {
      const source = captureAiProjectKitMemory(
        conversation,
        assertOwnerCurrent,
      );
      return Object.freeze({
        ...source,
        async prepare(modelId, assertCallerCurrent) {
          source.assertCurrent();
          assertCallerCurrent();
          if (
            !modelId.trim() ||
            modelId.length > 4096 ||
            /\p{Cc}/u.test(modelId) ||
            resolveModel(modelId).provider === "harness"
          )
            fail("KIT_MEMORY_MODEL_UNSUPPORTED");
          if (pending >= 256 || sequence === Number.MAX_SAFE_INTEGER)
            fail("busy");
          const admitted = ++sequence;
          const requestId = crypto.randomUUID();
          pending += 1;
          let settled = false;
          let accepted = false;
          let handedOff = false;
          const settle = () => {
            if (settled) return;
            settled = true;
            pending -= 1;
          };
          try {
            const packet = await source.read(assertCallerCurrent);
            source.assertCurrent();
            assertCallerCurrent();
            handedOff = true;
            return Object.freeze({
              packet,
              settle,
              acknowledge() {
                if (settled) return false;
                try {
                  source.assertCurrent();
                  assertCallerCurrent();
                  source.assertCurrent();
                } catch {
                  return false;
                }
                if (accepted) return true;
                if (admitted < acknowledgedSequence) return false;
                accepted = true;
                acknowledgedSequence = admitted;
                try {
                  onReceipt(
                    Object.freeze({
                      schema: 1,
                      method: "model-response",
                      requestId,
                      modelId,
                      packet,
                    }),
                  );
                } catch {
                  /* Presentation cannot undo an observed model response. */
                }
                return true;
              },
            });
          } finally {
            if (!handedOff) settle();
          }
        },
      });
    },
  };
}
