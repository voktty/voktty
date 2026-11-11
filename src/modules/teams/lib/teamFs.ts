import { invoke } from "@tauri-apps/api/core";
import { ensureDirectory, nativeProjectPath, readTextFile, writeTextFile } from "@/modules/teams/lib/teamFileIo";
import type { AgentRoster } from "@/modules/workspace-kit/lib/configTypes";
import { validateRoster } from "./rosterValidation";
import {
  TEAM_STATE_SCHEMA,
  type TeamAgentState,
  type TeamAgentVerdict,
  type TeamState,
} from "../types";

export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

export function teamPath(projectPath: string, ...segments: string[]): string {
  const base = normalizePath(projectPath);
  return `${base}/${segments.map((s) => s.replace(/^\/+|\/+$/g, "")).join("/")}`;
}

export async function ensureTeamDirectory(path: string): Promise<void> {
  await ensureDirectory(path);
}

const projectLocks = new Map<string, Promise<unknown>>();

export function resetProjectLocks(): void {
  projectLocks.clear();
}

export async function runProjectExclusive<T>(
  projectPath: string,
  operation: () => Promise<T>,
): Promise<T> {
  const key = normalizePath(projectPath);
  const prev = projectLocks.get(key) ?? Promise.resolve();
  let resolveLock!: () => void;
  const next = new Promise<void>((resolve) => {
    resolveLock = resolve;
  });
  projectLocks.set(key, next);
  try {
    await prev;
    return await operation();
  } finally {
    resolveLock();
    if (projectLocks.get(key) === next) {
      projectLocks.delete(key);
    }
  }
}

export type RosterLoadResult = {
  roster: AgentRoster | null;
  raw?: string;
  error?: string;
};

export async function readRoster(
  projectPath: string,
): Promise<RosterLoadResult> {
  const filePath = teamPath(projectPath, ".voktty", "team", "agents.json");
  let content: string;
  try {
    content = await readTextFile(filePath);
  } catch (error) {
    return {
      roster: null,
      error: `Could not read roster at ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const { roster, error } = validateRoster(content);
  return { roster, raw: content, error };
}

export async function readRole(
  projectPath: string,
  roleRelPath: string,
): Promise<string | null> {
  const cleanRole = roleRelPath.replace(/^team\//, "").replace(/^\/+/, "");
  const filePath = teamPath(projectPath, ".voktty", "team", cleanRole);
  try {
    return await readTextFile(filePath);
  } catch {
    return null;
  }
}

export async function readTeamState(projectPath: string): Promise<TeamState> {
  const filePath = teamPath(projectPath, ".voktty", "state", "agents.json");
  try {
    const content = await readTextFile(filePath);
    const parsed = JSON.parse(content) as TeamState;
    if (parsed && typeof parsed === "object") {
      if (projectPath.startsWith("remote://")) {
        let verdicts: Record<string, TeamAgentVerdict> = {};
        try {
          verdicts = await invoke<Record<string, TeamAgentVerdict>>("team_read_verdicts", { projectPath: await nativeProjectPath(projectPath) });
        } catch {
          // A failed native read cannot authenticate a workspace verdict.
        }
        for (const [name, agent] of Object.entries(parsed.agents ?? {})) {
          const verdict = verdicts[name];
          agent.lastVerdict = verdict && (!agent.currentTaskStartedAt || Date.parse(verdict.timestamp) >= Date.parse(agent.currentTaskStartedAt))
            ? verdict : undefined;
        }
      }
      return {
        $schema: TEAM_STATE_SCHEMA,
        version: 1,
        updatedAt: parsed.updatedAt || new Date().toISOString(),
        agents: parsed.agents || {},
      };
    }
  } catch {
    // If state does not exist or cannot be parsed, initialize fresh
  }

  return {
    $schema: TEAM_STATE_SCHEMA,
    version: 1,
    updatedAt: new Date().toISOString(),
    agents: {},
  };
}

export async function writeTeamState(
  projectPath: string,
  state: TeamState,
): Promise<void> {
  const stateDir = teamPath(projectPath, ".voktty", "state");
  const filePath = teamPath(stateDir, "agents.json");

  try {
    await ensureTeamDirectory(stateDir);
  } catch {
    // Ignore error if directory already exists
  }

  const cleanAgents: Record<string, TeamAgentState> = {};
  for (const [name, agentState] of Object.entries(state.agents)) {
    const { ...rest } = agentState as Record<string, unknown>;
    // Explicitly guarantee no token or credentials leaked
    delete rest.agentToken;
    delete rest.token;
    cleanAgents[name] = rest as TeamAgentState;
  }

  const payload: TeamState = {
    $schema: TEAM_STATE_SCHEMA,
    version: 1,
    updatedAt: new Date().toISOString(),
    agents: cleanAgents,
  };

  await writeTextFile(filePath, JSON.stringify(payload, null, 2));
}

export type GenericApprovalEntry = {
  command: string;
  approvedAt: string;
};

export async function readGenericApprovals(
  projectPath: string,
): Promise<Record<string, GenericApprovalEntry>> {
  try {
    const records = await invoke<
      Record<string, { command: string; approved_at: string }>
    >("team_read_generic_approvals", { projectPath: await nativeProjectPath(projectPath) });
    const result: Record<string, GenericApprovalEntry> = {};
    if (records && typeof records === "object") {
      for (const [name, rec] of Object.entries(records)) {
        result[name] = { command: rec.command, approvedAt: rec.approved_at };
      }
    }
    return result;
  } catch {
    return {};
  }
}

export async function approveGenericCommand(
  projectPath: string,
  agentName: string,
  command: string,
): Promise<void> {
  await invoke("team_approve_generic_command", {
    projectPath: await nativeProjectPath(projectPath),
    agentName,
    command,
  });
}

export async function revokeGenericCommand(
  projectPath: string,
  agentName: string,
): Promise<void> {
  await invoke("team_revoke_generic_command", {
    projectPath: await nativeProjectPath(projectPath),
    agentName,
  });
}

export async function isGenericCommandApproved(
  projectPath: string,
  agentName: string,
  command: string,
): Promise<boolean> {
  if (!command || !agentName) return false;
  return await invoke<boolean>("team_is_generic_command_approved", {
    projectPath: await nativeProjectPath(projectPath),
    agentName,
    command,
  });
}

export async function verifyGenericLaunch(
  projectPath: string,
  agentName: string,
  command: string,
): Promise<void> {
  await invoke("team_verify_generic_launch", {
    projectPath: await nativeProjectPath(projectPath),
    agentName,
    command,
  });
}
