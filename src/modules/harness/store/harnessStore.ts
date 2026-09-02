import { create } from "zustand";
import { fetchMessages, fetchSessions } from "@/modules/agent-history/lib/agentHistoryBridge";
import type { HistoryMessage } from "@/modules/agent-history/types";
import { harnessClient } from "../harnessClient";
import { cancelAgentTurn, respondAgentApproval, sendAgentTurn } from "../protocols";
import type {
  AssistantBlock,
  CheckpointStatus,
  HarnessAgentId,
  HarnessBlock,
  HarnessEvent,
  HarnessProbeResult,
  HarnessSession,
  HarnessSessionSummary,
  RuntimeMode,
  ToolBlock,
  UserPromptBlock,
} from "../types";

function normalizeHarnessAgent(agent?: string | null): HarnessAgentId {
  if (!agent) return "antigravity";
  const lower = agent.toLowerCase();
  if (lower.includes("agy") || lower.includes("antigravity") || lower.includes("gemini")) {
    return "antigravity";
  }
  if (lower.includes("claude")) return "claude";
  if (lower.includes("codex")) return "codex";
  if (lower.includes("cursor")) return "cursor";
  if (lower.includes("opencode")) return "opencode";
  return "antigravity";
}

function convertHistoryMessagesToBlocks(messages: HistoryMessage[]): HarnessBlock[] {
  const blocks: HarnessBlock[] = [];

  for (const msg of messages) {
    if (msg.role === "user") {
      blocks.push({
        id: msg.id,
        type: "user",
        text: msg.content,
        timestamp: msg.timestamp,
      });
    } else if (msg.role === "assistant") {
      blocks.push({
        id: msg.id,
        type: "assistant",
        text: msg.content,
        timestamp: msg.timestamp,
      });
    } else if (msg.role === "thought" || msg.role === "system") {
      blocks.push({
        id: msg.id,
        type: "thought",
        text: msg.content,
        timestamp: msg.timestamp,
      });
    } else if (msg.role === "tool" || msg.tool_name) {
      const toolName = (msg.tool_name || "tool").toLowerCase();
      const isCmd =
        toolName.includes("bash") ||
        toolName.includes("command") ||
        toolName.includes("terminal") ||
        toolName.includes("exec");
      const isWrite =
        toolName.includes("write") ||
        toolName.includes("replace") ||
        toolName.includes("edit") ||
        toolName.includes("patch");
      const isRead =
        toolName.includes("read") ||
        toolName.includes("view") ||
        toolName.includes("cat");
      const isSearch =
        toolName.includes("search") ||
        toolName.includes("grep") ||
        toolName.includes("find");

      const kind: ToolBlock["kind"] = isCmd
        ? "command"
        : isWrite
          ? "write"
          : isRead
            ? "read"
            : isSearch
              ? "search"
              : "other";

      blocks.push({
        id: msg.id,
        type: "tool",
        callId: msg.id,
        title: msg.tool_name || "Tool Execution",
        kind,
        status: msg.is_error ? "failed" : "completed",
        preview: {
          kind,
          command: isCmd ? msg.tool_input || undefined : undefined,
          target: !isCmd ? msg.tool_input || undefined : undefined,
        },
        detail: msg.tool_output || undefined,
        timestamp: msg.timestamp,
      });
    }
  }

  return blocks;
}

