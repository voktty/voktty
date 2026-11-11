import {
  getHarnessSessionSnapshot,
  interruptHarnessSession,
} from "@/modules/harness/lib/harnessControlBridge";
import type { TeamAgentStatus, TeamMessageKind } from "../types";
import {
  openAgent,
  parseAgentCopyName,
  resolveAgentIdentity,
} from "./agentLauncher";
import { getLiveAgentByToken, revokeLiveAgent } from "./agentRegistry";
import { isModelForbidden } from "./rosterValidation";
import { deliverPendingMessages, sendMessage } from "./teamBus";
import {
  readRoster,
  readTeamState,
  runProjectExclusive,
  writeTeamState,
} from "./teamFs";

export class AgentControlError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AgentControlError";
  }
}

export type DispatchContext = {
  onNewHarness?: (params: {
    harness?: string;
    cwd?: string;
    prompt?: string;
    model?: string;
    runtimeMode?: string;
    spaceId?: string;
  }) => Promise<{ sessionId: string; tabId: number }>;
  onNewHarnessTab?: (
    spaceId?: string,
    cwd?: string,
    sessionId?: string,
  ) => number;
  onCloseTab?: (tabId: number) => void;
  tabsRef?: {
    current: Array<{
      id: number;
      kind: string;
      sessionId?: string;
      [key: string]: unknown;
    }>;
  };
  activeTabIdRef?: { current: number };
  activeSpaceIdRef?: { current: string | null };
};

export type AgentCaller = {
  pane_id?: number;
  agent_token?: string;
  agentToken?: string;
  session_id?: string;
};

