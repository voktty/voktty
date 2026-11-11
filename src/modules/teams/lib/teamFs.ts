import { invoke } from "@tauri-apps/api/core";
import { readTextFile, writeTextFile } from "@/modules/harness/lib/fs";
import type { AgentRoster } from "@/modules/workspace-kit/lib/configTypes";
import { validateRoster } from "./rosterValidation";
import {
  TEAM_STATE_SCHEMA,
  type TeamAgentState,
  type TeamState,
} from "../types";

export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

export function teamPath(projectPath: string, ...segments: string[]): string {
  const base = normalizePath(projectPath);
  return `${base}/${segments.map((s) => s.replace(/^\/+|\/+$/g, "")).join("/")}`;
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
    await invoke("fs_create_dir", { path: stateDir });
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

export const GENERIC_APPROVALS_SCHEMA = "urn:voktty:generic-approvals:1" as const;

export type GenericApprovalsState = {
  $schema: typeof GENERIC_APPROVALS_SCHEMA;
  version: 1;
  updatedAt: string;
  approvals: Record<string, GenericApprovalEntry>;
};

export async function readGenericApprovals(
  projectPath: string,
): Promise<Record<string, GenericApprovalEntry>> {
  const filePath = teamPath(
    projectPath,
    ".voktty",
    "state",
    "generic_approvals.json",
  );
  try {
    const content = await readTextFile(filePath);
    const parsed = JSON.parse(content) as GenericApprovalsState;
    if (
      parsed &&
      typeof parsed === "object" &&
      parsed.approvals &&
      typeof parsed.approvals === "object"
    ) {
      return parsed.approvals;
    }
  } catch {
    // If state does not exist or cannot be parsed, return empty record
  }
  return {};
}

export async function approveGenericCommand(
  projectPath: string,
  agentName: string,
  command: string,
): Promise<void> {
  const approvals = await readGenericApprovals(projectPath);
  approvals[agentName] = {
    command: command.trim(),
    approvedAt: new Date().toISOString(),
  };

  const stateDir = teamPath(projectPath, ".voktty", "state");
  const filePath = teamPath(stateDir, "generic_approvals.json");

  try {
    await invoke("fs_create_dir", { path: stateDir });
  } catch {
    // Ignore error if directory already exists
  }

  const payload: GenericApprovalsState = {
    $schema: GENERIC_APPROVALS_SCHEMA,
    version: 1,
    updatedAt: new Date().toISOString(),
    approvals,
  };

  await writeTextFile(filePath, JSON.stringify(payload, null, 2));
}

export async function revokeGenericCommand(
  projectPath: string,
  agentName: string,
): Promise<void> {
  const approvals = await readGenericApprovals(projectPath);
  delete approvals[agentName];

  const stateDir = teamPath(projectPath, ".voktty", "state");
  const filePath = teamPath(stateDir, "generic_approvals.json");

  try {
    await invoke("fs_create_dir", { path: stateDir });
  } catch {
    // Ignore error if directory already exists
  }

  const payload: GenericApprovalsState = {
    $schema: GENERIC_APPROVALS_SCHEMA,
    version: 1,
    updatedAt: new Date().toISOString(),
    approvals,
  };

  await writeTextFile(filePath, JSON.stringify(payload, null, 2));
}

export async function isGenericCommandApproved(
  projectPath: string,
  agentName: string,
  command: string,
): Promise<boolean> {
  if (!command || !agentName) return false;
  const approvals = await readGenericApprovals(projectPath);
  const entry = approvals[agentName];
  return Boolean(entry && entry.command.trim() === command.trim());
}
