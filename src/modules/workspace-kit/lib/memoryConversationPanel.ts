import type { WorkspaceEnv } from "@/modules/workspace/env";
import type {
  MemoryContextPacket,
  MemoryContextResult,
} from "@/modules/workspace-kit/lib/context";
import type { MemoryConversation } from "@/modules/workspace-kit/lib/memoryConversation";
import {
  createNativeMemoryPresentation,
  type NativeMemorySelection,
} from "@/modules/workspace-kit/lib/nativeMemory";
import type { NativeMemoryTrustReview } from "@/modules/workspace-kit/lib/nativeMemoryTrust";

export type MemoryConversationPanelState =
  | { status: "idle" | "reviewing" | "reading" | "closed" | "error" }
  | { status: "review" | "binding"; review: NativeMemoryTrustReview }
  | {
      status: "prepared";
      result: MemoryContextResult;
      copyStatus?: "copying" | "copied" | "failed";
    };
type Entry = {
  client: ReturnType<typeof createNativeMemoryPresentation>;
  retired: boolean;
  pending: Promise<void> | null;
  closing: Promise<boolean> | null;
  acknowledged: boolean;
};
const entries = new Set<Entry>();
function collect(entry: Entry) {
  if (entry.retired && entry.acknowledged && !entry.pending)
    entries.delete(entry);
}
function close(entry: Entry): Promise<boolean> {
  entry.retired = true;
  entry.closing ??= Promise.resolve()
    .then(() => entry.client.close())
    .then(
      () => {
        entry.acknowledged = true;
        collect(entry);
        return true;
      },
      () => {
        entry.closing = null;
        return false;
      },
    );
  return entry.closing;
}
export function createMemoryConversationPanel(
  conversation: MemoryConversation,
  environment: WorkspaceEnv,
  publish: (state: MemoryConversationPanelState) => void,
) {
  for (const entry of entries) if (entry.retired) void close(entry);
  if (entries.size >= 256)
    throw new RangeError("Memory conversation panels are busy");
  const capturedEnvironment = structuredClone(environment);
  const entry: Entry = {
    client: createNativeMemoryPresentation(),
    retired: false,
    pending: null,
    closing: null,
    acknowledged: false,
  };
  entries.add(entry);
  let selection: NativeMemorySelection | null = null;
  let state: MemoryConversationPanelState = { status: "idle" };
  const current = () => !entry.retired && conversation.isCurrent();
  const notify = (next: MemoryConversationPanelState) => {
    if (!current()) return;
    state = next;
    publish(next);
  };
  const run = (work: () => Promise<void>) => {
    if (entry.pending) return entry.pending;
    if (!current()) return Promise.resolve();
    entry.pending = Promise.resolve()
      .then(async () => {
        if (!current()) return;
        try {
          await work();
        } catch {
          notify({ status: "error" });
        }
      })
      .finally(() => {
        entry.pending = null;
        collect(entry);
      });
    return entry.pending;
  };
  const read = async () => {
    notify({ status: "reading" });
    if (!current()) return;
    const result = await conversation.read();
    if (result) notify({ status: "prepared", result });
    else notify({ status: "error" });
  };
  return {
    review() {
      if (
        conversation.status() !== "inactive" ||
        capturedEnvironment.kind !== "local" ||
        conversation.cwd.startsWith("remote://")
      )
        return Promise.resolve();
      return run(async () => {
        notify({ status: "reviewing" });
        if (!current()) return;
        selection = await entry.client.select(
          conversation.cwd,
          capturedEnvironment,
        );
        if (!current()) return;
        const review = await entry.client.reviewTrust(selection);
        if (current() && entry.client.isTrustReviewCurrent(selection, review))
          notify({ status: "review", review });
      });
    },
    confirm(review: NativeMemoryTrustReview) {
      if (state.status !== "review" || state.review !== review || !selection)
        return Promise.resolve();
      const selected = selection;
      return run(async () => {
        if (!entry.client.isTrustReviewCurrent(selected, review)) return;
        notify({ status: "binding", review });
        if (!current()) return;
        await conversation.bind(
          {
            presentation: entry.client,
            selection: selected,
            review,
            mode: "enabled",
          },
          current,
        );
        if (current()) await read();
      });
    },
    read() {
      if (conversation.status() !== "ready") return Promise.resolve();
      return run(read);
    },
    copy(packet: MemoryContextPacket) {
      if (
        conversation.status() !== "ready" ||
        state.status !== "prepared" ||
        state.result.packet !== packet
      )
        return Promise.resolve();
      return run(async () => {
        if (state.status !== "prepared" || state.result.packet !== packet)
          return;
        notify({ ...state, copyStatus: "copying" });
        if (!current()) return;
        const result = await conversation.read();
        if (!current()) return;
        if (!result) {
          notify({ status: "error" });
          return;
        }
        const fresh = result.packet;
        if (
          !fresh ||
          fresh.projectKey !== packet.projectKey ||
          fresh.instructionDigest !== packet.instructionDigest ||
          fresh.digest !== packet.digest ||
          fresh.text !== packet.text
        ) {
          notify({ status: "prepared", result });
          return;
        }
        try {
          const { copyText } = await import("@/modules/harness/lib/clipboard");
          if (!current()) return;
          await copyText(fresh.text, () => {
            if (!current()) throw new Error("Memory copy retired");
          });
          notify({ status: "prepared", result, copyStatus: "copied" });
        } catch {
          notify({ status: "prepared", result, copyStatus: "failed" });
        }
      });
    },
    disable() {
      return run(async () => {
        if (!current()) return;
        await conversation.close();
        if (!entry.retired) {
          state = { status: "closed" };
          publish(state);
        }
      });
    },
    dispose: () => close(entry),
  };
}