export async function dispatchAgentMethod(
  method: string,
  rawParams: unknown,
  caller: AgentCaller,
  context: DispatchContext = {},
): Promise<unknown> {
  const params =
    typeof rawParams === "object" && rawParams !== null
      ? (rawParams as Record<string, unknown>)
      : {};

  // 1. Authenticate caller using VOKTTY_AGENT_TOKEN
  const token = caller.agent_token || caller.agentToken;
  if (!token) {
    throw new AgentControlError(
      "forbidden",
      "Missing agent token; caller is not an authorized team agent",
    );
  }

  const callerAgent = getLiveAgentByToken(token);
  if (!callerAgent) {
    throw new AgentControlError(
      "forbidden",
      "Caller is not a registered live agent of Voktty",
    );
  }

  // 2. Project scope validation
  const requestedProject =
    typeof params.project === "string" ? params.project : undefined;
  const projectPath = requestedProject || callerAgent.projectPath;
  if (requestedProject && requestedProject !== callerAgent.projectPath) {
    throw new AgentControlError(
      "forbidden",
      "Cross-project agent access is forbidden",
    );
  }

  // 3. Permission verification for management verbs (B6)
  const isManagementVerb =
    method === "agent.start" || method === "agent.stop" || method === "agent.close";
  if (isManagementVerb) {
    const isOrchestrator = callerAgent.isOrchestrator;
    const canManage = callerAgent.permissions?.canManageAgents === true;
    if (!isOrchestrator && !canManage) {
      throw new AgentControlError(
        "forbidden",
        "Only orchestrator agents can start, stop, or close agents",
      );
    }
  }

  switch (method) {
    case "agent.list": {
      const { roster } = await readRoster(projectPath);
      const teamState = await readTeamState(projectPath);
      const rosterAgents = roster?.agents ?? [];
      const rosterNames = new Set(rosterAgents.map((a) => a.name));

      const allAgentEntries: Array<{
        name: string;
        role: string;
        adapter: string;
        defaultModel?: string;
        effort?: string;
      }> = [];

      for (const agentDef of rosterAgents) {
        allAgentEntries.push({
          name: agentDef.name,
          role: agentDef.role,
          adapter: agentDef.runtime?.adapter ?? "claude-code",
          defaultModel:
            agentDef.runtime?.model || roster?.defaults?.runtime?.model,
          effort: agentDef.runtime?.effort ?? roster?.defaults?.runtime?.effort,
        });
      }

      for (const [stateName, stateEntry] of Object.entries(teamState.agents)) {
        if (
          !rosterNames.has(stateName) &&
          (stateEntry?.sessionId || stateEntry?.status !== "unopened")
        ) {
          const { baseName } = parseAgentCopyName(stateName);
          const baseDef = rosterAgents.find((a) => a.name === baseName);
          if (baseDef) {
            allAgentEntries.push({
              name: stateName,
              role: baseDef.role,
              adapter: baseDef.runtime?.adapter ?? "claude-code",
              defaultModel:
                baseDef.runtime?.model || roster?.defaults?.runtime?.model,
              effort:
                baseDef.runtime?.effort ?? roster?.defaults?.runtime?.effort,
            });
          }
        }
      }

      const agents = allAgentEntries.map((entry) => {
        const state = teamState.agents[entry.name];
        let status: TeamAgentStatus = state?.status ?? "unopened";
        let pendingApprovals = 0;
        let activeModel = entry.defaultModel;

        if (state?.sessionId) {
          const snap = getHarnessSessionSnapshot(state.sessionId);
          if (snap) {
            if (snap.model) {
              activeModel = snap.model;
            }
            if (snap.pendingApproval) {
              status = "waiting_approval";
              pendingApprovals = 1;
            } else if (snap.state === "working") {
              status = "working";
            } else if (state?.status === "awaiting_owner") {
              status = "awaiting_owner";
            } else if (snap.state === "done" || snap.state === "idle") {
              status = "idle";
            }
          } else {
            // If session is no longer active in memory, mark copies as unopened
            if (!rosterNames.has(entry.name)) {
              status = "unopened";
            }
          }
        }

        return {
          name: entry.name,
          role: entry.role,
          adapter: entry.adapter,
          model: activeModel || "default",
          effort: entry.effort ?? null,
          host: "local",
          status,
          task: state?.task ?? null,
          lastVerdict: state?.lastVerdict?.text ?? null,
          pendingApprovals,
          unreadMessages: 0,
          sessionId: state?.sessionId ?? null,
          supervised: state?.supervised ?? true,
        };
      });

      return {
        project: projectPath,
        agents,
      };
    }

    case "agent.start": {
      const agentName = params.agent;
      if (!agentName || typeof agentName !== "string") {
        throw new AgentControlError("invalid_params", "agent name is required");
      }

      const { roster } = await readRoster(projectPath);
      if (!roster) {
        throw new AgentControlError("not_found", "Team roster not found");
      }

      const identity = resolveAgentIdentity(
        agentName,
        roster,
        typeof params.copy === "number" ? params.copy : undefined,
      );
      if (!identity.ok) {
        throw new AgentControlError(
          identity.error === "agent_not_found" ? "not_found" : identity.error,
          identity.reason,
        );
      }
      const agentDef = identity.agentDef;

      // Check forbidden models policy using unified validator (B5)
      const requestedModel =
        typeof params.model === "string" ? params.model : undefined;
      const model =
        requestedModel ??
        agentDef.runtime?.model ??
        roster.defaults?.runtime?.model;
      if (model && isModelForbidden(model, roster.policies?.forbiddenModels)) {
        throw new AgentControlError(
          "forbidden_model",
          `Model '${model}' is forbidden by team policy`,
        );
      }

      const requestedSupervised =
        typeof params.supervised === "boolean" ? params.supervised : undefined;

      const { newSession } = await import("@/modules/harness/lib/session");
      const { cacheSession } = await import("@/modules/harness/lib/sessionStore");

      if (!context.onNewHarnessTab) {
        throw new AgentControlError(
          "request_failed",
          "No harness tab opener is available in the current window context",
        );
      }

      const result = await openAgent(
        {
          projectPath,
          agentName,
          mode: params.mode === "resume" ? "resume" : "new",
          task: typeof params.task === "string" ? params.task : undefined,
          model: requestedModel,
          supervised: requestedSupervised,
          copy: typeof params.copy === "number" ? params.copy : undefined,
        },
        {
          onNewHarnessTab: context.onNewHarnessTab,
          newSession,
          cacheSession,
        },
      );

      if (!result.ok) {
        const errCode =
          result.error === "capacity_exceeded"
            ? "capacity_exceeded"
            : result.error === "forbidden_model"
              ? "forbidden_model"
              : result.error === "duplicate_session"
                ? "duplicate_session"
                : result.error === "invalid_params"
                  ? "invalid_params"
                  : result.error === "agent_not_found"
                    ? "not_found"
                    : result.error === "approval_required"
                      ? "approval_required"
                      : "request_failed";
        throw new AgentControlError(
          errCode,
          result.reason ?? result.error ?? "Failed to start agent",
        );
      }

      return {
        ok: true,
        agent: result.agent,
        sessionId: result.sessionId,
        tabId: result.tabId,
        tab_id: result.tabId,
        mode: result.mode,
        supervised: result.supervised,
      };
    }

    case "agent.approve": {
      const agentName = params.agent;
      if (!agentName || typeof agentName !== "string") {
        throw new AgentControlError("invalid_params", "agent name is required");
      }
      const { roster } = await readRoster(projectPath);
      const agentDef = roster?.agents.find((a) => a.name === agentName);
      if (!agentDef) {
        throw new AgentControlError("not_found", `Agent '${agentName}' not found`);
      }
      const command =
        typeof params.command === "string" && params.command.trim()
          ? params.command.trim()
          : agentDef.runtime?.command;
      if (!command) {
        throw new AgentControlError("invalid_params", "No command to approve");
      }
      const { approveGenericCommand } = await import("./teamFs");
      await approveGenericCommand(projectPath, agentName, command);
      return { ok: true, agent: agentName, approvedCommand: command };
    }

    case "agent.revoke": {
      const agentName = params.agent;
      if (!agentName || typeof agentName !== "string") {
        throw new AgentControlError("invalid_params", "agent name is required");
      }
      const { revokeGenericCommand } = await import("./teamFs");
      await revokeGenericCommand(projectPath, agentName);
      return { ok: true, agent: agentName };
    }

    case "agent.send": {
      const to = params.to;
      const kind = params.kind;
      const text = params.text;
      if (!to || typeof to !== "string") {
        throw new AgentControlError("invalid_params", "'to' recipient is required");
      }
      if (!kind || typeof kind !== "string") {
        throw new AgentControlError("invalid_params", "'kind' is required");
      }
      if (typeof text !== "string") {
        throw new AgentControlError("invalid_params", "'text' must be a string");
      }

      const replyTo =
        typeof params.reply_to === "string"
          ? params.reply_to
          : typeof params.replyTo === "string"
            ? params.replyTo
            : undefined;

      try {
        const msg = await sendMessage({
          projectPath,
          from: callerAgent.agentName,
          to,
          kind: kind as TeamMessageKind,
          text,
          replyTo,
        });

        // If sender has any pending messages, deliver now (F1)
        try {
          await deliverPendingMessages(projectPath, callerAgent.agentName);
        } catch {
          // Ignore
        }

        return {
          ok: true,
          messageId: msg.id,
          delivered: msg.delivered,
          status: msg.delivered ? "delivered" : "queued",
        };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.startsWith("invalid_params")) {
          throw new AgentControlError("invalid_params", msg);
        }
        if (msg.startsWith("rate_limited")) {
          throw new AgentControlError("rate_limited", msg);
        }
        if (msg.startsWith("message_too_large")) {
          throw new AgentControlError("message_too_large", msg);
        }
        if (msg.startsWith("hop_limit_exceeded")) {
          throw new AgentControlError("hop_limit_exceeded", msg);
        }
        throw err;
      }
    }

    case "agent.status": {
      const agentName = params.agent;
      if (!agentName || typeof agentName !== "string") {
        throw new AgentControlError("invalid_params", "agent name is required");
      }

      const teamState = await readTeamState(projectPath);
      const agentState = teamState.agents[agentName];
      let status: TeamAgentStatus = agentState?.status ?? "unopened";
      let pendingApprovals = 0;

      if (agentState?.sessionId) {
        const snap = getHarnessSessionSnapshot(agentState.sessionId);
        if (snap) {
          if (snap.pendingApproval) {
            status = "waiting_approval";
            pendingApprovals = 1;
          } else if (snap.state === "working") {
            status = "working";
          } else if (agentState?.status === "awaiting_owner") {
            status = "awaiting_owner";
          } else if (snap.state === "done" || snap.state === "idle") {
            status = "idle";
          }
        }
      }

      // If the inspected agent is idle/done, check and deliver pending messages (F1)
      if (status === "idle" || status === "unopened") {
        try {
          await deliverPendingMessages(projectPath, agentName);
        } catch {
          // Ignore
        }
      }

      return {
        agent: agentName,
        status,
        sessionId: agentState?.sessionId ?? null,
        task: agentState?.task ?? null,
        pendingApprovals,
        lastVerdict: agentState?.lastVerdict?.text ?? null,
      };
    }

    case "agent.wait": {
      const agentName = params.agent;
      if (!agentName || typeof agentName !== "string") {
        throw new AgentControlError("invalid_params", "agent name is required");
      }

      const until =
        typeof params.until === "string" ? params.until : "verdict";
      const teamState = await readTeamState(projectPath);
      const agentState = teamState.agents[agentName];

      let currentStatus: TeamAgentStatus = agentState?.status ?? "unopened";
      let pendingApproval = false;
      if (agentState?.sessionId) {
        const snap = getHarnessSessionSnapshot(agentState.sessionId);
        if (snap) {
          if (snap.pendingApproval) {
            currentStatus = "waiting_approval";
            pendingApproval = true;
          } else if (snap.state === "working") {
            currentStatus = "working";
          } else if (agentState?.status === "awaiting_owner") {
            currentStatus = "awaiting_owner";
          } else if (snap.state === "done" || snap.state === "idle") {
            currentStatus = "idle";
          }
        }
      }

      if (pendingApproval) {
        throw new AgentControlError(
          "needs_input",
          `Agent '${agentName}' is waiting for user approval in its tab`,
        );
      }

      if (currentStatus === "awaiting_owner") {
        return {
          ok: true,
          matched: true,
          agent: agentName,
          condition: until,
          status: "awaiting_owner",
          info: `Agent '${agentName}' is awaiting owner input to start`,
        };
      }

      // Deliver pending messages to caller and target agent if not working (F1)
      try {
        await deliverPendingMessages(projectPath, callerAgent.agentName);
      } catch {
        // Ignore
      }
      if (currentStatus !== "working") {
        try {
          await deliverPendingMessages(projectPath, agentName);
        } catch {
          // Ignore
        }
      }

      if (until === "verdict") {
        const verdict = agentState?.lastVerdict;
        const startedAt = agentState?.currentTaskStartedAt;
        // F2: only return matched if verdict was produced during/after current task started
        const isCurrentVerdict =
          verdict && (!startedAt || verdict.timestamp >= startedAt);

        if (isCurrentVerdict) {
          return {
            ok: true,
            matched: true,
            agent: agentName,
            condition: "verdict",
            status: currentStatus,
            verdict: verdict.text,
          };
        }
      } else if (until === "idle" && currentStatus === "idle") {
        return {
          ok: true,
          matched: true,
          agent: agentName,
          condition: "idle",
          status: currentStatus,
        };
      } else if (
        until === "waiting_approval" &&
        currentStatus === "waiting_approval"
      ) {
        return {
          ok: true,
          matched: true,
          agent: agentName,
          condition: "waiting_approval",
          status: currentStatus,
        };
      } else if (until === "any" && currentStatus !== "working") {
        return {
          ok: true,
          matched: true,
          agent: agentName,
          condition: "any",
          status: currentStatus,
        };
      }

      return {
        ok: true,
        matched: false,
        agent: agentName,
        status: currentStatus,
      };
    }

    case "agent.result": {
      const agentName = params.agent;
      if (!agentName || typeof agentName !== "string") {
        throw new AgentControlError("invalid_params", "agent name is required");
      }

      const teamState = await readTeamState(projectPath);
      const agentState = teamState.agents[agentName];
      if (!agentState?.lastVerdict) {
        throw new AgentControlError(
          "not_found",
          `No verdict found for agent '${agentName}'`,
        );
      }

      return {
        agent: agentName,
        verdict: agentState.lastVerdict.text,
        timestamp: agentState.lastVerdict.timestamp,
        messageId: agentState.lastVerdict.messageId ?? null,
      };
    }

    case "agent.stop": {
      const agentName = params.agent;
      if (!agentName || typeof agentName !== "string") {
        throw new AgentControlError("invalid_params", "agent name is required");
      }

      return runProjectExclusive(projectPath, async () => {
        const teamState = await readTeamState(projectPath);
        const agentState = teamState.agents[agentName];
        if (agentState?.sessionId) {
          interruptHarnessSession(agentState.sessionId);
          // F3: confirm that session is no longer working
          const deadline = Date.now() + 500;
          while (Date.now() < deadline) {
            const snap = getHarnessSessionSnapshot(agentState.sessionId);
            if (!snap || snap.state !== "working") {
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
          const snap = getHarnessSessionSnapshot(agentState.sessionId);
          if (snap && snap.state === "working") {
            throw new AgentControlError(
              "stop_failed",
              `Could not stop busy agent '${agentName}'`,
            );
          }
          agentState.status = "idle";
          await writeTeamState(projectPath, teamState);
        }

        return {
          ok: true,
          agent: agentName,
          stopped: true,
        };
      });
    }

    case "agent.close": {
      const agentName = params.agent;
      if (!agentName || typeof agentName !== "string") {
        throw new AgentControlError("invalid_params", "agent name is required");
      }

      return runProjectExclusive(projectPath, async () => {
        const teamState = await readTeamState(projectPath);
        const agentState = teamState.agents[agentName];

        if (agentState?.sessionId) {
          const snap = getHarnessSessionSnapshot(agentState.sessionId);
          if (snap && snap.state === "working") {
            throw new AgentControlError(
              "busy",
              `Agent '${agentName}' is busy working; run agent.stop before closing`,
            );
          }
        }

        if (agentState) {
          // F3 & B2: close tab if mounted
          if (context.tabsRef?.current && agentState.sessionId && context.onCloseTab) {
            const tab = context.tabsRef.current.find(
              (t) => t.kind === "harness" && t.sessionId === agentState.sessionId,
            );
            if (tab) {
              context.onCloseTab(tab.id);
            }
          }

          // F3 & B2: revoke live agent token
          if (agentState.sessionId) {
            await revokeLiveAgent(agentState.sessionId);
          }

          agentState.status = "unopened";
          agentState.sessionId = undefined;
          await writeTeamState(projectPath, teamState);
        }

        return {
          ok: true,
          agent: agentName,
          closed: true,
        };
      });
    }

    default:
      throw new AgentControlError(
        "unknown_method",
        `Unknown agent method '${method}'`,
      );
  }
}
