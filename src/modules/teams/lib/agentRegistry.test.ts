import { describe, expect, it, beforeEach } from "vitest";
import {
  clearLiveAgentRegistry,
  generateAgentToken,
  getLiveAgentBySessionId,
  getLiveAgentByToken,
  listLiveAgents,
  registerLiveAgent,
  removeLiveAgent,
} from "./agentRegistry";
import type { LiveAgentSession } from "../types";

describe("agentRegistry", () => {
  beforeEach(() => {
    clearLiveAgentRegistry();
  });

  it("generates a 128-bit hex token (32 hex characters)", () => {
    const token1 = generateAgentToken();
    const token2 = generateAgentToken();
    expect(token1).toHaveLength(32);
    expect(token2).toHaveLength(32);
    expect(token1).toMatch(/^[0-9a-f]{32}$/);
    expect(token1).not.toBe(token2);
  });

  it("registers and retrieves live agent by sessionId and token", () => {
    const token = generateAgentToken();
    const session: LiveAgentSession = {
      sessionId: "s_123",
      agentName: "developer",
      projectPath: "/repo",
      role: "roles/developer.md",
      isOrchestrator: false,
      permissions: { canManageAgents: false },
      launchedAt: "2026-11-10T20:00:00.000Z",
      agentToken: token,
    };

    registerLiveAgent(session);

    expect(getLiveAgentBySessionId("s_123")).toEqual(session);
    expect(getLiveAgentByToken(token)).toEqual(session);
    expect(getLiveAgentBySessionId("unknown")).toBeUndefined();
    expect(getLiveAgentByToken("unknown")).toBeUndefined();
  });

  it("filters live agents by project path", () => {
    const sessionA: LiveAgentSession = {
      sessionId: "s_1",
      agentName: "orchestrator",
      projectPath: "/projectA",
      role: "roles/orchestrator.md",
      isOrchestrator: true,
      permissions: { canManageAgents: true },
      launchedAt: "2026-11-10T20:00:00.000Z",
      agentToken: generateAgentToken(),
    };
    const sessionB: LiveAgentSession = {
      sessionId: "s_2",
      agentName: "developer",
      projectPath: "/projectB",
      role: "roles/developer.md",
      isOrchestrator: false,
      permissions: { canManageAgents: false },
      launchedAt: "2026-11-10T20:01:00.000Z",
      agentToken: generateAgentToken(),
    };

    registerLiveAgent(sessionA);
    registerLiveAgent(sessionB);

    expect(listLiveAgents("/projectA")).toEqual([sessionA]);
    expect(listLiveAgents("/projectB")).toEqual([sessionB]);
    expect(listLiveAgents()).toHaveLength(2);
  });

  it("removes live agent and clears registry", () => {
    const token = generateAgentToken();
    const session: LiveAgentSession = {
      sessionId: "s_rem",
      agentName: "verifier",
      projectPath: "/repo",
      role: "roles/verifier.md",
      isOrchestrator: false,
      permissions: { canManageAgents: false },
      launchedAt: "2026-11-10T20:00:00.000Z",
      agentToken: token,
    };

    registerLiveAgent(session);
    removeLiveAgent("s_rem");

    expect(getLiveAgentBySessionId("s_rem")).toBeUndefined();
    expect(getLiveAgentByToken(token)).toBeUndefined();
  });
});
