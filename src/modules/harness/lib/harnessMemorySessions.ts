import { createHarnessMemoryDelivery } from "@/modules/harness/lib/harnessMemoryDelivery";
import type { MemoryConversation } from "@/modules/workspace-kit/lib/memoryConversation";
import {
  createMemoryConversations,
  qualifyMemoryConversation,
} from "@/modules/workspace-kit/lib/memoryConversations";

export type HarnessMemorySession = MemoryConversation;

export function createHarnessMemorySessions() {
  return createMemoryConversations(createHarnessMemoryDelivery);
}

export const qualifyHarnessMemorySession = qualifyMemoryConversation;
