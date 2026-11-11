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
  isGenericCommandApproved,
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

export type AgentIdentityResolution =
  | {
      ok: true;
      effectiveAgentName: string;
      baseName: string;
      copyNumber?: number;
      isCopy: boolean;
      agentDef: AgentDefinition;
    }
  | {
      ok: false;
      error: "invalid_params" | "agent_not_found";
      reason: string;
    };

export function resolveAgentIdentity(
  agentName: string,
  roster: AgentRoster,
  requestedCopy?: number,
): AgentIdentityResolution {
  if (!agentName || typeof agentName !== "string") {
    return {
      ok: false,
      error: "invalid_params",
      reason: "Agent name is required",
    };
  }

  // If explicit copy requested
  if (requestedCopy !== undefined) {
    if (
      !Number.isInteger(requestedCopy) ||
      requestedCopy < 2 ||
      requestedCopy > MAX_TEAM_AGENTS
    ) {
      return {
        ok: false,
        error: "invalid_params",
        reason: `Copy number must be between 2 and ${MAX_TEAM_AGENTS}`,
      };
    }
    const agentDef = roster.agents.find((a) => a.name === agentName);
    if (!agentDef) {
      return {
        ok: false,
        error: "agent_not_found",
        reason: `Agent '${agentName}' was not found in team roster`,
      };
    }
    if (isOrchestratorRole(agentDef.role)) {
      return {
        ok: false,
        error: "invalid_params",
        reason: "Copies of the orchestrator agent are forbidden",
      };
    }
    return {
      ok: true,
      effectiveAgentName: `${agentName}-${requestedCopy}`,
      baseName: agentName,
      copyNumber: requestedCopy,
      isCopy: true,
      agentDef,
    };
  }

  // I2: exact name first
  const exactDef = roster.agents.find((a) => a.name === agentName);
  if (exactDef) {
    return {
      ok: true,
      effectiveAgentName: agentName,
      baseName: agentName,
      copyNumber: undefined,
      isCopy: false,
      agentDef: exactDef,
    };
  }

  // Not exact: check if it's a copy pattern (e.g. "nodo-2")
  const parsed = parseAgentCopyName(agentName);
  if (parsed.copyNumber !== undefined) {
    const copyNum = parsed.copyNumber;
    if (copyNum < 2 || copyNum > MAX_TEAM_AGENTS) {
      return {
        ok: false,
        error: "invalid_params",
        reason: `Copy number must be between 2 and ${MAX_TEAM_AGENTS}`,
      };
    }
    const baseDef = roster.agents.find((a) => a.name === parsed.baseName);
    if (!baseDef) {
      return {
        ok: false,
        error: "agent_not_found",
        reason: `Agent '${agentName}' was not found in team roster`,
      };
    }
    if (isOrchestratorRole(baseDef.role)) {
      return {
        ok: false,
        error: "invalid_params",
        reason: "Copies of the orchestrator agent are forbidden",
      };
    }
    return {
      ok: true,
      effectiveAgentName: agentName,
      baseName: parsed.baseName,
      copyNumber: copyNum,
      isCopy: true,
      agentDef: baseDef,
    };
  }

  return {
    ok: false,
    error: "agent_not_found",
    reason: `Agent '${agentName}' was not found in team roster`,
  };
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
  if (adapter === "claude-code" || adapter === "claude") return "claude";
  if (adapter === "antigravity" || adapter === "gemini") return "gemini";
  if (adapter === "codex") return "codex";
  if (adapter === "opencode") return "opencode";
  if (adapter === "cursor") return "cursor";
  if (adapter === "grok") return "grok";
  if (adapter === "pi") return "pi";
  if (adapter === "hermes") return "hermes";
  if (adapter === "generic") return "claude";
  return adapter;
}

export function resolveAgentEffort(
  agent: AgentDefinition,
  roster: AgentRoster,
): string | undefined {
  return agent.runtime?.effort ?? roster.defaults?.runtime?.effort ?? undefined;
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
    modelSettings?: Record<string, string>,
  ) => { id: string; composerSeed?: string; [key: string]: any };
  cacheSession: (session: any) => void;
  sendSessionMessage?: (sessionId: string, message: string) => Promise<boolean>;
  ensureWorktree?: (projectPath: string, copyName: string) => Promise<string>;
};

