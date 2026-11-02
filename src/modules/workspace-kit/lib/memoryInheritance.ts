import type { MemoryConversation } from "@/modules/workspace-kit/lib/memoryConversation";
import { createNativeMemoryPresentation } from "@/modules/workspace-kit/lib/nativeMemory";
import { memoryIndicatorState } from "@/modules/workspace-kit/lib/memoryIndicator";
import type { NativeMemoryPolicyReview } from "@/modules/workspace-kit/lib/nativeMemoryPolicy";

type Entry = {
  client: ReturnType<typeof createNativeMemoryPresentation>;
  pending: boolean;
  acknowledged: boolean;
  closing: Promise<void> | null;
};
const entries = new Set<Entry>();
function collect(entry: Entry) {
  if (!entry.pending && entry.acknowledged) entries.delete(entry);
}
function close(entry: Entry): Promise<void> {
  entry.closing ??= Promise.resolve()
    .then(() => entry.client.close())
    .then(() => {
      entry.acknowledged = true;
      collect(entry);
    })
    .catch((error: unknown) => {
      entry.closing = null;
      throw error;
    });
  return entry.closing;
}
function fail(code: string): never {
  throw Object.assign(new Error(`Project memory: ${code}`), { code });
}

export function createMemoryInheritance(conversation: MemoryConversation) {
  let checked = false;
  let required = false;
  let pending: Promise<void> | null = null;
  return {
    needsPreparation: () => required && !checked,
    prepare(assertCallerCurrent: () => void): Promise<void> {
      if (pending) return pending;
      let permit: (() => boolean) | undefined;
      const check = () => {
        assertCallerCurrent();
        if (!conversation.isCurrent() || !permit?.()) fail("cancelled");
        assertCallerCurrent();
        if (!conversation.isCurrent() || !permit?.()) fail("cancelled");
      };
      try {
        assertCallerCurrent();
        if (!conversation.isCurrent()) fail("cancelled");
        if (
          checked ||
          (conversation.status() !== "inactive" && !required) ||
          !conversation.delivery?.getSnapshot().supported ||
          conversation.cwd.startsWith("remote://")
        )
          return Promise.resolve();
        permit = conversation.delivery?.capturePermit();
        check();
        const activate = async () => {
          check();
          const result = await conversation.read();
          check();
          if (
            result?.decision.policy !== "always" ||
            !result.decision.contextAllowed ||
            !result.packet
          )
            fail(result?.decision.reason ?? "unavailable");
          await conversation.delivery?.enable(result.packet, () => {
            check();
            return true;
          });
          check();
          if (!conversation.delivery?.getSnapshot().enabled) fail("stale");
          checked = true;
        };
        if (conversation.status() === "ready") {
          pending = Promise.resolve()
            .then(activate)
            .catch((error: unknown) => {
              if (!permit?.()) checked = true;
              throw error;
            })
            .finally(() => {
              pending = null;
            });
          return pending;
        }
        for (const entry of entries)
          if (!entry.pending && !entry.acknowledged)
            void close(entry).catch(() => undefined);
        if (entries.size >= 256) fail("busy");
        const entry: Entry = {
          client: createNativeMemoryPresentation(),
          pending: true,
          acknowledged: false,
          closing: null,
        };
        entries.add(entry);
        pending = Promise.resolve()
          .then(async () => {
            try {
              check();
              const selection = await entry.client.select(conversation.cwd, {
                kind: "local",
              });
              check();
              const scope = memoryIndicatorState(
                await entry.client.inspect(selection),
              );
              check();
              if (scope === "absent") {
                checked = true;
                return;
              }
              if (scope !== "found") fail("scope");
              let policy: NativeMemoryPolicyReview;
              try {
                policy = await entry.client.reviewPolicy(selection, "always");
              } catch (error) {
                check();
                if (
                  error &&
                  typeof error === "object" &&
                  "code" in error &&
                  error.code === "missingState"
                ) {
                  checked = true;
                  return;
                }
                throw error;
              }
              check();
              if (policy.snapshot.preference?.policy !== "always") {
                checked = true;
                return;
              }
              required = true;
              const review = await entry.client.reviewTrust(selection);
              check();
              if (
                review.snapshot.projectKey !== policy.snapshot.projectKey ||
                review.snapshot.root !== policy.snapshot.root ||
                review.snapshot.preference?.policy !== "always"
              )
                fail("stale");
              if (
                review.snapshot.preference.instructionDigest !==
                review.snapshot.fingerprint.digest
              )
                fail("KIT_MEMORY_TRUST_REQUIRED");
              if (conversation.status() !== "inactive") fail("cancelled");
              await conversation.bind(
                {
                  presentation: entry.client,
                  selection,
                  review,
                  mode: "inherit",
                },
                () => {
                  check();
                  return true;
                },
              );
              await activate();
            } catch (error) {
              if (!permit?.()) checked = true;
              throw error;
            } finally {
              try {
                await close(entry);
              } finally {
                entry.pending = false;
                collect(entry);
              }
            }
          })
          .finally(() => {
            pending = null;
          });
        return pending;
      } catch (error) {
        return Promise.reject(error);
      }
    },
  };
}