export type HarnessState = {
  sessions: Record<string, HarnessSession>;
  sessionSummaries: HarnessSessionSummary[];
  activeSessionId: string | null;
  isStreaming: Record<string, boolean>;
  checkpoints: Record<string, CheckpointStatus | null>;
  availableAgents: HarnessProbeResult[];
  statusText: Record<string, string>;

  // Actions
  probeAgents: () => Promise<void>;
  createSession: (params: {
    cwd: string;
    harness: HarnessAgentId;
    model: string;
    runtimeMode?: RuntimeMode;
    title?: string;
  }) => Promise<string>;
  setActiveSession: (id: string | null) => void;
  loadSession: (id: string) => Promise<void>;
  listSessions: (cwd?: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;

  sendTurn: (params: {
    sessionId: string;
    text: string;
    attachments?: string[];
  }) => Promise<void>;
  cancelTurn: (sessionId: string) => Promise<void>;
  respondApproval: (
    sessionId: string,
    requestId: number,
    decision: "allow" | "deny",
  ) => Promise<void>;

  refreshCheckpoint: (sessionId: string, cwd: string) => Promise<void>;
  undoTurn: (sessionId: string, cwd: string) => Promise<number>;
  keepTurn: (sessionId: string) => Promise<void>;
};

export const useHarnessStore = create<HarnessState>((set, get) => ({
  sessions: {},
  sessionSummaries: [],
  activeSessionId: null,
  isStreaming: {},
  checkpoints: {},
  availableAgents: [],
  statusText: {},

  probeAgents: async () => {
    try {
      const results = await harnessClient.probeAvailability();
      set({ availableAgents: results });
    } catch {
      // Fallback
    }
  },

  createSession: async ({ cwd, harness, model, runtimeMode = "plan", title }) => {
    const id = `session-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const newSession: HarnessSession = {
      id,
      cwd,
      harness,
      model,
      modelSettings: {},
      runtimeMode,
      title: title || "New development task",
      blocks: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    set((s) => ({
      sessions: { ...s.sessions, [id]: newSession },
      activeSessionId: id,
    }));

    try {
      await harnessClient.upsertSession(newSession);
    } catch {}

    return id;
  },

  setActiveSession: (id) => set({ activeSessionId: id }),

  loadSession: async (id: string) => {
    try {
      // 1. Try loading from harness SQLite database
      const sess = await harnessClient.getSession(id).catch(() => null);
      if (sess) {
        set((s) => ({
          sessions: { ...s.sessions, [id]: sess },
          activeSessionId: id,
        }));
        return;
      }

      // 2. Otherwise load from agent_history (scanned terminal sessions)
      const messages = await fetchMessages(id, 0, 500).catch(() => []);
      if (messages.length > 0) {
        const historySessions = await fetchSessions().catch(() => []);
        const hist = historySessions.find((s) => s.id === id);

        const convertedBlocks = convertHistoryMessagesToBlocks(messages);
        const reconstructedSession: HarnessSession = {
          id,
          cwd: hist?.cwd || hist?.project_path || "",
          harness: normalizeHarnessAgent(hist?.agent || "antigravity"),
          model: "gemini-3.7-flash",
          modelSettings: {},
          runtimeMode: "act",
          title: hist?.title || "Agent Session",
          blocks: convertedBlocks,
          createdAt: hist?.created_at || Date.now(),
          updatedAt: hist?.updated_at || Date.now(),
        };

        set((s) => ({
          sessions: { ...s.sessions, [id]: reconstructedSession },
          activeSessionId: id,
        }));
      }
    } catch {}
  },

  listSessions: async (cwd?: string) => {
    try {
      const harnessList = await harnessClient.listSessions(cwd).catch(() => []);
      const historySessions = await fetchSessions().catch(() => []);

      const historySummaries: HarnessSessionSummary[] = historySessions.map((hs) => ({
        id: hs.id,
        cwd: hs.cwd || hs.project_path || "",
        harness: normalizeHarnessAgent(hs.agent),
        model: "gemini-3.7-flash",
        title: hs.title || `Session ${hs.agent}`,
        blockCount: hs.message_count,
        createdAt: hs.created_at || Date.now(),
        updatedAt: hs.updated_at || Date.now(),
      }));

      // Merge and deduplicate
      const map = new Map<string, HarnessSessionSummary>();
      for (const item of harnessList) {
        map.set(item.id, item);
      }
      for (const item of historySummaries) {
        if (!map.has(item.id)) {
          map.set(item.id, item);
        }
      }

      const merged = Array.from(map.values()).sort((a, b) => b.updatedAt - a.updatedAt);
      set({ sessionSummaries: merged });
    } catch {}
  },

  deleteSession: async (id: string) => {
    try {
      await harnessClient.deleteSession(id);
      set((s) => {
        const nextSessions = { ...s.sessions };
        delete nextSessions[id];
        return {
          sessions: nextSessions,
          sessionSummaries: s.sessionSummaries.filter((sum) => sum.id !== id),
          activeSessionId: s.activeSessionId === id ? null : s.activeSessionId,
        };
      });
    } catch {}
  },

  sendTurn: async ({ sessionId, text, attachments }) => {
    const state = get();
    const session = state.sessions[sessionId];
    if (!session) return;

    // Append user block
    const userBlock: UserPromptBlock = {
      id: `usr-${Date.now()}`,
      type: "user",
      text,
      attachments,
      timestamp: Date.now(),
    };

    const assistantBlock: AssistantBlock = {
      id: `ast-${Date.now()}`,
      type: "assistant",
      text: "",
      isStreaming: true,
      timestamp: Date.now(),
    };

    const updatedBlocks = [...session.blocks, userBlock, assistantBlock];
    const updatedSession = {
      ...session,
      blocks: updatedBlocks,
      updatedAt: Date.now(),
    };

    set((s) => ({
      sessions: { ...s.sessions, [sessionId]: updatedSession },
      isStreaming: { ...s.isStreaming, [sessionId]: true },
      statusText: { ...s.statusText, [sessionId]: "Thinking..." },
    }));

    const onEvent = (event: HarnessEvent) => {
      set((s) => {
        const curSess = s.sessions[sessionId];
        if (!curSess) return s;

        let nextBlocks = [...curSess.blocks];
        const lastIdx = nextBlocks.length - 1;
        const lastBlock = nextBlocks[lastIdx];

        if (event.type === "message.delta") {
          if (lastBlock && lastBlock.type === "assistant") {
            nextBlocks[lastIdx] = {
              ...lastBlock,
              text: lastBlock.text + event.text,
              isStreaming: true,
            };
          }
        } else if (event.type === "message.completed") {
          if (lastBlock && lastBlock.type === "assistant") {
            nextBlocks[lastIdx] = {
              ...lastBlock,
              isStreaming: false,
            };
          }
        } else if (event.type === "tool.started") {
          const toolBlock: ToolBlock = {
            id: event.callId,
            type: "tool",
            callId: event.callId,
            title: event.title,
            kind: (event.kind as any) || "command",
            status: "running",
            preview: event.preview,
            timestamp: Date.now(),
          };
          nextBlocks.push(toolBlock);
        } else if (event.type === "tool.updated") {
          const tIdx = nextBlocks.findIndex(
            (b) => b.type === "tool" && (b as ToolBlock).callId === event.callId,
          );
          if (tIdx >= 0) {
            const curTool = nextBlocks[tIdx] as ToolBlock;
            nextBlocks[tIdx] = {
              ...curTool,
              status: event.status || curTool.status,
              detail: event.detail || curTool.detail,
            };
          }
        } else if (event.type === "context") {
          return {
            sessions: {
              ...s.sessions,
              [sessionId]: {
                ...curSess,
                blocks: nextBlocks,
                contextUsed: event.used ?? curSess.contextUsed,
                contextWindow: event.window ?? curSess.contextWindow,
              },
            },
          };
        } else if (event.type === "session.ended") {
          return {
            isStreaming: { ...s.isStreaming, [sessionId]: false },
            statusText: { ...s.statusText, [sessionId]: "Ready" },
          };
        }

        return {
          sessions: {
            ...s.sessions,
            [sessionId]: {
              ...curSess,
              blocks: nextBlocks,
              updatedAt: Date.now(),
            },
          },
        };
      });
    };

    try {
      await sendAgentTurn({
        sessionId,
        cwd: session.cwd,
        harness: session.harness,
        model: session.model,
        runtimeMode: session.runtimeMode,
        text,
        attachments,
        onEvent,
      });

      // Save state to SQLite
      const finalSess = get().sessions[sessionId];
      if (finalSess) {
        await harnessClient.upsertSession(finalSess);
        await get().refreshCheckpoint(sessionId, finalSess.cwd);
      }
    } catch (err: any) {
      set((s) => ({
        isStreaming: { ...s.isStreaming, [sessionId]: false },
        statusText: { ...s.statusText, [sessionId]: "Error" },
      }));
    }
  },

  cancelTurn: async (sessionId: string) => {
    await cancelAgentTurn(sessionId);
    set((s) => ({
      isStreaming: { ...s.isStreaming, [sessionId]: false },
      statusText: { ...s.statusText, [sessionId]: "Cancelled" },
    }));
  },

  respondApproval: async (sessionId, _requestId, decision) => {
    await respondAgentApproval(sessionId, decision);
  },

  refreshCheckpoint: async (sessionId: string, cwd: string) => {
    try {
      const status = await harnessClient.getCheckpointStatus(sessionId, cwd);
      set((s) => ({
        checkpoints: { ...s.checkpoints, [sessionId]: status },
      }));
    } catch {}
  },

  undoTurn: async (sessionId: string, cwd: string) => {
    const reverted = await harnessClient.undoCheckpoint(sessionId, cwd);
    set((s) => ({
      checkpoints: { ...s.checkpoints, [sessionId]: null },
    }));
    return reverted;
  },

  keepTurn: async (sessionId: string) => {
    await harnessClient.keepCheckpoint(sessionId);
    set((s) => ({
      checkpoints: { ...s.checkpoints, [sessionId]: null },
    }));
  },
}));
