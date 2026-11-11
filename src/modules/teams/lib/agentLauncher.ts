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
import {
  readRole,
  readRoster,
  readTeamState,
  runProjectExclusive,
  writeTeamState,
} from "./teamFs";
import { isModelForbidden, isOrchestratorRole } from "./rosterValidation";
export { isModelForbidden, isOrchestratorRole } from "./rosterValidation";
import type { OpenAgentParams, OpenAgentResult, TeamAgentStatus } from "../types";

export const MAX_TEAM_AGENTS = 6;

export function parseAgentCopyName(name: string): {
  baseName: string;
  copyNumber?: number;
} {
  const match = /^(.*?)-(\d+)$/.exec(name);
  if (match && match[1] && match[2]) {
    const copyNum = parseInt(match[2], 10);
    if (!Number.isNaN(copyNum) && copyNum > 0) {
      return { baseName: match[1], copyNumber: copyNum };
    }
  }
  return { baseName: name, copyNumber: undefined };
}

export function resolveWorktreePath(
  projectPath: string,
  copyName: string,
): string {
  // Worktree path outside the repository and outside .voktty/
  const normalized = projectPath.replace(/[\/\\]+$/, "");
  const isSlash = normalized.includes("/");
  const sep = isSlash ? "/" : "\\";
  const lastSep = normalized.lastIndexOf(sep);
  const parentDir = lastSep > 0 ? normalized.slice(0, lastSep) : normalized;
  const projBase = lastSep > 0 ? normalized.slice(lastSep + 1) : "workspace";
  return `${parentDir}${sep}${projBase}-worktrees${sep}${copyName}`;
}

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
  sendSessionMessage?: (sessionId: string, message: string) => Promise<boolean>;
};

