import type { AgentIconId } from "../lib/agents";

export const AVATAR_PRESENCE_STATES = [
  "idle",
  "listening",
  "thinking",
  "planning",
  "tool-running",
  "awaiting-approval",
  "streaming",
  "success",
  "warning",
  "error",
  "cancelled",
] as const;

export type AvatarPresenceState = (typeof AVATAR_PRESENCE_STATES)[number];

export type AvatarProfileId =
  | "coder"
  | "architect"
  | "reviewer"
  | "security"
  | "designer"
  | "spark";

export type AvatarPresence = {
  state: AvatarPresenceState;
  intensity: number;
  phase: string | null;
};

export type ChatPresenceInput = {
  status: "idle" | "thinking" | "streaming" | "awaiting-approval" | "error";
  step?: string | null;
  approvalsPending?: number;
};

export type TerminalPresenceInput = {
  state:
    | "attention"
    | "failed"
    | "running"
    | "completed"
    | "idle"
    | null;
  agent?: string | null;
};

export function clampPresenceIntensity(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(1, Math.max(0, value));
}

export function makePresence(
  state: AvatarPresenceState,
  options: { intensity?: number; phase?: string | null } = {},
): AvatarPresence {
  return {
    state,
    intensity: clampPresenceIntensity(
      options.intensity ?? defaultIntensity(state),
    ),
    phase: options.phase ?? null,
  };
}

function defaultIntensity(state: AvatarPresenceState): number {
  switch (state) {
    case "idle":
      return 0.2;
    case "success":
      return 0.8;
    case "error":
    case "warning":
    case "awaiting-approval":
      return 0.9;
    default:
      return 0.65;
  }
}

export function chatPresence(input: ChatPresenceInput): AvatarPresence {
  if (input.approvalsPending && input.approvalsPending > 0) {
    return makePresence("awaiting-approval", { phase: input.step });
  }

  if (input.status === "thinking") {
    const step = input.step?.toLowerCase() ?? "";
    const state = /plan|planning|analys|decid/.test(step)
      ? "planning"
      : /tool|read|write|edit|search|command|terminal|run/.test(step)
        ? "tool-running"
        : "thinking";
    return makePresence(state, { phase: input.step });
  }

  switch (input.status) {
    case "streaming":
      return makePresence("streaming", { phase: input.step });
    case "awaiting-approval":
      return makePresence("awaiting-approval", { phase: input.step });
    case "error":
      return makePresence("error", { phase: input.step });
    default:
      return makePresence("idle", { phase: input.step });
  }
}

export function terminalPresence(
  input: TerminalPresenceInput,
): AvatarPresence | null {
  if (!input.agent || !input.state) return null;

  switch (input.state) {
    case "attention":
      return makePresence("awaiting-approval");
    case "failed":
      return makePresence("error");
    case "running":
      return makePresence("tool-running");
    case "completed":
      return makePresence("success");
    case "idle":
      return makePresence("idle");
  }
}

export function profileForAgentIcon(icon: AgentIconId): AvatarProfileId {
  if (icon === "architect") return "architect";
  if (icon === "reviewer") return "reviewer";
  if (icon === "security") return "security";
  if (icon === "designer") return "designer";
  if (icon === "spark") return "spark";
  return "coder";
}

export function profileForAgentName(
  name: string | null | undefined,
): AvatarProfileId {
  const normalized = name?.trim().toLowerCase() ?? "";
  if (/architect|planner|plan/.test(normalized)) return "architect";
  if (/review|critic|lint/.test(normalized)) return "reviewer";
  if (/security|secure|audit|snyk/.test(normalized)) return "security";
  if (/designer|design|ui|ux/.test(normalized)) return "designer";
  if (/claude|codex|aider|cursor|opencode|developer|coder/.test(normalized)) {
    return "coder";
  }
  return "spark";
}
