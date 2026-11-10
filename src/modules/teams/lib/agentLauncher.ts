import type {
  AgentDefinition,
  AgentRoster,
} from "@/modules/workspace-kit/lib/configTypes";
import {
  generateAgentToken,
  getLiveAgentBySessionId,
  listLiveAgents,
  registerLiveAgentWithControl,
} from "./agentRegistry";
import { readRole, readRoster, readTeamState, writeTeamState } from "./teamFs";
import { isModelForbidden, isOrchestratorRole } from "./rosterValidation";
export { isModelForbidden, isOrchestratorRole } from "./rosterValidation";
import type { OpenAgentParams, OpenAgentResult, TeamAgentStatus } from "../types";

export const MAX_TEAM_AGENTS = 6;

export function resolveAgentAdapter(
  agent: AgentDefinition,
  roster: AgentRoster,
): string {
  const adapter =
    agent.runtime?.adapter ?? roster.defaults?.runtime?.adapter ?? "claude-code";
  // Map kit adapter names to HarnessId
  if (adapter === "claude-code") return "claude";
  if (adapter === "antigravity") return "agy";
  return adapter;
}

export function resolveAgentModel(
  agent: AgentDefinition,
  roster: AgentRoster,
  overrideModel?: string,
): string | undefined {
  return (
    overrideModel ||
    agent.runtime?.model ||
    roster.defaults?.runtime?.model ||
    undefined
  );
}

export function resolveAgentSupervised(
  agent: AgentDefinition,
  _roster: AgentRoster,
  requested?: boolean,
): boolean {
  // Decision 3: Supervised by default, unless roster entry declares automatic.
  // Rule 7: Supervised can only harden, never relax.
  const rosterSupervised = (agent as { supervised?: boolean }).supervised !== false;
  if (rosterSupervised) {
    return true;
  }
  return requested === true;
}

export type LauncherDependencies = {
  onNewHarnessTab?: (spaceId?: string, cwd?: string, sessionId?: string) => number;
  newSession: (
    harnessId?: any,
    cwd?: string,
    model?: string,
    runtimeMode?: any,
  ) => { id: string; composerSeed?: string };
  cacheSession: (session: any) => void;
};

export async function openAgent(
  params: OpenAgentParams,
  deps: LauncherDependencies,
): Promise<OpenAgentResult> {
  const { roster, error: rosterError } = await readRoster(params.projectPath);
  if (!roster) {
    return {
      ok: false,
      agent: params.agentName,
      sessionId: "",
      mode: params.mode ?? "new",
      supervised: true,
      error: "invalid_roster",
      reason: rosterError ?? "Roster could not be loaded or parsed",
    };
  }

  const agentDef = roster.agents.find((a) => a.name === params.agentName);
  if (!agentDef) {
    return {
      ok: false,
      agent: params.agentName,
      sessionId: "",
      mode: params.mode ?? "new",
      supervised: true,
      error: "agent_not_found",
      reason: `Agent '${params.agentName}' was not found in team roster`,
    };
  }

  const model = resolveAgentModel(agentDef, roster, params.model);
  if (model && isModelForbidden(model, roster.policies?.forbiddenModels)) {
    return {
      ok: false,
      agent: params.agentName,
      sessionId: "",
      mode: params.mode ?? "new",
      supervised: true,
      error: "forbidden_model",
      reason: `Model '${model}' is in forbiddenModels policy and cannot be launched`,
    };
  }

  const live = listLiveAgents(params.projectPath);
  const isAlreadyLive = live.some((s) => s.agentName === params.agentName);
  if (!isAlreadyLive && live.length >= MAX_TEAM_AGENTS) {
    return {
      ok: false,
      agent: params.agentName,
      sessionId: "",
      mode: params.mode ?? "new",
      supervised: true,
      error: "capacity_exceeded",
      reason: `Team has reached the maximum of ${MAX_TEAM_AGENTS} concurrent agents`,
    };
  }

  const supervised = resolveAgentSupervised(agentDef, roster, params.supervised);
  const state = await readTeamState(params.projectPath);
  const mode = params.mode ?? "new";
  const isOrch = isOrchestratorRole(agentDef.role);

  if (mode === "resume" && state.agents[params.agentName]?.sessionId) {
    const existingSessionId = state.agents[params.agentName].sessionId!;
    const existingLive = getLiveAgentBySessionId(existingSessionId);
    const agentToken = existingLive?.agentToken ?? generateAgentToken();

    await registerLiveAgentWithControl({
      sessionId: existingSessionId,
      agentName: params.agentName,
      projectPath: params.projectPath,
      role: agentDef.role,
      isOrchestrator: isOrch,
      permissions: {
        canManageAgents: isOrch,
      },
      launchedAt: existingLive?.launchedAt ?? new Date().toISOString(),
      agentToken,
    });

    const tabId = deps.onNewHarnessTab?.(
      params.spaceId,
      params.projectPath,
      existingSessionId,
    );

    const now = new Date().toISOString();
    state.agents[params.agentName] = {
      ...state.agents[params.agentName],
      lastOpenedAt: now,
      supervised,
      ...(params.task
        ? {
            task: params.task,
            currentTaskStartedAt: now,
            lastVerdict: undefined,
            status: "working" as TeamAgentStatus,
          }
        : {}),
    };
    await writeTeamState(params.projectPath, state);

    return {
      ok: true,
      agent: params.agentName,
      sessionId: existingSessionId,
      tabId,
      mode: "resume",
      supervised,
    };
  }

  // Mode: "new"
  const roleContent = await readRole(params.projectPath, agentDef.role);
  const promptSeed = roleContent
    ? `Role (${agentDef.role}):\n${roleContent}\n\nTask:\n${params.task || "Await instructions from orchestrator or owner."}`
    : params.task || "Await instructions from orchestrator or owner.";

  const harnessId = resolveAgentAdapter(agentDef, roster);
  const runtimeMode = supervised ? "supervised" : "auto";
  const session = deps.newSession(harnessId, params.projectPath, model, runtimeMode);
  session.composerSeed = promptSeed;
  deps.cacheSession(session);

  const agentToken = generateAgentToken();

  await registerLiveAgentWithControl({
    sessionId: session.id,
    agentName: params.agentName,
    projectPath: params.projectPath,
    role: agentDef.role,
    isOrchestrator: isOrch,
    permissions: {
      canManageAgents: isOrch,
    },
    launchedAt: new Date().toISOString(),
    agentToken,
  });

  const tabId = deps.onNewHarnessTab?.(
    params.spaceId,
    params.projectPath,
    session.id,
  );

  const newStatus: TeamAgentStatus = "working";
  const now = new Date().toISOString();
  state.agents[params.agentName] = {
    ...state.agents[params.agentName],
    sessionId: session.id,
    lastOpenedAt: now,
    status: newStatus,
    task: params.task || "Await assignment.",
    currentTaskStartedAt: now,
    lastVerdict: undefined,
    supervised,
  };
  await writeTeamState(params.projectPath, state);

  return {
    ok: true,
    agent: params.agentName,
    sessionId: session.id,
    tabId,
    mode: "new",
    supervised,
  };
}