export async function openAgent(
  params: OpenAgentParams,
  deps: LauncherDependencies,
): Promise<OpenAgentResult> {
  return runProjectExclusive(params.projectPath, async () => {
    const parsedCopy = parseAgentCopyName(params.agentName);
    const copyNumber = params.copy ?? parsedCopy.copyNumber;
    const baseName = parsedCopy.baseName;
    const effectiveAgentName =
      copyNumber !== undefined ? `${baseName}-${copyNumber}` : baseName;

    if (typeof deps.onNewHarnessTab !== "function") {
      return {
        ok: false,
        agent: effectiveAgentName,
        sessionId: "",
        mode: params.mode ?? "new",
        supervised: true,
        error: "request_failed",
        reason: "No harness tab opener is available in the current window context",
      };
    }

    const { roster, error: rosterError } = await readRoster(params.projectPath);
    if (!roster) {
      return {
        ok: false,
        agent: effectiveAgentName,
        sessionId: "",
        mode: params.mode ?? "new",
        supervised: true,
        error: "invalid_roster",
        reason: rosterError ?? "Roster could not be loaded or parsed",
      };
    }

    const agentDef = roster.agents.find((a) => a.name === baseName);
    if (!agentDef) {
      return {
        ok: false,
        agent: effectiveAgentName,
        sessionId: "",
        mode: params.mode ?? "new",
        supervised: true,
        error: "agent_not_found",
        reason: `Agent '${baseName}' was not found in team roster`,
      };
    }

    const model = resolveAgentModel(agentDef, roster, params.model);
    if (model && isModelForbidden(model, roster.policies?.forbiddenModels)) {
      return {
        ok: false,
        agent: effectiveAgentName,
        sessionId: "",
        mode: params.mode ?? "new",
        supervised: true,
        error: "forbidden_model",
        reason: `Model '${model}' is in forbiddenModels policy and cannot be launched`,
      };
    }

    const live = listLiveAgents(params.projectPath);
    const isAlreadyLive = live.some((s) => s.agentName === effectiveAgentName);
    const mode = params.mode ?? "new";

    // Duplicate session guard in mode: "new"
    if (mode === "new" && isAlreadyLive) {
      const active = live.find((s) => s.agentName === effectiveAgentName);
      return {
        ok: false,
        agent: effectiveAgentName,
        sessionId: active?.sessionId ?? "",
        mode: "new",
        supervised: true,
        error: "duplicate_session",
        reason: `Agent '${effectiveAgentName}' already has an active running session (${active?.sessionId})`,
      };
    }

    if (!isAlreadyLive && live.length >= MAX_TEAM_AGENTS) {
      return {
        ok: false,
        agent: effectiveAgentName,
        sessionId: "",
        mode,
        supervised: true,
        error: "capacity_exceeded",
        reason: `Team has reached the maximum of ${MAX_TEAM_AGENTS} concurrent agents`,
      };
    }

    const supervised = resolveAgentSupervised(agentDef, roster, params.supervised);
    const state = await readTeamState(params.projectPath);
    const isOrch = isOrchestratorRole(agentDef.role);

    const isCopy = copyNumber !== undefined;
    const worktreePath = isCopy
      ? resolveWorktreePath(params.projectPath, effectiveAgentName)
      : undefined;
    const sessionCwd = worktreePath ?? params.projectPath;

    if (mode === "resume" && state.agents[effectiveAgentName]?.sessionId) {
      const existingSessionId = state.agents[effectiveAgentName].sessionId!;
      const existingLive = getLiveAgentBySessionId(existingSessionId);
      const agentToken = existingLive?.agentToken ?? generateAgentToken();

      const registered = await registerLiveAgentWithControl({
        sessionId: existingSessionId,
        agentName: effectiveAgentName,
        projectPath: params.projectPath,
        role: agentDef.role,
        isOrchestrator: isOrch,
        permissions: {
          canManageAgents: isOrch,
        },
        launchedAt: existingLive?.launchedAt ?? new Date().toISOString(),
        agentToken,
      });

      if (!registered) {
        return {
          ok: false,
          agent: effectiveAgentName,
          sessionId: existingSessionId,
          mode: "resume",
          supervised,
          error: "request_failed",
          reason: "Failed to register agent token with native control plane",
        };
      }

      const effectiveCwd =
        state.agents[effectiveAgentName].worktree || sessionCwd;
      const tabId = deps.onNewHarnessTab(
        params.spaceId,
        effectiveCwd,
        existingSessionId,
      );

      if (typeof tabId !== "number") {
        return {
          ok: false,
          agent: effectiveAgentName,
          sessionId: existingSessionId,
          mode: "resume",
          supervised,
          error: "request_failed",
          reason: "Harness tab opener failed to create a tab",
        };
      }

      const now = new Date().toISOString();
      state.agents[effectiveAgentName] = {
        ...state.agents[effectiveAgentName],
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
        agent: effectiveAgentName,
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
    const session = deps.newSession(harnessId, sessionCwd, model, runtimeMode);

    let initialStatus: TeamAgentStatus;
    if (supervised) {
      // Supervised agents wait for owner approval/send
      session.composerSeed = promptSeed;
      deps.cacheSession(session);
      initialStatus = "awaiting_owner";
    } else {
      // Unsupervised (auto) agents start immediately with initial task
      deps.cacheSession(session);
      initialStatus = "working";
      if (typeof deps.sendSessionMessage === "function") {
        await deps.sendSessionMessage(session.id, promptSeed);
      } else {
        try {
          const { sendHarnessSessionMessage } = await import(
            "@/modules/harness/lib/harnessControlBridge"
          );
          await sendHarnessSessionMessage(session.id, promptSeed);
        } catch {
          session.composerSeed = promptSeed;
        }
      }
    }

    const agentToken = generateAgentToken();

    const registered = await registerLiveAgentWithControl({
      sessionId: session.id,
      agentName: effectiveAgentName,
      projectPath: params.projectPath,
      role: agentDef.role,
      isOrchestrator: isOrch,
      permissions: {
        canManageAgents: isOrch,
      },
      launchedAt: new Date().toISOString(),
      agentToken,
    });

    if (!registered) {
      return {
        ok: false,
        agent: effectiveAgentName,
        sessionId: session.id,
        mode: "new",
        supervised,
        error: "request_failed",
        reason: "Failed to register agent token with native control plane",
      };
    }

    const tabId = deps.onNewHarnessTab(
      params.spaceId,
      sessionCwd,
      session.id,
    );

    if (typeof tabId !== "number") {
      return {
        ok: false,
        agent: effectiveAgentName,
        sessionId: session.id,
        mode: "new",
        supervised,
        error: "request_failed",
        reason: "Harness tab opener failed to create a tab",
      };
    }

    const now = new Date().toISOString();
    state.agents[effectiveAgentName] = {
      ...state.agents[effectiveAgentName],
      sessionId: session.id,
      lastOpenedAt: now,
      status: initialStatus,
      task: params.task || "Await assignment.",
      currentTaskStartedAt: now,
      lastVerdict: undefined,
      supervised,
      worktree: worktreePath ?? null,
    };
    await writeTeamState(params.projectPath, state);

    return {
      ok: true,
      agent: effectiveAgentName,
      sessionId: session.id,
      tabId,
      mode: "new",
      supervised,
    };
  });
}
