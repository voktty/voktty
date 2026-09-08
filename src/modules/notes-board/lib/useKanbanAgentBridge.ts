import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { leafIdForPty } from "@/modules/terminal";
import {
  playAgentNotificationSound,
  useAgentStore,
} from "@/modules/agents";
import type { AgentSession, AgentSignal } from "@/modules/agents/lib/types";
import { useKanbanStore } from "../store/kanbanStore";

export type KanbanBridgeOptions = {
  playCompletionSound?: boolean;
};

export function handleAgentSignalForKanban(
  sig: AgentSignal,
  options?: KanbanBridgeOptions,
): void {
  const leafId = leafIdForPty(sig.id);
  if (leafId === null) return;

  const shouldPlaySound = options?.playCompletionSound ?? true;
  const store = useKanbanStore.getState();
  if (!store.isObserving) return;

  const matchingCards = store.cards.filter(
    (card) => card.assignedExecution?.leafId === leafId,
  );
  if (matchingCards.length === 0) return;

  for (const card of matchingCards) {
    switch (sig.kind) {
      case "started":
      case "working":
        if (card.assignedExecution?.lastObservedStatus !== "working") {
          store.updateCardExecutionStatus(card.id, "working", {
            requiresAttention: false,
          });
        }
        break;

      case "attention":
        if (card.assignedExecution?.lastObservedStatus !== "waiting") {
          store.updateCardExecutionStatus(card.id, "waiting", {
            requiresAttention: true,
          });
        }
        break;

      case "finished":
        if (
          card.columnId === "in_progress" &&
          card.assignedExecution?.lastObservedStatus !== "idle"
        ) {
          store.completeCardExecution(card.id);
          if (shouldPlaySound) {
            playAgentNotificationSound();
          }
        }
        break;

      case "exited":
        if (
          card.columnId === "in_progress" &&
          card.assignedExecution?.lastObservedStatus !== "idle"
        ) {
          store.failCardExecution(
            card.id,
            "Terminal o proceso cerrado antes de finalizar",
          );
        }
        break;
    }
  }
}

export function syncKanbanWithAgentStore(
  agentState: {
    sessions: Record<number, AgentSession>;
    pulsingLeaves: Record<number, number>;
  },
  options?: KanbanBridgeOptions,
): void {
  const shouldPlaySound = options?.playCompletionSound ?? true;
  const store = useKanbanStore.getState();
  if (!store.isObserving) return;

  const inProgressCards = store.cards.filter(
    (c) => c.columnId === "in_progress" && c.assignedExecution,
  );

  for (const card of inProgressCards) {
    const leafId = card.assignedExecution!.leafId;

    // Check if agent finished via pulsingLeaves
    if (agentState.pulsingLeaves[leafId] !== undefined) {
      if (card.assignedExecution!.lastObservedStatus !== "idle") {
        store.completeCardExecution(card.id);
        if (shouldPlaySound) {
          playAgentNotificationSound();
        }
      }
      continue;
    }

    // Check status changes in active sessions
    const session = agentState.sessions[leafId];
    if (session) {
      if (
        session.status === "waiting" &&
        card.assignedExecution!.lastObservedStatus !== "waiting"
      ) {
        store.updateCardExecutionStatus(card.id, "waiting", {
          requiresAttention: true,
        });
      } else if (
        session.status === "working" &&
        card.assignedExecution!.lastObservedStatus !== "working"
      ) {
        store.updateCardExecutionStatus(card.id, "working", {
          requiresAttention: false,
        });
      }
    }
  }
}

export function useKanbanAgentBridge(options?: KanbanBridgeOptions): void {
  const shouldPlaySound = options?.playCompletionSound ?? true;

  useEffect(() => {
    let alive = true;
    let unlisten: (() => void) | undefined;

    listen<AgentSignal>("voktty:agent-signal", (e) => {
      handleAgentSignalForKanban(e.payload, {
        playCompletionSound: shouldPlaySound,
      });
    })
      .then((u) => {
        if (alive) unlisten = u;
        else u();
      })
      .catch(() => {
        // Listener not available in non-Tauri environments
      });

    const unsubscribeAgentStore = useAgentStore.subscribe((agentState) => {
      syncKanbanWithAgentStore(agentState, {
        playCompletionSound: shouldPlaySound,
      });
    });

    return () => {
      alive = false;
      unlisten?.();
      unsubscribeAgentStore();
    };
  }, [shouldPlaySound]);
}
