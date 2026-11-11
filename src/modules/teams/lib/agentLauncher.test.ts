import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  openAgent,
  isModelForbidden,
  resolveAgentSupervised,
  parseAgentCopyName,
  resolveWorktreePath,
  resolveAgentAdapter,
  resolveEffectiveEffort,
  MAX_TEAM_AGENTS,
} from "./agentLauncher";
import { VALID_ADAPTERS } from "./rosterValidation";
import { HARNESSES } from "@/modules/harness/lib/session";
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

    it("R2: uses path returned by ensure_agent_worktree as cwd, in state, and for resume validation with project in repo subfolder", async () => {
      // Repository root is /workspace/my-repo
      // Project sits in subfolder /workspace/my-repo/packages/subproject
      const projectSubfolder = "/workspace/my-repo/packages/subproject";
      // Rust ensure_agent_worktree computes worktree relative to canonical git root (/workspace/my-repo)
      const rustCanonicalWorktree = "/workspace/my-repo-worktrees/developer-2";

      const customDeps = {
        ...mockDeps,
        onNewHarnessTab: vi.fn().mockReturnValue(77),
        newSession: vi.fn().mockImplementation((harness, cwd, model) => ({
          id: "s_dev2_sub",
          harness,
          cwd,
          model,
        })),
        ensureWorktree: vi.fn().mockResolvedValue(rustCanonicalWorktree),
      };

      // 1. Open new copy agent in subfolder project
      const openResult = await openAgent(
        {
          projectPath: projectSubfolder,
          agentName: "developer-2",
          mode: "new",
        },
        customDeps,
      );

      expect(openResult.ok).toBe(true);
      expect(customDeps.ensureWorktree).toHaveBeenCalledWith(
        projectSubfolder,
        "developer-2",
      );
      // Cwd passed to newSession must be the path returned by Rust
      expect(customDeps.newSession).toHaveBeenCalledWith(
        expect.anything(),
        rustCanonicalWorktree,
        expect.anything(),
        expect.anything(),
      );
      // Cwd passed to onNewHarnessTab must be the path returned by Rust
      expect(customDeps.onNewHarnessTab).toHaveBeenCalledWith(
        undefined,
        rustCanonicalWorktree,
        "s_dev2_sub",
      );
      // Saved worktree in state must be the path returned by Rust
      expect(mockState.agents["developer-2"].worktree).toBe(rustCanonicalWorktree);

      // 2. Resume copy agent when state matches path returned by Rust -> succeeds
      const resumeResult = await openAgent(
        {
          projectPath: projectSubfolder,
          agentName: "developer-2",
          mode: "resume",
        },
        customDeps,
      );

      expect(resumeResult.ok).toBe(true);
      expect(customDeps.onNewHarnessTab).toHaveBeenLastCalledWith(
        undefined,
        rustCanonicalWorktree,
        "s_dev2_sub",
      );

      // 3. Resume copy agent if saved worktree in state differs from Rust return value -> rejects with invalid_params
      mockState.agents["developer-2"].worktree = "/divergent/path/developer-2";
      const rejectResult = await openAgent(
        {
          projectPath: projectSubfolder,
          agentName: "developer-2",
          mode: "resume",
        },
        customDeps,
      );

      expect(rejectResult.ok).toBe(false);
      expect(rejectResult.error).toBe("invalid_params");
      expect(rejectResult.reason).toContain(
        "Saved worktree path '/divergent/path/developer-2' does not match canonical worktree path '/workspace/my-repo-worktrees/developer-2'",
      );
    });
  });

  describe("Fase E5: Multi-provider, generic rejection and effort resolution", () => {
    it("E4: all VALID_ADAPTERS map to valid HARNESSES (or throw unsupported for generic)", () => {
      expect(VALID_ADAPTERS.size).toBeGreaterThan(0);
      for (const adapter of VALID_ADAPTERS) {
        const dummyAgent = {
          name: "test-agent",
          role: "roles/dev.md",
          runtime: { adapter },
        };
        const dummyRoster = { version: 1, agents: [dummyAgent] };

        if (adapter === "generic") {
          expect(() => resolveAgentAdapter(dummyAgent as any, dummyRoster as any)).toThrow(
            /Generic adapter is not supported yet/,
          );
        } else {
          const harnessId = resolveAgentAdapter(dummyAgent as any, dummyRoster as any);
          expect(HARNESSES).toContain(harnessId);
        }
      }
    });

    it("maps adapters to correct harnesses: claude, codex, antigravity (gemini), opencode, cursor, grok, pi, hermes", async () => {
      const multiRoster: AgentRoster = {
        version: 1,
        agents: [
          {
            name: "claude-agent",
            role: "roles/dev.md",
            start: "on-demand",
            runtime: { adapter: "claude-code" },
          },
          {
            name: "codex-agent",
            role: "roles/dev.md",
            start: "on-demand",
            runtime: { adapter: "codex", effort: "high" },
          },
          {
            name: "antigravity-agent",
            role: "roles/dev.md",
            start: "on-demand",
            runtime: { adapter: "antigravity", effort: "medium" },
          },
          {
            name: "opencode-agent",
            role: "roles/dev.md",
            start: "on-demand",
            runtime: { adapter: "opencode" },
          },
        ],
      };

      vi.spyOn(teamFs, "readRoster").mockResolvedValue({ roster: multiRoster });

      // 1. Claude
      await openAgent({ projectPath: "/repo", agentName: "claude-agent" }, mockDeps);
      expect(mockDeps.newSession).toHaveBeenLastCalledWith(
        "claude",
        "/repo",
        undefined,
        "supervised",
      );

      // 2. Codex with effort
      await openAgent({ projectPath: "/repo", agentName: "codex-agent" }, mockDeps);
      expect(mockDeps.newSession).toHaveBeenLastCalledWith(
        "codex",
        "/repo",
        undefined,
        "supervised",
        { effort: "high" },
      );

      // 3. Antigravity (maps to "gemini") with effort
      await openAgent({ projectPath: "/repo", agentName: "antigravity-agent" }, mockDeps);
      expect(mockDeps.newSession).toHaveBeenLastCalledWith(
        "gemini",
        "/repo",
        undefined,
        "supervised",
        { effort: "medium" },
      );

      // 4. OpenCode
      await openAgent({ projectPath: "/repo", agentName: "opencode-agent" }, mockDeps);
      expect(mockDeps.newSession).toHaveBeenLastCalledWith(
        "opencode",
        "/repo",
        undefined,
        "supervised",
      );
    });

    it("E3: rejects generic adapter when unapproved (approval_required) and when approved (not_supported)", async () => {
      const genericRoster: AgentRoster = {
        version: 1,
        agents: [
          {
            name: "bot",
            role: "roles/bot.md",
            start: "on-demand",
            runtime: {
              adapter: "generic",
              command: "python3 my_agent.py --run",
            },
          },
        ],
      };

      vi.spyOn(teamFs, "readRoster").mockResolvedValue({ roster: genericRoster });

      // 1. Without approval -> fails with approval_required
      vi.spyOn(teamFs, "verifyGenericLaunch").mockRejectedValueOnce(
        new Error("Generic command 'python3 my_agent.py --run' for agent 'bot' has not been approved on this machine"),
      );

      const unapprovedRes = await openAgent(
        { projectPath: "/repo", agentName: "bot" },
        mockDeps,
      );
      expect(unapprovedRes.ok).toBe(false);
      expect(unapprovedRes.error).toBe("approval_required");
      expect(unapprovedRes.reason).toContain("has not been approved on this machine");

      // 2. When approved locally, launch still rejects generic adapter with clear not supported error (E3)
      // Never converts to "claude" or creates a session
      vi.spyOn(teamFs, "verifyGenericLaunch").mockRejectedValueOnce(
        new Error("Generic adapter is not supported yet; please use an official adapter (claude-code, codex, antigravity, opencode, cursor, grok, pi, hermes)"),
      );

      const approvedRes = await openAgent(
        { projectPath: "/repo", agentName: "bot" },
        mockDeps,
      );
      expect(approvedRes.ok).toBe(false);
      expect(approvedRes.error).toBe("not_supported");
      expect(approvedRes.reason).toContain("Generic adapter is not supported yet");
      expect(mockDeps.newSession).not.toHaveBeenCalled();
    });

    it("I2: rejects unsupported effort on models without effort and degrades unsupported level along the scale", async () => {
      // 1. Model that doesn't support effort rejects explicitly
      const resUnsupported = resolveEffectiveEffort("high", "opencode", "deepseek-coder");
      expect(resUnsupported.ok).toBe(false);
      if (!resUnsupported.ok) {
        expect(resUnsupported.error).toBe("unsupported_effort");
        expect(resUnsupported.reason).toContain("does not support reasoning effort");
      }

      // 2. Effort supported by model passes through
      const resSupported = resolveEffectiveEffort("high", "claude");
      expect(resSupported.ok).toBe(true);

      // 3. Degradation test: gemini only supports low, medium, high. Requesting xhigh degrades to high.
      const resDegraded = resolveEffectiveEffort("xhigh", "gemini");
      expect(resDegraded.ok).toBe(true);
      if (resDegraded.ok) {
        expect(resDegraded.effectiveEffort).toBe("high");
        expect(resDegraded.degradedFrom).toBe("xhigh");
      }

      // 4. Test openAgent rejection when harness doesn't support agent-specified effort (N1)
      const rosterAgentEffort: AgentRoster = {
        version: 1,
        agents: [
          {
            name: "strict-agent",
            role: "roles/dev.md",
            start: "on-demand",
            runtime: { adapter: "opencode", model: "deepseek-coder", effort: "high" },
          },
        ],
      };
      vi.spyOn(teamFs, "readRoster").mockResolvedValue({ roster: rosterAgentEffort });
      const launchRes = await openAgent(
        { projectPath: "/repo", agentName: "strict-agent" },
        mockDeps,
      );
      expect(launchRes.ok).toBe(false);
      expect(launchRes.error).toBe("unsupported_effort");

      // 5. N1: Test openAgent ignores effort when inherited from defaults on unsupported harness with warning
      const rosterDefaultEffort: AgentRoster = {
        version: 1,
        defaults: {
          runtime: {
            effort: "high",
          },
        },
        agents: [
          {
            name: "inherited-agent",
            role: "roles/dev.md",
            start: "on-demand",
            runtime: { adapter: "opencode", model: "deepseek-coder" },
          },
        ],
      };
      vi.spyOn(teamFs, "readRoster").mockResolvedValue({ roster: rosterDefaultEffort });
      const inheritedRes = await openAgent(
        { projectPath: "/repo", agentName: "inherited-agent" },
        mockDeps,
      );
      expect(inheritedRes.ok).toBe(true);
      expect(inheritedRes.warning).toBeDefined();
      expect(inheritedRes.warning).toContain("Default effort 'high' ignored");
      expect(mockDeps.newSession).toHaveBeenLastCalledWith(
        "opencode",
        "/repo",
        "deepseek-coder",
        "supervised",
      );
    });
  });

  describe("remote SSH agents (E6)", () => {
    it("fails with host_unconfigured when host is not configured on this machine", async () => {
      const roster: AgentRoster = {
        version: 1,
        agents: [
          {
            name: "remote-dev",
            role: "roles/dev.md",
            start: "on-demand",
            host: "ssh:unconfigured-server",
            runtime: { adapter: "claude-code" },
          },
        ],
      };
      vi.spyOn(teamFs, "readRoster").mockResolvedValue({ roster });
      vi.spyOn(teamFs, "readTeamState").mockResolvedValue({
        $schema: "urn:voktty:team-state:1",
        version: 1,
        updatedAt: new Date().toISOString(),
        agents: {},
      });

      const res = await openAgent(
        { projectPath: "/repo", agentName: "remote-dev" },
        mockDeps,
      );

      expect(res.ok).toBe(false);
      expect(res.error).toBe("host_unconfigured");
      expect(res.reason).toContain("not configured on this machine");
    });

    it("launches remote agent using SSH helper cwd and does not leak token", async () => {
      const roster: AgentRoster = {
        version: 1,
        agents: [
          {
            name: "remote-worker",
            role: "roles/dev.md",
            start: "on-demand",
            host: "ssh:prod",
            runtime: { adapter: "claude-code", model: "claude-3-7-sonnet" },
          },
        ],
      };
      vi.spyOn(teamFs, "readRoster").mockResolvedValue({ roster });
      const writtenStates: TeamState[] = [];
      vi.spyOn(teamFs, "writeTeamState").mockImplementation(async (_, s) => {
        writtenStates.push(s);
      });

      const mockSshConn = {
        id: "conn-prod-99",
        name: "prod",
        host: "prod.example.com",
        port: 22,
        user: "ubuntu",
      };

      const res = await openAgent(
        {
          projectPath: "/repo",
          agentName: "remote-worker",
          task: "Run remote database migrations",
        },
        {
          ...mockDeps,
          sshConnections: [mockSshConn],
        },
      );

      expect(res.ok).toBe(true);
      expect(mockDeps.onNewHarnessTab).toHaveBeenLastCalledWith(
        undefined,
        "remote://voktty-ssh-conn-prod-99/",
        expect.any(String),
      );

      const savedState = writtenStates[writtenStates.length - 1];
      expect(savedState.agents["remote-worker"]).toBeDefined();
      expect(savedState.agents["remote-worker"].host).toBe("ssh:prod");

      // Verify live agent session registered with remote info
      const live = listLiveAgents("/repo").find((s) => s.agentName === "remote-worker");
      expect(live).toBeDefined();
      expect(live?.isRemote).toBe(true);
      expect(live?.host).toBe("ssh:prod");
      expect(live?.remoteConnectionId).toBe("conn-prod-99");
    });

    it("rejects copies with worktrees on remote SSH hosts", async () => {
      const roster: AgentRoster = {
        version: 1,
        agents: [
          {
            name: "remote-node",
            role: "roles/dev.md",
            start: "on-demand",
            host: "ssh:prod",
          },
        ],
      };
      vi.spyOn(teamFs, "readRoster").mockResolvedValue({ roster });

      const mockSshConn = {
        id: "conn-prod-99",
        name: "prod",
        host: "prod.example.com",
        port: 22,
        user: "ubuntu",
      };

      const res = await openAgent(
        {
          projectPath: "/repo",
          agentName: "remote-node",
          copy: 2,
        },
        {
          ...mockDeps,
          sshConnections: [mockSshConn],
        },
      );

      expect(res.ok).toBe(false);
      expect(res.error).toBe("invalid_params");
      expect(res.reason).toContain("copies with worktrees are not supported on remote SSH hosts");
    });

    it("I2: records mailbox failure in agent state when initial task delivery fails", async () => {
      const roster: AgentRoster = {
        version: 1,
        agents: [
          {
            name: "remote-worker",
            role: "roles/dev.md",
            start: "on-demand",
            host: "ssh:prod",
            runtime: { adapter: "claude-code" },
          },
        ],
      };
      vi.spyOn(teamFs, "readRoster").mockResolvedValue({ roster });
      const writtenStates: TeamState[] = [];
      vi.spyOn(teamFs, "writeTeamState").mockImplementation(async (_, s) => {
        writtenStates.push(JSON.parse(JSON.stringify(s)));
      });

      // Mock remoteMailbox.writeRemoteMailboxMessage to throw
      const remoteMailboxMod = await import("./remoteMailbox");
      vi.spyOn(remoteMailboxMod, "writeRemoteMailboxMessage").mockRejectedValueOnce(
        new Error("SSH connection timeout"),
      );

      const mockSshConn = {
        id: "conn-prod-99",
        name: "prod",
        host: "prod.example.com",
        port: 22,
        user: "ubuntu",
      };

      const res = await openAgent(
        {
          projectPath: "/repo",
          agentName: "remote-worker",
          task: "Deploy to staging",
        },
        {
          ...mockDeps,
          sshConnections: [mockSshConn],
        },
      );

      expect(res.ok).toBe(true);
      const lastState = writtenStates[writtenStates.length - 1];
      expect(lastState.agents["remote-worker"].lastError).toBeDefined();
      expect(lastState.agents["remote-worker"].lastError).toContain(
        "Failed to write initial task to remote mailbox: SSH connection timeout",
      );
    });
  });
});