export async function openAgent(
  params: OpenAgentParams,
  deps: LauncherDependencies,
): Promise<OpenAgentResult> {
  return runProjectExclusive(params.projectPath, async () => {
    if (typeof deps.onNewHarnessTab !== "function") {
      return {
        ok: false,
        agent: params.agentName,
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
        agent: params.agentName,
        sessionId: "",
        mode: params.mode ?? "new",
        supervised: true,
        error: "invalid_roster",
        reason: rosterError ?? "Roster could not be loaded or parsed",
      };
    }

    // I2 & I3: Resolve identity (exact name first, copy limits 2..MAX_TEAM_AGENTS, orchestrator copies forbidden)
    const identity = resolveAgentIdentity(params.agentName, roster, params.copy);
    if (!identity.ok) {
      return {
        ok: false,
        agent: params.agentName,
        sessionId: "",
        mode: params.mode ?? "new",
        supervised: true,
        error: identity.error,
        reason: identity.reason,
      };
    }

    const { effectiveAgentName, isCopy, agentDef } = identity;

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

    const rawAdapter =
      agentDef.runtime?.adapter ??
      roster.defaults?.runtime?.adapter ??
      "claude-code";

    if (rawAdapter === "generic") {
      const command = agentDef.runtime?.command;
      if (!command || !command.trim()) {
        return {
          ok: false,
          agent: effectiveAgentName,
          sessionId: "",
          mode: params.mode ?? "new",
          supervised: true,
          error: "invalid_roster",
          reason: `Agent '${effectiveAgentName}' uses generic adapter but has no command specified`,
        };
      }
      const isApproved =
        (await isGenericCommandApproved(
          params.projectPath,
          effectiveAgentName,
          command,
        )) ||
        (await isGenericCommandApproved(
          params.projectPath,
          identity.baseName,
          command,
        ));
      if (!isApproved) {
        return {
          ok: false,
          agent: effectiveAgentName,
          sessionId: "",
          mode: params.mode ?? "new",
          supervised: true,
          error: "approval_required",
          reason: `Generic command '${command}' for agent '${effectiveAgentName}' has not been approved on this machine`,
        };
      }
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

    // B1 & R2: If agent is a copy, ensure worktree exists and is authorized natively in Rust.
    // The path returned by ensure_agent_worktree is used as session cwd, as the value
    // persisted in team state, and for resume validation (R2).
    let copyWorktreePath: string | undefined;
    if (isCopy) {
      try {
        if (typeof deps.ensureWorktree === "function") {
          copyWorktreePath = await deps.ensureWorktree(
            params.projectPath,
            effectiveAgentName,
          );
        } else {
          const { invoke } = await import("@tauri-apps/api/core");
          const res = await invoke<string>("ensure_agent_worktree", {
            projectPath: params.projectPath,
            copyName: effectiveAgentName,
          });
          if (typeof res === "string" && res.trim()) {
            copyWorktreePath = res;
          } else {
            copyWorktreePath = resolveWorktreePath(
              params.projectPath,
              effectiveAgentName,
            );
          }
        }
      } catch (err: unknown) {
        return {
          ok: false,
          agent: effectiveAgentName,
          sessionId: "",
          mode,
          supervised,
          error: "request_failed",
          reason: `Failed to ensure worktree for agent copy: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }

    const sessionCwd = copyWorktreePath ?? params.projectPath;

    if (mode === "resume" && state.agents[effectiveAgentName]?.sessionId) {
      const existingSessionId = state.agents[effectiveAgentName].sessionId!;

      // I5 & R2: Validate saved worktree path matches canonical worktree returned by Rust
      if (isCopy) {
        const savedWorktree = state.agents[effectiveAgentName].worktree ?? null;
        if (savedWorktree !== copyWorktreePath) {
          return {
            ok: false,
            agent: effectiveAgentName,
            sessionId: existingSessionId,
            mode: "resume",
            supervised,
            error: "invalid_params",
            reason: `Saved worktree path '${savedWorktree}' does not match canonical worktree path '${copyWorktreePath}'`,
          };
        }
      }

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

      const effectiveCwd = sessionCwd;
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
    const effort = resolveAgentEffort(agentDef, roster);
    const modelSettings = effort ? { effort } : undefined;
    const runtimeMode = supervised ? "supervised" : "auto";
    const session = modelSettings
      ? deps.newSession(harnessId, sessionCwd, model, runtimeMode, modelSettings)
      : deps.newSession(harnessId, sessionCwd, model, runtimeMode);

    if (supervised) {
      session.composerSeed = promptSeed;
    }
    deps.cacheSession(session);

    const agentToken = generateAgentToken();

    // 1. Register token with native control plane
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

    // 2. Open tab
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

    // 3. Write state
    const now = new Date().toISOString();
    state.agents[effectiveAgentName] = {
      ...state.agents[effectiveAgentName],
      sessionId: session.id,
      lastOpenedAt: now,
      status: supervised ? "awaiting_owner" : "working",
      task: params.task || "Await assignment.",
      currentTaskStartedAt: now,
      lastVerdict: undefined,
      supervised,
      worktree: copyWorktreePath ?? null,
    };
    await writeTeamState(params.projectPath, state);

    // 4. I1: Send task to unsupervised agents at the end; if send fails, degrade to awaiting_owner with composerSeed
    if (!supervised) {
      let sendSucceeded = false;
      try {
        if (typeof deps.sendSessionMessage === "function") {
          sendSucceeded = await deps.sendSessionMessage(session.id, promptSeed);
        } else {
          const { sendHarnessSessionMessage } = await import(
            "@/modules/harness/lib/harnessControlBridge"
          );
          await sendHarnessSessionMessage(session.id, promptSeed);
          sendSucceeded = true;
        }
      } catch {
        sendSucceeded = false;
      }

      if (!sendSucceeded) {
        session.composerSeed = promptSeed;
        deps.cacheSession(session);
        state.agents[effectiveAgentName] = {
          ...state.agents[effectiveAgentName],
          status: "awaiting_owner",
        };
        await writeTeamState(params.projectPath, state);
      }
    }

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
