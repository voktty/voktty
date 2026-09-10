import type { PaneNode } from "@/modules/terminal";

export const AGENT_LAUNCHERS = [
  {
    id: "claude",
    label: "Claude",
    defaultCommand: "claude",
    supportsHooks: true,
  },
  {
    id: "codex",
    label: "Codex",
    defaultCommand: "codex",
    supportsHooks: true,
  },
  {
    id: "gemini",
    label: "Gemini",
    defaultCommand: "gemini",
    supportsHooks: true,
  },
  {
    id: "pi",
    label: "Pi",
    defaultCommand: "pi",
    supportsHooks: true,
  },
  {
    id: "opencode",
    label: "OpenCode",
    defaultCommand: "opencode",
    supportsHooks: false,
  },
  {
    id: "grok",
    label: "Grok",
    defaultCommand: "grok",
    supportsHooks: false,
  },
  {
    id: "hermes",
    label: "Hermes",
    defaultCommand: "hermes",
    supportsHooks: false,
  },
  {
    id: "freebuff",
    label: "Freebuff",
    defaultCommand: "freebuff",
    supportsHooks: false,
  },
] as const;

export type AgentLauncherId = (typeof AGENT_LAUNCHERS)[number]["id"];
export type AgentInstanceCount = 1 | 2 | 3 | 4;
export type AgentLaunchCommands = Record<AgentLauncherId, string>;

export type AgentLaunchRequest = {
  agent: AgentLauncherId;
  command: string;
  instances: AgentInstanceCount;
};

export const DEFAULT_AGENT_LAUNCH_COMMANDS: AgentLaunchCommands =
  Object.fromEntries(
    AGENT_LAUNCHERS.map((agent) => [agent.id, agent.defaultCommand]),
  ) as AgentLaunchCommands;

const MAX_AGENT_COMMAND_LENGTH = 256;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

export type AgentCommandValidation =
  | { ok: true; command: string }
  | { ok: false; error: string };

export function validateAgentLaunchCommand(
  value: unknown,
): AgentCommandValidation {
  if (typeof value !== "string") {
    return { ok: false, error: "Enter a start command." };
  }
  const command = value.trim();
  if (!command) return { ok: false, error: "Enter a start command." };
  if (command.length > MAX_AGENT_COMMAND_LENGTH) {
    return {
      ok: false,
      error: `Keep the command under ${MAX_AGENT_COMMAND_LENGTH} characters.`,
    };
  }
  if (CONTROL_CHARACTERS.test(command)) {
    return { ok: false, error: "Use a single-line command." };
  }
  return { ok: true, command };
}

export function normalizeAgentLaunchCommands(
  value: unknown,
): AgentLaunchCommands {
  const stored =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : {};
  return Object.fromEntries(
    AGENT_LAUNCHERS.map((agent) => {
      const result = validateAgentLaunchCommand(stored[agent.id]);
      return [
        agent.id,
        result.ok ? result.command : agent.defaultCommand,
      ] as const;
    }),
  ) as AgentLaunchCommands;
}

export function findAgentLauncher(id: AgentLauncherId) {
  return AGENT_LAUNCHERS.find((agent) => agent.id === id) ?? AGENT_LAUNCHERS[0];
}

export type AgentPanePlan = {
  paneTree: PaneNode;
  leafIds: number[];
};

export function createAgentPanePlan(
  instances: AgentInstanceCount,
  allocateId: () => number,
  cwd?: string,
): AgentPanePlan {
  if (!Number.isInteger(instances) || instances < 1 || instances > 4) {
    throw new RangeError("Agent instance count must be between 1 and 4.");
  }

  const leaves = Array.from({ length: instances }, () => ({
    kind: "leaf" as const,
    id: allocateId(),
    cwd,
  }));
  const split = (dir: "row" | "col", children: PaneNode[]): PaneNode => ({
    kind: "split",
    id: allocateId(),
    dir,
    children,
  });

  switch (instances) {
    case 1:
      return { paneTree: leaves[0], leafIds: leaves.map((leaf) => leaf.id) };
    case 2:
      return {
        paneTree: split("row", leaves),
        leafIds: leaves.map((leaf) => leaf.id),
      };
    case 3:
      return {
        paneTree: split("row", [
          leaves[0],
          split("col", [leaves[1], leaves[2]]),
        ]),
        leafIds: leaves.map((leaf) => leaf.id),
      };
    case 4:
      return {
        paneTree: split("row", [
          split("col", [leaves[0], leaves[1]]),
          split("col", [leaves[2], leaves[3]]),
        ]),
        leafIds: leaves.map((leaf) => leaf.id),
      };
  }
}

/**
 * If the terminal-emitted title matches a known agent binary name, return
 * the launcher's label (capitalised).  Handles bare command names
 * ("claude"), prefixed paths ("C:\…\claude.exe"), and "Select-String -"
 * style wrappers ("node claude").  Returns `null` when no match.
 */
export function matchAgentFromTitle(
  title: string,
): { label: string; id: AgentLauncherId } | null {
  const lower = title.toLowerCase().trim();
  for (const agent of AGENT_LAUNCHERS) {
    const cmd = agent.defaultCommand;
    // Exact match or with .exe suffix
    if (lower === cmd || lower === `${cmd}.exe`) {
      return { label: agent.label, id: agent.id };
    }
    // Title ends with the command (e.g. "/usr/bin/claude" or "node claude")
    const tail = lower.split(/[\\/\s]+/).pop() ?? "";
    if (tail === cmd || tail === `${cmd}.exe`) {
      return { label: agent.label, id: agent.id };
    }
  }
  return null;
}
