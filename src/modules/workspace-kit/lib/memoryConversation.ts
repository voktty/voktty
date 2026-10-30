import type { MemoryContextResult } from "@/modules/workspace-kit/lib/context";
import type {
  createNativeMemoryPresentation,
  NativeMemorySelection,
} from "@/modules/workspace-kit/lib/nativeMemory";
import type { NativeMemoryTrustReview } from "@/modules/workspace-kit/lib/nativeMemoryTrust";

export type MemoryConversationBinding = Readonly<{
  presentation: Pick<
    ReturnType<typeof createNativeMemoryPresentation>,
    "bindContext" | "isLocalSelection"
  >;
  selection: NativeMemorySelection;
  review: NativeMemoryTrustReview;
  mode: "inherit" | "enabled" | "disabled";
}>;
export type MemoryConversation = Readonly<{
  projectCwd: string;
  cwd: string;
  isCurrent: () => boolean;
  status: () => "inactive" | "binding" | "ready" | "retired";
  subscribe: (listener: () => void) => () => void;
  bind: (
    input: MemoryConversationBinding,
    isActionCurrent?: () => boolean,
  ) => Promise<void>;
  read: () => Promise<MemoryContextResult | null>;
  close: () => Promise<void>;
}>;
