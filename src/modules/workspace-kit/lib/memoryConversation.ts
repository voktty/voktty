import type {
  MemoryContextPacket,
  MemoryContextResult,
} from "@/modules/workspace-kit/lib/context";
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
export type MemoryDeliveryReceipt = Readonly<{
  schema: 1;
  adapter: "codex" | "agy";
  method: "managed-turn";
  providerSessionId: string;
  packet: MemoryContextPacket;
}>;
export type MemoryDeliveryState = Readonly<{
  supported: boolean;
  enabled: boolean;
  root: string | null;
  receipt: MemoryDeliveryReceipt | null;
}>;
export const inactiveMemoryDelivery: MemoryDeliveryState = Object.freeze({
  supported: false,
  enabled: false,
  root: null,
  receipt: null,
});
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
  delivery?: Readonly<{
    getSnapshot: () => MemoryDeliveryState;
    enable: (
      packet: MemoryContextPacket,
      isCallerCurrent: () => boolean,
    ) => Promise<MemoryContextResult>;
  }>;
}>;

export type MemoryConversationCapture = Readonly<{
  conversation: MemoryConversation;
  release: () => void;
}>;
