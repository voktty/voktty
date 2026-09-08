import { displayAgent } from "@/modules/agents/lib/format";
import type { AgentSession } from "@/modules/agents/lib/types";

export type ActiveAgentTarget = {
  leafId: number;
  tabId: number;
  agent: string;
  displayName: string;
  tabTitle: string;
  status: "working" | "waiting" | "idle";
};

export type TabSummary = {
  id: number;
  title?: string;
  kind?: string;
  activeLeafId?: number;
};

/** Formats a Kanban card into a structured instruction prompt for an AI agent or terminal. */
export function formatTaskForAgent(card: {
  title: string;
  description?: string;
}): string {
  const title = card.title.trim();
  const desc = (card.description || "").trim();
  if (!desc) {
    return `Tarea: ${title}`;
  }
  return `Tarea: ${title}\n\nDetalles:\n${desc}`;
}

/**
 * Resolves available agent and terminal targets based on live agentStore sessions
 * and currently open tabs.
 */
export function resolveActiveAgentTargets(
  sessions: Record<number, AgentSession>,
  tabs?: TabSummary[],
): ActiveAgentTarget[] {
  const targets: ActiveAgentTarget[] = [];
  const claimedLeaves = new Set<number>();

  // 1. First add detected CLI agent sessions (Claude Code, Gemini, Codex, Pi, etc.)
  for (const session of Object.values(sessions)) {
    claimedLeaves.add(session.leafId);
    const tab = tabs?.find((t) => t.id === session.tabId);
    const tabTitle = tab?.title?.trim() || `Pestana ${session.tabId}`;
    const displayName = displayAgent(session.agent);

    targets.push({
      leafId: session.leafId,
      tabId: session.tabId,
      agent: session.agent,
      displayName,
      tabTitle,
      status: session.status,
    });
  }

  // 2. Also expose open terminal tabs without an active agent as fallback targets
  if (tabs) {
    for (const tab of tabs) {
      if (
        tab.kind === "terminal" &&
        tab.activeLeafId !== undefined &&
        !claimedLeaves.has(tab.activeLeafId)
      ) {
        const tabTitle = tab.title?.trim() || `Pestana ${tab.id}`;
        targets.push({
          leafId: tab.activeLeafId,
          tabId: tab.id,
          agent: "terminal",
          displayName: "Terminal",
          tabTitle,
          status: "idle",
        });
      }
    }
  }

  return targets;
}

/** Formats an execution duration in milliseconds to a human-readable compact string. */
export function formatExecutionDuration(ms: number): string {
  if (ms <= 0) return "<1s";
  if (ms < 1000) return "<1s";
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  if (minutes < 60) {
    return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}
