import { invoke } from "@tauri-apps/api/core";
import { readTextFile, writeTextFile } from "@/modules/harness/lib/fs";
import type {
  AgentDefinition,
  AgentRoster,
} from "@/modules/workspace-kit/lib/configTypes";
import { validateRoster } from "./rosterValidation";
import { teamPath } from "./teamFs";

export type SaveAgentResult = {
  ok: boolean;
  error?: string;
  roster?: AgentRoster;
};

export async function readRosterOrEmpty(
  projectPath: string,
): Promise<AgentRoster> {
  const filePath = teamPath(projectPath, ".voktty", "team", "agents.json");
  try {
    const text = await readTextFile(filePath);
    const { roster } = validateRoster(text);
    if (roster) return roster;
  } catch {
    // Return empty starter if absent or invalid
  }
  return {
    version: 1,
    agents: [],
  };
}

export async function saveAgent(
  projectPath: string,
  agent: AgentDefinition,
): Promise<SaveAgentResult> {
  const current = await readRosterOrEmpty(projectPath);

  // Strip any accidental machine-specific fields
  const cleanAgent: AgentDefinition = {
    name: agent.name.trim(),
    role: agent.role.trim(),
    start: agent.start ?? "on-demand",
    ...(agent.description ? { description: agent.description.trim() } : {}),
    ...(agent.runtime ? { runtime: agent.runtime } : {}),
    ...(agent.owns && agent.owns.length > 0 ? { owns: agent.owns } : {}),
    ...(agent.reads && agent.reads.length > 0 ? { reads: agent.reads } : {}),
  };

  const existingIndex = current.agents.findIndex((a) => a.name === cleanAgent.name);
  const nextAgents = [...current.agents];
  if (existingIndex >= 0) {
    nextAgents[existingIndex] = cleanAgent;
  } else {
    nextAgents.push(cleanAgent);
  }

  const candidateRoster: AgentRoster = {
    ...current,
    agents: nextAgents,
  };

  const rawJson = JSON.stringify(candidateRoster, null, 2);
  const { roster, error } = validateRoster(rawJson);
  if (!roster || error) {
    return { ok: false, error: error ?? "Invalid roster configuration" };
  }

  const teamDir = teamPath(projectPath, ".voktty", "team");
  try {
    await invoke("fs_create_dir", { path: teamDir });
  } catch {
    // Ignore if directory exists
  }

  const filePath = teamPath(teamDir, "agents.json");
  await writeTextFile(filePath, rawJson);

  // Ensure role file exists or create a starter template
  const roleRel = cleanAgent.role.replace(/^team\//, "").replace(/^\/+/, "");
  const rolePath = teamPath(teamDir, roleRel);
  try {
    await readTextFile(rolePath);
  } catch {
    // Create initial role template
    const roleDir = rolePath.substring(0, rolePath.lastIndexOf("/"));
    try {
      await invoke("fs_create_dir", { path: roleDir });
    } catch {
      // Ignore
    }
    const starterRole = `# Role: ${cleanAgent.name}\n\n${cleanAgent.description || "Responsibilities and guidelines for this agent."}\n`;
    try {
      await writeTextFile(rolePath, starterRole);
    } catch {
      // Ignore
    }
  }

  return { ok: true, roster: candidateRoster };
}

export async function deleteAgent(
  projectPath: string,
  agentName: string,
): Promise<SaveAgentResult> {
  const current = await readRosterOrEmpty(projectPath);
  const nextAgents = current.agents.filter((a) => a.name !== agentName);

  const candidateRoster: AgentRoster = {
    ...current,
    agents: nextAgents,
  };

  const rawJson = JSON.stringify(candidateRoster, null, 2);
  const { roster, error } = validateRoster(rawJson);
  if (!roster || error) {
    return { ok: false, error: error ?? "Invalid roster after deletion" };
  }

  const filePath = teamPath(projectPath, ".voktty", "team", "agents.json");
  await writeTextFile(filePath, rawJson);
  return { ok: true, roster: candidateRoster };
}

export async function readRules(projectPath: string): Promise<string | null> {
  const filePath = teamPath(projectPath, ".voktty", "RULES.md");
  try {
    return await readTextFile(filePath);
  } catch {
    return null;
  }
}

export async function saveRules(
  projectPath: string,
  content: string,
): Promise<void> {
  const vokttyDir = teamPath(projectPath, ".voktty");
  try {
    await invoke("fs_create_dir", { path: vokttyDir });
  } catch {
    // Ignore
  }
  const filePath = teamPath(vokttyDir, "RULES.md");
  await writeTextFile(filePath, content);
}
