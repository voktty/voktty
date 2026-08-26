import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";

export type AgentPhase = "working" | "attention" | "finished" | "idle";

type AgentSignal = { id: number; kind: string; agent?: string | null };

type AgentActivityStore = {
  phases: Record<number, AgentPhase>;
  // pty -> agent name, learned from the `started` signal and kept until exit so
  // the tab can show that agent's brand icon while it runs.
  agents: Record<number, string>;
  setPhase: (id: number, phase: AgentPhase) => void;
  setAgent: (id: number, agent: string) => void;
  acknowledgeAttention: (ids: readonly number[]) => void;
  clear: (id: number) => void;
};

export const KNOWN_AGENTS = [
  "claude",
  "codex",
  "gemini",
  "pi",
  "opencode",
  "grok",
  "kimi",
  "aider",
  "cursor",
  "antigravity",
  "deepseek",
  "qwen",
  "mistral",
  "perplexity",
] as const;

export function detectAgentFromName(raw: string): string | null {
  if (!raw || typeof raw !== "string") return null;
  const lower = raw.toLowerCase().trim();
  const words = lower.split(/[\s/\\:@]+/);
  for (const w of words) {
    const clean = w
      .replace(/\.(cmd|exe|ps1|bat|js|mjs|cjs|sh|py)$/, "")
      .replace(/^[_-]+|[_-]+$/g, "");
    for (const known of KNOWN_AGENTS) {
      if (
        clean === known ||
        clean.startsWith(`${known}-`) ||
        clean.startsWith(`${known}_`) ||
        clean.endsWith(`-${known}`) ||
        clean.endsWith(`_${known}`)
      ) {
        return known;
      }
    }
  }
  return null;
}

export const useAgentActivityStore = create<AgentActivityStore>((set) => ({
  phases: {},
  agents: {},
  setPhase: (id, phase) => {
    if (phase !== "working") {
      clearAgentActivityTimer(id);
    }
    set((s) => {
      if (s.phases[id] === phase) return s;
      return { phases: { ...s.phases, [id]: phase } };
    });
  },
  setAgent: (id, agent) =>
    set((s) => {
      if (s.agents[id] === agent) return s;
      return { agents: { ...s.agents, [id]: agent } };
    }),
  acknowledgeAttention: (ids) =>
    set((s) => {
      let phases: Record<number, AgentPhase> | null = null;
      for (const id of ids) {
        clearAgentActivityTimer(id);
        if (s.phases[id] !== "attention") continue;
        phases ??= { ...s.phases };
        phases[id] = "idle";
      }
      return phases ? { phases } : s;
    }),
  clear: (id) => {
    clearAgentActivityTimer(id);
    set((s) => {
      if (!(id in s.phases) && !(id in s.agents)) return s;
      const phases = { ...s.phases };
      const agents = { ...s.agents };
      delete phases[id];
      delete agents[id];
      return { phases, agents };
    });
  },
}));

const FINISHED_TTL_MS = 6000;
const finishedTimers = new Map<number, ReturnType<typeof setTimeout>>();
export const AGENT_ACTIVITY_SETTLE_MS = 3000;
const activityTimers = new Map<number, ReturnType<typeof setTimeout>>();

export function clearAgentActivityTimer(id: number): void {
  const t = activityTimers.get(id);
  if (t) {
    clearTimeout(t);
    activityTimers.delete(id);
  }
}

export function touchAgentActivity(
  id: number,
  options?: { agent?: string },
): void {
  const store = useAgentActivityStore.getState();
  if (options?.agent) {
    store.setAgent(id, options.agent);
  }
  const agent = store.agents[id];
  if (!agent) return;

  if (store.phases[id] !== "attention") {
    store.setPhase(id, "working");
  }

  clearAgentActivityTimer(id);
  activityTimers.set(
    id,
    setTimeout(() => {
      clearAgentActivityTimer(id);
      const s = useAgentActivityStore.getState();
      if (s.phases[id] === "working") {
        s.setPhase(id, "idle");
      }
    }, AGENT_ACTIVITY_SETTLE_MS),
  );
}

function clearFinishedTimer(id: number): void {
  const t = finishedTimers.get(id);
  if (t) {
    clearTimeout(t);
    finishedTimers.delete(id);
  }
}

let onExited: ((ptyId: number) => void) | null = null;
let bound = false;

/** Maps a raw detector signal to the phase it drives, `"exited"` to drop the
 * pty, or `null` to ignore. Pure so the mapping stays unit-testable. */
export function phaseForSignal(
  kind: string,
): Exclude<AgentPhase, "idle"> | "exited" | null {
  switch (kind) {
    case "started":
    case "working":
      return "working";
    case "attention":
      return "attention";
    case "finished":
      return "finished";
    case "exited":
      return "exited";
    default:
      return null;
  }
}

// The Rust detector arms via the Claude Code / Codex / Gemini OSC 777 marker and
// reports per-pty lifecycle: started, working, attention, finished, exited.
export function ensureAgentActivityListener(
  exited: (ptyId: number) => void,
): void {
  onExited = exited;
  if (bound || typeof window === "undefined") return;
  bound = true;
  void listen<AgentSignal>("voktty:agent-signal", (e) => {
    const { id, agent } = e.payload;
    const action = phaseForSignal(e.payload.kind);
    if (action === null) return;
    clearFinishedTimer(id);
    const store = useAgentActivityStore.getState();
    if (action === "exited") {
      store.clear(id);
      onExited?.(id);
      return;
    }
    // The agent name only rides the `started` signal (incl. self-arm).
    if (agent) store.setAgent(id, agent);
    store.setPhase(id, action);
    if (action === "finished") {
      finishedTimers.set(
        id,
        setTimeout(() => {
          finishedTimers.delete(id);
          const s = useAgentActivityStore.getState();
          if (s.phases[id] === "finished") s.setPhase(id, "idle");
        }, FINISHED_TTL_MS),
      );
    }
  });
}

export function isAgentActivePty(ptyId: number): boolean {
  return ptyId in useAgentActivityStore.getState().phases;
}

export type AgentTabStatus = {
  state: "attention" | "working" | "finished" | "idle" | null;
  // The running agent's name when its brand icon should be shown.
  agent: string | null;
};

// Highest-severity phase across the tab's ptys wins: attention > working >
// finished > idle. Surface an agent name for every known phase so the tab can
// keep the active agent's brand avatar while preserving generic fallbacks.
export function tabAgentStatus(
  phases: Record<number, AgentPhase>,
  agents: Record<number, string>,
  ptyIds: readonly number[],
): AgentTabStatus {
  let attention = false;
  let working = false;
  let finished = false;
  let idle = false;
  let attentionAgent: string | null = null;
  let workingAgent: string | null = null;
  let finishedAgent: string | null = null;
  let idleAgent: string | null = null;
  for (const id of ptyIds) {
    const phase = phases[id];
    if (phase === "attention") {
      attention = true;
      attentionAgent ??= agents[id] ?? null;
    } else if (phase === "working") {
      working = true;
      workingAgent ??= agents[id] ?? null;
    } else if (phase === "finished") {
      finished = true;
      finishedAgent ??= agents[id] ?? null;
    } else if (phase === "idle") {
      const agent = agents[id];
      if (agent) {
        idle = true;
        idleAgent ??= agent;
      }
    }
  }
  if (attention) return { state: "attention", agent: attentionAgent };
  if (working) return { state: "working", agent: workingAgent };
  if (finished) return { state: "finished", agent: finishedAgent };
  if (idle) return { state: "idle", agent: idleAgent };
  return { state: null, agent: null };
}
