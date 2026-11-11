import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  openAgent,
  isModelForbidden,
  resolveAgentSupervised,
  parseAgentCopyName,
  resolveWorktreePath,
  MAX_TEAM_AGENTS,
} from "./agentLauncher";
import { clearLiveAgentRegistry, getLiveAgentBySessionId, listLiveAgents, registerLiveAgent } from "./agentRegistry";
import * as teamFs from "./teamFs";
import type { AgentRoster } from "@/modules/workspace-kit/lib/configTypes";
import type { TeamState } from "../types";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(true),
}));

describe("agentLauncher", () => {
  const dummyRoster: AgentRoster = {
    version: 1,
    policies: {
      forbiddenModels: ["claude-3-haiku", "forbidden-model"],
    },
    agents: [
      {
        name: "orchestrator",
        role: "roles/orchestrator.md",
        start: "always",
        runtime: { adapter: "claude-code", model: "claude-3-7-sonnet" },
        owns: [".voktty/"],
      },
      {
        name: "developer",
        role: "roles/developer.md",
        start: "on-demand",
        runtime: { adapter: "claude-code", model: "claude-3-7-sonnet" },
        owns: ["src/"],
      },
      {
        name: "bad-agent",
        role: "roles/developer.md",
        start: "on-demand",
        runtime: { adapter: "claude-code", model: "claude-3-haiku" },
      },
    ],
  };

  let mockState: TeamState;
  const mockDeps = {
    onNewHarnessTab: vi.fn().mockReturnValue(42),
    newSession: vi.fn().mockImplementation((harness, cwd, model) => ({
      id: `session_${Date.now()}_${Math.random()}`,
      harness,
      cwd,
      model,
      composerSeed: undefined,
    })),
    cacheSession: vi.fn(),
  };

  beforeEach(() => {
    clearLiveAgentRegistry();
    vi.clearAllMocks();

    mockState = {
      $schema: "urn:voktty:team-state:1",
      version: 1,
      updatedAt: "2026-11-10T20:00:00.000Z",
      agents: {},
    };

    vi.spyOn(teamFs, "readRoster").mockResolvedValue({ roster: dummyRoster });
    vi.spyOn(teamFs, "readRole").mockResolvedValue("# Developer Role\nRules and instructions.");
    vi.spyOn(teamFs, "readTeamState").mockImplementation(async () => mockState);
    vi.spyOn(teamFs, "writeTeamState").mockImplementation(async (_path, state) => {
      mockState = state;
    });
  });

  it("abrir de cero crea una pestaña con el rol inyectado y registra token", async () => {
    const result = await openAgent(
      {
        projectPath: "/repo",
        agentName: "developer",
        mode: "new",
        task: "Implement feature X",
      },
      mockDeps,
    );

    expect(result.ok).toBe(true);
    expect(result.mode).toBe("new");
    expect(result.agent).toBe("developer");
    expect(result.tabId).toBe(42);
    expect(result.sessionId).toBeTruthy();

    // Verify session had role injected into composerSeed
    expect(mockDeps.cacheSession).toHaveBeenCalledTimes(1);
    const cached = mockDeps.cacheSession.mock.calls[0][0];
    expect(cached.composerSeed).toContain("Role (roles/developer.md):");
    expect(cached.composerSeed).toContain("# Developer Role");
    expect(cached.composerSeed).toContain("Implement feature X");

    // Verify live agent registry contains ephemeral token
    const liveSession = getLiveAgentBySessionId(result.sessionId);
    expect(liveSession).toBeDefined();
    expect(liveSession?.agentToken).toHaveLength(32);
    expect(liveSession?.isOrchestrator).toBe(false);

    // Verify state was saved
    expect(mockState.agents.developer.sessionId).toBe(result.sessionId);
    expect(mockState.agents.developer.status).toBe("awaiting_owner");
    expect(mockState.agents.developer.supervised).toBe(true);
  });

  it("retomar continúa la misma sesión existente sin regenerar y registra token en control", async () => {
    mockState.agents.developer = {
      sessionId: "s_existing_dev",
      status: "idle",
      lastOpenedAt: "2026-11-10T19:00:00.000Z",
    };

    const result = await openAgent(
      {
        projectPath: "/repo",
        agentName: "developer",
        mode: "resume",
      },
      mockDeps,
    );

    expect(result.ok).toBe(true);
    expect(result.mode).toBe("resume");
    expect(result.sessionId).toBe("s_existing_dev");
    expect(mockDeps.newSession).not.toHaveBeenCalled();
    expect(mockDeps.onNewHarnessTab).toHaveBeenCalledWith(undefined, "/repo", "s_existing_dev");

    // B2: resumed agent MUST have its token registered
    const liveSession = getLiveAgentBySessionId("s_existing_dev");
    expect(liveSession).toBeDefined();
    expect(liveSession?.agentToken).toHaveLength(32);
  });

  it("un modelo prohibido no se abre y devuelve la razón", async () => {
    expect(isModelForbidden("claude-3-haiku", dummyRoster)).toBe(true);
    expect(isModelForbidden("claude-3-7-sonnet", dummyRoster)).toBe(false);

    // Opening bad-agent whose configured model is claude-3-haiku
    const result = await openAgent(
      {
        projectPath: "/repo",
        agentName: "bad-agent",
        mode: "new",
      },
      mockDeps,
    );

    expect(result.ok).toBe(false);
    expect(result.error).toBe("forbidden_model");
    expect(result.reason).toContain("claude-3-haiku");
    expect(mockDeps.newSession).not.toHaveBeenCalled();
  });

  it("un override puntual con modelo prohibido es rechazado", async () => {
    const result = await openAgent(
      {
        projectPath: "/repo",
        agentName: "developer",
        model: "forbidden-model",
        mode: "new",
      },
      mockDeps,
    );

    expect(result.ok).toBe(false);
    expect(result.error).toBe("forbidden_model");
    expect(result.reason).toContain("forbidden-model");
  });

  it("respeta el tope de 6 agentes simultáneos por equipo", async () => {
    // Register 6 dummy live agents
    for (let i = 1; i <= MAX_TEAM_AGENTS; i++) {
      registerLiveAgent({
        sessionId: `s_live_${i}`,
        agentName: `agent_${i}`,
        projectPath: "/repo",
        role: "roles/developer.md",
        isOrchestrator: false,
        permissions: { canManageAgents: false },
        launchedAt: new Date().toISOString(),
        agentToken: `token_${i}`,
      });
    }

    expect(listLiveAgents("/repo")).toHaveLength(6);

    const result = await openAgent(
      {
        projectPath: "/repo",
        agentName: "developer",
        mode: "new",
      },
      mockDeps,
    );

    expect(result.ok).toBe(false);
    expect(result.error).toBe("capacity_exceeded");
    expect(result.reason).toContain("maximum of 6 concurrent agents");
  });

  it("supervised solo puede endurecer el roster, nunca relajarlo (B7)", () => {
    // 1. Roster without explicit supervised defaults to true: requesting false remains true
    expect(
      resolveAgentSupervised(dummyRoster.agents[0], dummyRoster, false),
    ).toBe(true);
    expect(
      resolveAgentSupervised(dummyRoster.agents[0], dummyRoster, true),
    ).toBe(true);
    expect(
      resolveAgentSupervised(dummyRoster.agents[0], dummyRoster, undefined),
    ).toBe(true);

    // 2. Roster with supervised: false: requesting false gives false; requesting true hardens to true
    const autoAgent = {
      ...dummyRoster.agents[1],
      supervised: false,
    };
    expect(resolveAgentSupervised(autoAgent as any, dummyRoster, false)).toBe(
      false,
    );
    expect(resolveAgentSupervised(autoAgent as any, dummyRoster, undefined)).toBe(
      false,
    );
    expect(resolveAgentSupervised(autoAgent as any, dummyRoster, true)).toBe(
      true,
    );
  });

  it("B7: passes runtimeMode explicitly to newSession", async () => {
    await openAgent(
      {
        projectPath: "/repo",
        agentName: "developer",
        mode: "new",
        supervised: true,
      },
      mockDeps,
    );

    expect(mockDeps.newSession).toHaveBeenCalledWith(
      "claude",
      "/repo",
      "claude-3-7-sonnet",
      "supervised",
    );
  });

  it("N1: fails with request_failed when onNewHarnessTab is missing or invalid", async () => {
    const resultWithoutOpener = await openAgent(
      {
        projectPath: "/repo",
        agentName: "developer",
        mode: "new",
      },
      {
        ...mockDeps,
        onNewHarnessTab: undefined,
      },
    );

    expect(resultWithoutOpener.ok).toBe(false);
    expect(resultWithoutOpener.error).toBe("request_failed");
    expect(resultWithoutOpener.reason).toContain("No harness tab opener is available");

    const resultWithFailingOpener = await openAgent(
      {
        projectPath: "/repo",
        agentName: "developer",
        mode: "new",
      },
      {
        ...mockDeps,
        onNewHarnessTab: () => undefined as any,
      },
    );

    expect(resultWithFailingOpener.ok).toBe(false);
    expect(resultWithFailingOpener.error).toBe("request_failed");
    expect(resultWithFailingOpener.reason).toContain("Harness tab opener failed to create a tab");
  });

  it("R2: fails with request_failed and does not open tab if native token registration is rejected", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockResolvedValueOnce(false);

    const result = await openAgent(
      {
        projectPath: "/repo",
        agentName: "developer",
        mode: "new",
        task: "Implement feature X",
      },
      mockDeps,
    );

    expect(result.ok).toBe(false);
    expect(result.error).toBe("request_failed");
    expect(result.reason).toContain("Failed to register agent token");
    expect(mockDeps.onNewHarnessTab).not.toHaveBeenCalled();

    // Registry must have cleaned up the session
    expect(getLiveAgentBySessionId(result.sessionId)).toBeUndefined();
    expect(listLiveAgents("/repo")).toHaveLength(0);
  });

  it("R2: fails resume with request_failed and does not open tab if native token registration is rejected", async () => {
    mockState.agents.developer = {
      sessionId: "s_existing_dev",
      status: "idle",
    };

    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockResolvedValueOnce(false);

    const result = await openAgent(
      {
        projectPath: "/repo",
        agentName: "developer",
        mode: "resume",
      },
      mockDeps,
    );

    expect(result.ok).toBe(false);
    expect(result.error).toBe("request_failed");
    expect(result.reason).toContain("Failed to register agent token");
    expect(mockDeps.onNewHarnessTab).not.toHaveBeenCalled();

    // Session token must not remain in registry
    expect(getLiveAgentBySessionId("s_existing_dev")).toBeUndefined();
  });

  describe("E4: copies, worktrees, duplicates, and awaiting_owner", () => {
    it("parseAgentCopyName decomposes copy names correctly", () => {
      expect(parseAgentCopyName("nodo-2")).toEqual({
        baseName: "nodo",
        copyNumber: 2,
      });
      expect(parseAgentCopyName("developer-10")).toEqual({
        baseName: "developer",
        copyNumber: 10,
      });
      expect(parseAgentCopyName("nodo")).toEqual({
        baseName: "nodo",
        copyNumber: undefined,
      });
      expect(parseAgentCopyName("nodo-abc")).toEqual({
        baseName: "nodo-abc",
        copyNumber: undefined,
      });
    });

    it("resolveWorktreePath places worktrees outside repository and outside .voktty/", () => {
      const p = resolveWorktreePath("/home/user/myproject", "nodo-2");
      expect(p).toBe("/home/user/myproject-worktrees/nodo-2");
      expect(p).not.toContain("/home/user/myproject/");
      expect(p).not.toContain(".voktty");
    });

    it("launching copy nodo-2 creates separate worktree and records worktree in state", async () => {
      const result = await openAgent(
        {
          projectPath: "/repo/myproject",
          agentName: "developer-2",
          mode: "new",
          task: "Worker copy task",
        },
        mockDeps,
      );

      expect(result.ok).toBe(true);
      expect(result.agent).toBe("developer-2");

      const expectedWorktree = resolveWorktreePath(
        "/repo/myproject",
        "developer-2",
      );
      expect(mockState.agents["developer-2"]).toBeDefined();
      expect(mockState.agents["developer-2"].worktree).toBe(expectedWorktree);
      expect(mockDeps.onNewHarnessTab).toHaveBeenCalledWith(
        undefined,
        expectedWorktree,
        result.sessionId,
      );
    });

    it("resuming copy by name reuses its recorded worktree and session", async () => {
      const copyWorktree = resolveWorktreePath("/repo/myproject", "developer-2");
      mockState.agents["developer-2"] = {
        sessionId: "s_dev2_existing",
        status: "idle",
        worktree: copyWorktree,
      };

      const result = await openAgent(
        {
          projectPath: "/repo/myproject",
          agentName: "developer-2",
          mode: "resume",
          task: "Resume task",
        },
        mockDeps,
      );

      expect(result.ok).toBe(true);
      expect(result.agent).toBe("developer-2");
      expect(result.mode).toBe("resume");
      expect(result.sessionId).toBe("s_dev2_existing");
      expect(mockDeps.onNewHarnessTab).toHaveBeenCalledWith(
        undefined,
        copyWorktree,
        "s_dev2_existing",
      );
      expect(mockState.agents["developer-2"].worktree).toBe(copyWorktree);
    });

    it("duplicate session guard rejects mode 'new' when agent is already live and active", async () => {
      // Register an active live session for 'developer'
      await registerLiveAgent({
        sessionId: "s_already_running",
        agentName: "developer",
        projectPath: "/repo",
        role: "roles/developer.md",
        isOrchestrator: false,
        permissions: { canManageAgents: false },
        launchedAt: new Date().toISOString(),
        agentToken: "tok_running",
      });

      const result = await openAgent(
        {
          projectPath: "/repo",
          agentName: "developer",
          mode: "new",
        },
        mockDeps,
      );

      expect(result.ok).toBe(false);
      expect(result.error).toBe("duplicate_session");
      expect(result.reason).toContain("already has an active running session");
      expect(result.sessionId).toBe("s_already_running");
    });

    it("supervised agent starts with status awaiting_owner and composerSeed set", async () => {
      const result = await openAgent(
        {
          projectPath: "/repo",
          agentName: "developer",
          mode: "new",
          supervised: true,
          task: "Supervised task awaiting confirmation",
        },
        mockDeps,
      );

      expect(result.ok).toBe(true);
      expect(result.supervised).toBe(true);
      expect(mockState.agents.developer.status).toBe("awaiting_owner");
      const cached = mockDeps.cacheSession.mock.calls[0][0];
      expect(cached.composerSeed).toContain("Supervised task awaiting confirmation");
    });

    it("unsupervised agent starts with status working and sends message automatically", async () => {
      const sendMock = vi.fn().mockResolvedValue(true);
      const automaticRoster: AgentRoster = {
        version: 1,
        agents: [
          {
            name: "auto-worker",
            role: "roles/developer.md",
            start: "on-demand",
            ...({ supervised: false } as Record<string, unknown>),
          } as AgentRoster["agents"][number],
        ],
      };
      vi.spyOn(teamFs, "readRoster").mockResolvedValue({ roster: automaticRoster });

      const result = await openAgent(
        {
          projectPath: "/repo",
          agentName: "auto-worker",
          mode: "new",
          supervised: false,
          task: "Autonomous immediate task",
        },
        {
          ...mockDeps,
          sendSessionMessage: sendMock,
        },
      );

      expect(result.ok).toBe(true);
      expect(result.supervised).toBe(false);
      expect(mockState.agents["auto-worker"].status).toBe("working");
      expect(sendMock).toHaveBeenCalledTimes(1);
      expect(sendMock.mock.calls[0][1]).toContain("Autonomous immediate task");
    });

    it("I1: unsupervised agent degrades to awaiting_owner with composerSeed if sendSessionMessage fails", async () => {
      const sendMock = vi.fn().mockResolvedValue(false); // send failed
      const automaticRoster: AgentRoster = {
        version: 1,
        agents: [
          {
            name: "auto-worker",
            role: "roles/developer.md",
            start: "on-demand",
            ...({ supervised: false } as Record<string, unknown>),
          } as AgentRoster["agents"][number],
        ],
      };
      vi.spyOn(teamFs, "readRoster").mockResolvedValue({ roster: automaticRoster });

      const result = await openAgent(
        {
          projectPath: "/repo",
          agentName: "auto-worker",
          mode: "new",
          supervised: false,
          task: "Autonomous task that fails to send",
        },
        {
          ...mockDeps,
          sendSessionMessage: sendMock,
        },
      );

      expect(result.ok).toBe(true);
      expect(result.supervised).toBe(false);
      // Status must be degraded to awaiting_owner
      expect(mockState.agents["auto-worker"].status).toBe("awaiting_owner");
      // Session must have composerSeed set
      const lastCached =
        mockDeps.cacheSession.mock.calls[mockDeps.cacheSession.mock.calls.length - 1][0];
      expect(lastCached.composerSeed).toContain("Autonomous task that fails to send");
    });

    it("I2: exact name takes precedence over copy pattern (exact 'web-2' in roster)", async () => {
      const rosterWithExactCopyName: AgentRoster = {
        version: 1,
        agents: [
          {
            name: "web",
            role: "roles/web.md",
            start: "on-demand",
          },
          {
            name: "web-2",
            role: "roles/web-custom.md",
            start: "on-demand",
          },
        ],
      };
      vi.spyOn(teamFs, "readRoster").mockResolvedValue({ roster: rosterWithExactCopyName });

      const result = await openAgent(
        {
          projectPath: "/repo",
          agentName: "web-2",
          mode: "new",
        },
        mockDeps,
      );

      expect(result.ok).toBe(true);
      expect(result.agent).toBe("web-2");
      // Should NOT be treated as a copy: no worktree allocated
      expect(mockState.agents["web-2"].worktree).toBeNull();
    });

    it("I2: rejects copy numbers outside 2..MAX_TEAM_AGENTS (e.g. developer-1 and developer-7)", async () => {
      const res1 = await openAgent(
        {
          projectPath: "/repo",
          agentName: "developer-1",
          mode: "new",
        },
        mockDeps,
      );
      expect(res1.ok).toBe(false);
      expect(res1.error).toBe("invalid_params");
      expect(res1.reason).toContain("Copy number must be between 2 and 6");

      const res7 = await openAgent(
        {
          projectPath: "/repo",
          agentName: "developer-7",
          mode: "new",
        },
        mockDeps,
      );
      expect(res7.ok).toBe(false);
      expect(res7.error).toBe("invalid_params");
      expect(res7.reason).toContain("Copy number must be between 2 and 6");
    });

    it("I3: forbids copies of orchestrator with explicit error", async () => {
      const result = await openAgent(
        {
          projectPath: "/repo",
          agentName: "orchestrator-2",
          mode: "new",
        },
        mockDeps,
      );

      expect(result.ok).toBe(false);
      expect(result.error).toBe("invalid_params");
      expect(result.reason).toBe("Copies of the orchestrator agent are forbidden");
    });

    it("I5: resume rejects if saved worktree in state does not match canonical resolveWorktreePath", async () => {
      const canonicalWorktree = resolveWorktreePath("/repo", "developer-2");
      const tamperedWorktree = "/tampered/evil/path";

      mockState.agents["developer-2"] = {
        sessionId: "s_dev2",
        status: "idle",
        task: "previous task",
        lastOpenedAt: new Date().toISOString(),
        supervised: true,
        worktree: tamperedWorktree,
      };

      const result = await openAgent(
        {
          projectPath: "/repo",
          agentName: "developer-2",
          mode: "resume",
        },
        mockDeps,
      );

      expect(result.ok).toBe(false);
      expect(result.error).toBe("invalid_params");
      expect(result.reason).toContain("does not match canonical worktree path");
      expect(result.reason).toContain(canonicalWorktree);
    });
  });
});
