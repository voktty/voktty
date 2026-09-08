import { beforeEach, describe, expect, it, vi } from "vitest";
import { useKanbanStore } from "../store/kanbanStore";
import {
  handleAgentSignalForKanban,
  syncKanbanWithAgentStore,
} from "./useKanbanAgentBridge";
import type { AgentSession, AgentSignal } from "@/modules/agents/lib/types";

vi.mock("@/modules/terminal", () => ({
  leafIdForPty: (ptyId: number) => ptyId,
}));

const mockPlaySound = vi.fn();
vi.mock("@/modules/agents", () => ({
  playAgentNotificationSound: () => mockPlaySound(),
  useAgentStore: {
    getState: vi.fn(),
    subscribe: vi.fn(() => () => undefined),
  },
}));

describe("useKanbanAgentBridge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    if (typeof localStorage !== "undefined") {
      localStorage.clear();
    }
    useKanbanStore.getState().resetCards([]);
  });

  describe("handleAgentSignalForKanban", () => {
    it("updates card to working on started/working signals", () => {
      const card = useKanbanStore.getState().addCard({
        title: "Tarea en terminal",
        description: "Comandos",
        columnId: "in_progress",
      });

      useKanbanStore.getState().assignCardToAgent(card.id, {
        leafId: 10,
        tabId: 1,
        agentName: "Claude",
        startedAt: 1000,
        lastObservedStatus: "waiting",
      });

      const signal: AgentSignal = {
        id: 10,
        kind: "working",
        agent: "claude",
      };

      handleAgentSignalForKanban(signal);

      const updated = useKanbanStore.getState().cards.find((c) => c.id === card.id);
      expect(updated?.assignedExecution?.lastObservedStatus).toBe("working");
      expect(updated?.assignedExecution?.requiresAttention).toBe(false);
    });

    it("updates card to waiting and requiresAttention on attention signal", () => {
      const card = useKanbanStore.getState().addCard({
        title: "Requiere autorizacion",
        description: "Comandos",
        columnId: "in_progress",
      });

      useKanbanStore.getState().assignCardToAgent(card.id, {
        leafId: 20,
        tabId: 1,
        agentName: "Codex",
        startedAt: 1000,
        lastObservedStatus: "working",
      });

      const signal: AgentSignal = {
        id: 20,
        kind: "attention",
        agent: "codex",
      };

      handleAgentSignalForKanban(signal);

      const updated = useKanbanStore.getState().cards.find((c) => c.id === card.id);
      expect(updated?.assignedExecution?.lastObservedStatus).toBe("waiting");
      expect(updated?.assignedExecution?.requiresAttention).toBe(true);
    });

    it("auto-transitions card to done and plays sound on finished signal", () => {
      const card = useKanbanStore.getState().addCard({
        title: "Tarea finalizable",
        description: "Comandos",
        columnId: "in_progress",
      });

      useKanbanStore.getState().assignCardToAgent(card.id, {
        leafId: 30,
        tabId: 2,
        agentName: "Gemini",
        startedAt: 5000,
        lastObservedStatus: "working",
      });

      const signal: AgentSignal = {
        id: 30,
        kind: "finished",
        agent: "gemini",
      };

      handleAgentSignalForKanban(signal, { playCompletionSound: true });

      const updated = useKanbanStore.getState().cards.find((c) => c.id === card.id);
      expect(updated?.columnId).toBe("done");
      expect(updated?.assignedExecution?.lastObservedStatus).toBe("idle");
      expect(updated?.assignedExecution?.finishedAt).toBeDefined();
      expect(updated?.assignedExecution?.durationMs).toBeDefined();
      expect(mockPlaySound).toHaveBeenCalledOnce();
    });

    it("respects playCompletionSound: false option", () => {
      const card = useKanbanStore.getState().addCard({
        title: "Tarea silenciosa",
        description: "",
        columnId: "in_progress",
      });

      useKanbanStore.getState().assignCardToAgent(card.id, {
        leafId: 35,
        tabId: 2,
        agentName: "Gemini",
        startedAt: 5000,
        lastObservedStatus: "working",
      });

      handleAgentSignalForKanban(
        { id: 35, kind: "finished", agent: "gemini" },
        { playCompletionSound: false },
      );

      const updated = useKanbanStore.getState().cards.find((c) => c.id === card.id);
      expect(updated?.columnId).toBe("done");
      expect(mockPlaySound).not.toHaveBeenCalled();
    });

    it("marks card as errored on premature exited signal", () => {
      const card = useKanbanStore.getState().addCard({
        title: "Tarea abortada",
        description: "",
        columnId: "in_progress",
      });

      useKanbanStore.getState().assignCardToAgent(card.id, {
        leafId: 40,
        tabId: 1,
        agentName: "Pi",
        startedAt: 1000,
        lastObservedStatus: "working",
      });

      handleAgentSignalForKanban({
        id: 40,
        kind: "exited",
        agent: "pi",
      });

      const updated = useKanbanStore.getState().cards.find((c) => c.id === card.id);
      expect(updated?.columnId).toBe("in_progress");
      expect(updated?.assignedExecution?.lastObservedStatus).toBe("error");
      expect(updated?.assignedExecution?.errorReason).toBe(
        "Terminal o proceso cerrado antes de finalizar",
      );
    });
  });

  describe("syncKanbanWithAgentStore", () => {
    it("completes execution when leaf is in pulsingLeaves", () => {
      const card = useKanbanStore.getState().addCard({
        title: "Tarea pulsing",
        description: "",
        columnId: "in_progress",
      });

      useKanbanStore.getState().assignCardToAgent(card.id, {
        leafId: 50,
        tabId: 3,
        agentName: "Claude",
        startedAt: 1000,
        lastObservedStatus: "working",
      });

      syncKanbanWithAgentStore({
        sessions: {},
        pulsingLeaves: { 50: 3 },
      });

      const updated = useKanbanStore.getState().cards.find((c) => c.id === card.id);
      expect(updated?.columnId).toBe("done");
      expect(updated?.assignedExecution?.lastObservedStatus).toBe("idle");
      expect(mockPlaySound).toHaveBeenCalledOnce();
    });

    it("synchronizes session status transitions", () => {
      const card = useKanbanStore.getState().addCard({
        title: "Tarea sync",
        description: "",
        columnId: "in_progress",
      });

      useKanbanStore.getState().assignCardToAgent(card.id, {
        leafId: 60,
        tabId: 1,
        agentName: "Codex",
        startedAt: 1000,
        lastObservedStatus: "working",
      });

      const waitingSession: AgentSession = {
        leafId: 60,
        tabId: 1,
        agent: "codex",
        status: "waiting",
        startedAt: 1000,
        lastActivityAt: 2000,
        attentionSince: 2000,
      };

      syncKanbanWithAgentStore({
        sessions: { 60: waitingSession },
        pulsingLeaves: {},
      });

      const updated = useKanbanStore.getState().cards.find((c) => c.id === card.id);
      expect(updated?.assignedExecution?.lastObservedStatus).toBe("waiting");
      expect(updated?.assignedExecution?.requiresAttention).toBe(true);
    });
  });
});
