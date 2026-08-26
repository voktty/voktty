import {
  leafIds,
  ptyIdForLeaf,
  useAgentActivityStore,
  useTerminalProgressStore,
} from "@/modules/terminal";
import type { Tab } from "./useTabs";

export type TabProcessStatus = {
  state: "attention" | "failed" | "running" | "completed" | "idle" | null;
  progress: number | null;
  agent: string | null;
};

export function useTabProcessStatus(tab: Tab): TabProcessStatus {
  const agentPhases = useAgentActivityStore((s) => s.phases);
  const agentNames = useAgentActivityStore((s) => s.agents);
  const progressLeaves = useTerminalProgressStore((s) => s.leaves);

  if (tab.kind !== "terminal" || tab.private) {
    return { state: null, progress: null, agent: null };
  }

  const leaves = leafIds(tab.paneTree);
  let attention = false;
  let failed = false;
  let running = false;
  let completed = false;
  let idle = false;

  let attentionAgent: string | null = null;
  let failedAgent: string | null = null;
  let workingAgent: string | null = null;
  let completedAgent: string | null = null;
  let idleAgent: string | null = null;
  let activeProgress: number | null = null;

  for (const leaf of leaves) {
    const ptyId = ptyIdForLeaf(leaf);

    // 1. Check Agent activity (OSC 777 / Agent detector)
    if (ptyId !== null) {
      const agentPhase = agentPhases[ptyId];
      if (agentPhase === "attention") {
        attention = true;
        attentionAgent ??= agentNames[ptyId] ?? null;
      } else if (agentPhase === "working") {
        running = true;
        workingAgent ??= agentNames[ptyId] ?? null;
      } else if (agentPhase === "finished") {
        completed = true;
        completedAgent ??= agentNames[ptyId] ?? null;
      } else if (agentPhase === "idle") {
        const agent = agentNames[ptyId];
        if (agent) {
          idle = true;
          idleAgent ??= agent;
        }
      }
    }

    // 2. Check Terminal process & progress (OSC 9;4 / OSC 133 / Command execution)
    const proc = progressLeaves[leaf];
    if (proc) {
      const agent = ptyId === null ? null : (agentNames[ptyId] ?? null);
      if (proc.state === "attention") {
        attention = true;
        attentionAgent ??= agent;
      } else if (proc.state === "failed") {
        failed = true;
        failedAgent ??= agent;
      } else if (proc.state === "running") {
        running = true;
        if (proc.progress !== null) {
          activeProgress = proc.progress;
        }
      } else if (proc.state === "completed") {
        completed = true;
        completedAgent ??= agent;
      } else if (proc.state === "idle") {
        idle = true;
      }
    }
  }

  if (attention) {
    return { state: "attention", progress: null, agent: attentionAgent };
  }
  if (failed) {
    return { state: "failed", progress: null, agent: failedAgent };
  }
  if (running) {
    return {
      state: "running",
      progress: activeProgress,
      agent: workingAgent,
    };
  }
  if (completed) {
    return { state: "completed", progress: 100, agent: completedAgent };
  }
  if (idle) {
    return { state: "idle", progress: null, agent: idleAgent };
  }

  return { state: null, progress: null, agent: null };
}
