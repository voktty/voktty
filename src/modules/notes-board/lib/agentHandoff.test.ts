import { describe, expect, it } from "vitest";
import {
  formatExecutionDuration,
  formatTaskForAgent,
  resolveActiveAgentTargets,
} from "./agentHandoff";
import type { AgentSession } from "@/modules/agents/lib/types";

describe("agentHandoff", () => {
  describe("formatTaskForAgent", () => {
    it("formats card with title and description", () => {
      const prompt = formatTaskForAgent({
        title: "Implementar autenticacion",
        description: "- [ ] Crear endpoints\n- [ ] Agregar tests",
      });

      expect(prompt).toBe(
        "Task: Implementar autenticacion\n\nDetails:\n- [ ] Crear endpoints\n- [ ] Agregar tests",
      );
    });

    it("formats card with only title if description is empty or whitespace", () => {
      const prompt = formatTaskForAgent({
        title: "Tarea simple",
        description: "   ",
      });

      expect(prompt).toBe("Task: Tarea simple");
    });
  });

  describe("resolveActiveAgentTargets", () => {
    it("resolves active agent sessions with formatted display names and tab titles", () => {
      const sessions: Record<number, AgentSession> = {
        101: {
          leafId: 101,
          tabId: 1,
          agent: "claude",
          status: "working",
          startedAt: 1000,
          lastActivityAt: 1000,
          attentionSince: null,
        },
        102: {
          leafId: 102,
          tabId: 2,
          agent: "codex",
          status: "waiting",
          startedAt: 2000,
          lastActivityAt: 2500,
          attentionSince: 2500,
        },
      };

      const tabs = [
        { id: 1, title: "Backend API", kind: "terminal", activeLeafId: 101 },
        { id: 2, title: "Frontend UI", kind: "terminal", activeLeafId: 102 },
        { id: 3, title: "Scratch", kind: "terminal", activeLeafId: 103 },
      ];

      const targets = resolveActiveAgentTargets(sessions, tabs);

      expect(targets).toHaveLength(3);
      expect(targets[0]).toEqual({
        leafId: 101,
        tabId: 1,
        agent: "claude",
        displayName: "Claude Code",
        tabTitle: "Backend API",
        status: "working",
      });
      expect(targets[1]).toEqual({
        leafId: 102,
        tabId: 2,
        agent: "codex",
        displayName: "Codex",
        tabTitle: "Frontend UI",
        status: "waiting",
      });
      expect(targets[2]).toEqual({
        leafId: 103,
        tabId: 3,
        agent: "terminal",
        displayName: "Terminal",
        tabTitle: "Scratch",
        status: "idle",
      });
    });

    it("handles sessions without tabs gracefully", () => {
      const sessions: Record<number, AgentSession> = {
        50: {
          leafId: 50,
          tabId: 5,
          agent: "gemini",
          status: "working",
          startedAt: 1000,
          lastActivityAt: 1000,
          attentionSince: null,
        },
      };

      const targets = resolveActiveAgentTargets(sessions, []);
      expect(targets).toHaveLength(1);
      expect(targets[0].tabTitle).toBe("Tab 5");
      expect(targets[0].displayName).toBe("Gemini");
    });
  });

  describe("formatExecutionDuration", () => {
    it("formats durations accurately for various ranges", () => {
      expect(formatExecutionDuration(0)).toBe("<1s");
      expect(formatExecutionDuration(500)).toBe("<1s");
      expect(formatExecutionDuration(1200)).toBe("1s");
      expect(formatExecutionDuration(45000)).toBe("45s");
      expect(formatExecutionDuration(60000)).toBe("1m");
      expect(formatExecutionDuration(135000)).toBe("2m 15s");
      expect(formatExecutionDuration(3600000)).toBe("1h");
      expect(formatExecutionDuration(3900000)).toBe("1h 5m");
    });
  });
});

