import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  openAgent,
  isModelForbidden,
  resolveAgentSupervised,
  MAX_TEAM_AGENTS,
} from "./agentLauncher";
import { clearLiveAgentRegistry, getLiveAgentBySessionId, listLiveAgents, registerLiveAgent } from "./agentRegistry";
import * as teamFs from "./teamFs";
import type { AgentRoster } from "@/modules/workspace-kit/lib/configTypes";
import type { TeamState } from "../types";

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
    expect(mockState.agents.developer.status).toBe("working");
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
});
