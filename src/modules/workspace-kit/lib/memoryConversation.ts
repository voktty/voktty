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
export type ManagedMemoryDeliveryReceipt = Readonly<{
  schema: 1;
  adapter: "codex" | "agy" | "claude";
  method: "managed-turn";
  providerSessionId: string;
  packet: MemoryContextPacket;
}>;
export type ModelMemoryDeliveryReceipt = Readonly<{
  schema: 1;
  method: "model-response";
  requestId: string;
  modelId: string;
  packet: MemoryContextPacket;
  providerSessionId?: never;
}>;
export type MemoryDeliveryReceipt =
  | ManagedMemoryDeliveryReceipt
  | ModelMemoryDeliveryReceipt;
export type MemoryDeliveryChannel = MemoryDeliveryReceipt["method"];
export type MemoryDeliveryState = Readonly<{
  channel?: MemoryDeliveryChannel;
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
    disable: (isCallerCurrent: () => boolean) => void;
  }>;
}>;

export type MemoryConversationCapture = Readonly<{
  conversation: MemoryConversation;
  release: () => void;
}>;
