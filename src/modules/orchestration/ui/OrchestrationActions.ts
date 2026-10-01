import { createContext } from "react";
import type { OrchestrationProposal } from "../model/orchestrationPlan";
import type { HarnessId } from "@/modules/harness/lib/session";

export type OrchestrationWorkerDetail = {
  sessionId: string;
  leadId: string;
  title: string;
  harness: HarnessId;
};

/**
 * The lead's sidebar card lists workers. Approvals still go to the lead, not
 * to the user; `openDetails` is the one way to watch a worker's transcript.
 */
export const OrchestrationWorkers = createContext<{
  selectedId: string | null;
  inspect(sessionId: string | null): void;
  openDetails?(worker: OrchestrationWorkerDetail): void;
}>({ selectedId: null, inspect: () => {} });

// Shared by transcript cards in both ordinary and split session panes.
export const OrchestrationActions = createContext<{
  update(
    leadId: string,
    blockId: string,
    proposal: OrchestrationProposal,
  ): void;
  confirm(leadId: string, blockId: string): Promise<void>;
  retry(leadId: string, blockId: string): void;
  open(sessionId: string): void;
  openAgents?(workers: OrchestrationWorkerDetail[]): void;
} | null>(null);
