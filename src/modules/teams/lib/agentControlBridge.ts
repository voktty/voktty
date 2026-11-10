import {
  getHarnessSessionSnapshot,
  interruptHarnessSession,
} from "@/modules/harness/lib/harnessControlBridge";
import type { TeamAgentStatus } from "../types";
import { openAgent } from "./agentLauncher";
import { getLiveAgentByToken } from "./agentRegistry";
import { deliverPendingMessages, sendMessage } from "./teamBus";
import { readRoster, readTeamState, writeTeamState } from "./teamFs";

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
  onNewHarness?: any;
  tabsRef?: any;
  activeTabIdRef?: any;
  activeSpaceIdRef?: any;
};

export async function dispatchAgentMethod(
  method: string,
  rawParams: unknown,
  caller: {
    pane_id?: number;
    agent_token?: string;
    agentToken?: string;
    session_id?: string;
  },
  context: DispatchContext = {},
): Promise<unknown> {
  const params =
    typeof rawParams === "object" && rawParams !== null
      ? (rawParams as Record<string, any>)
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
  const projectPath = params.project || callerAgent.projectPath;
  if (params.project && params.project !== callerAgent.projectPath) {
    throw new AgentControlError(
      "forbidden",
      "Cross-project agent access is forbidden",
    );
  }

  // 3. Permission verification for management verbs
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
      const agents = (roster?.agents ?? []).map((agentDef) => {
        const state = teamState.agents[agentDef.name];
        let status: TeamAgentStatus = state?.status ?? "unopened";
        let pendingApprovals = 0;
        if (state?.sessionId) {
          const snap = getHarnessSessionSnapshot(state.sessionId);
          if (snap) {
            if (snap.pendingApproval) {
              status = "waiting_approval";
              pendingApprovals = 1;
            } else if (snap.state === "working") {
              status = "working";
            } else if (snap.state === "done" || snap.state === "idle") {
              status = "idle";
            }
          }
        }

        return {
          name: agentDef.name,
          role: agentDef.role,
          adapter: agentDef.runtime?.adapter ?? "claude-code",
          model: agentDef.runtime?.model ?? "claude-3-7-sonnet",
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

      const agentDef = roster.agents.find((a) => a.name === agentName);
      if (!agentDef) {
        throw new AgentControlError(
          "not_found",
          `Agent '${agentName}' not found in team roster`,
        );
      }

      // Check forbidden models policy
      const model = params.model ?? agentDef.runtime?.model ?? roster.defaults?.runtime?.model;
      if (model && roster.policies?.forbiddenModels) {
        const isForbidden = roster.policies.forbiddenModels.some((f: string) =>
          model.toLowerCase().includes(f.toLowerCase()),
        );
        if (isForbidden) {
          throw new AgentControlError(
            "forbidden_model",
            `Model '${model}' is forbidden by team policy`,
          );
        }
      }

      // Supervised hardening rule: caller cannot relax supervised if roster says true
      let supervised = params.supervised;
      if (supervised === false && (agentDef as any).supervised === true) {
        supervised = true;
      }

      // Check 6 concurrent agents capacity limit
      const teamState = await readTeamState(projectPath);
      const activeAgents = Object.entries(teamState.agents).filter(
        ([name, st]) =>
          name !== agentName &&
          (st.status === "working" ||
            st.status === "idle" ||
            st.status === "waiting_approval"),
      );
      if (activeAgents.length >= 6) {
        throw new AgentControlError(
          "capacity_exceeded",
          "Team capacity limit reached (maximum 6 active agents)",
        );
      }

      const { newSession } = await import("@/modules/harness/lib/session");
      const { cacheSession } = await import("@/modules/harness/lib/sessionStore");

      const result = await openAgent(
        {
          projectPath,
          agentName,
          mode: params.mode === "resume" ? "resume" : "new",
          task: params.task,
          model: params.model,
          supervised: supervised ?? true,
          copy: params.copy,
        },
        {
          onNewHarnessTab: context.onNewHarness,
          newSession,
          cacheSession,
        },
      );

      if (!result.ok) {
        throw new AgentControlError(
          "request_failed",
          result.reason ?? result.error ?? "Failed to start agent",
        );
      }

      return {
        ok: true,
        agent: result.agent,
        sessionId: result.sessionId,
        tabId: result.tabId,
        mode: result.mode,
        supervised: result.supervised,
      };
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

      try {
        const msg = await sendMessage({
          projectPath,
          from: callerAgent.agentName,
          to,
          kind: kind as any,
          text,
          replyTo: params.reply_to || params.replyTo,
        });

        return {
          ok: true,
          messageId: msg.id,
          delivered: msg.delivered,
          status: msg.delivered ? "delivered" : "queued",
        };
      } catch (err: any) {
        const msg = err instanceof Error ? err.message : String(err);
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
      if (!agentName) {
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
          } else if (snap.state === "done" || snap.state === "idle") {
            status = "idle";
          }
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
      if (!agentName) {
        throw new AgentControlError("invalid_params", "agent name is required");
      }

      const until = params.until || "verdict";
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

      if (until === "verdict") {
        if (agentState?.lastVerdict) {
          // If caller is orchestrator, deliver pending messages now that it's waiting
          await deliverPendingMessages(projectPath, callerAgent.agentName);
          return {
            ok: true,
            matched: true,
            agent: agentName,
            condition: "verdict",
            status: currentStatus,
            verdict: agentState.lastVerdict.text,
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
      } else if (until === "waiting_approval" && currentStatus === "waiting_approval") {
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
      if (!agentName) {
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
      if (!agentName) {
        throw new AgentControlError("invalid_params", "agent name is required");
      }

      const teamState = await readTeamState(projectPath);
      const agentState = teamState.agents[agentName];
      if (agentState?.sessionId) {
        interruptHarnessSession(agentState.sessionId);
        agentState.status = "idle";
        await writeTeamState(projectPath, teamState);
      }

      return {
        ok: true,
        agent: agentName,
        stopped: true,
      };
    }

    case "agent.close": {
      const agentName = params.agent;
      if (!agentName) {
        throw new AgentControlError("invalid_params", "agent name is required");
      }

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
        agentState.status = "unopened";
        agentState.sessionId = undefined;
        await writeTeamState(projectPath, teamState);
      }

      return {
        ok: true,
        agent: agentName,
        closed: true,
      };
    }

    default:
      throw new AgentControlError(
        "unknown_method",
        `Unknown agent method '${method}'`,
      );
  }
}
