import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  clearLiveAgentRegistry,
  generateAgentToken,
  getLiveAgentBySessionId,
  getLiveAgentByToken,
  listLiveAgents,
  registerLiveAgent,
  registerLiveAgentWithControl,
  removeLiveAgent,
} from "./agentRegistry";
import type { LiveAgentSession } from "../types";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(true),
}));

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

  it("R2: registerLiveAgentWithControl registers session when invoke returns true", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockResolvedValueOnce(true);

    const token = generateAgentToken();
    const session: LiveAgentSession = {
      sessionId: "s_ok",
      agentName: "developer",
      projectPath: "/repo",
      role: "roles/developer.md",
      isOrchestrator: false,
      permissions: { canManageAgents: false },
      launchedAt: "2026-11-10T20:00:00.000Z",
      agentToken: token,
    };

    const ok = await registerLiveAgentWithControl(session);
    expect(ok).toBe(true);
    expect(getLiveAgentBySessionId("s_ok")).toEqual(session);
    expect(getLiveAgentByToken(token)).toEqual(session);
  });

  it("R2: registerLiveAgentWithControl rolls back registration and returns false when invoke returns false", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockResolvedValueOnce(false);

    const token = generateAgentToken();
    const session: LiveAgentSession = {
      sessionId: "s_rejected",
      agentName: "developer",
      projectPath: "/repo",
      role: "roles/developer.md",
      isOrchestrator: false,
      permissions: { canManageAgents: false },
      launchedAt: "2026-11-10T20:00:00.000Z",
      agentToken: token,
    };

    const ok = await registerLiveAgentWithControl(session);
    expect(ok).toBe(false);
    expect(getLiveAgentBySessionId("s_rejected")).toBeUndefined();
    expect(getLiveAgentByToken(token)).toBeUndefined();
  });

  it("R2: registerLiveAgentWithControl rolls back registration and returns false when invoke fails outside test IPC fallback", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockRejectedValueOnce(new Error("Rust backend error"));

    const token = generateAgentToken();
    const session: LiveAgentSession = {
      sessionId: "s_err",
      agentName: "developer",
      projectPath: "/repo",
      role: "roles/developer.md",
      isOrchestrator: false,
      permissions: { canManageAgents: false },
      launchedAt: "2026-11-10T20:00:00.000Z",
      agentToken: token,
    };

    const ok = await registerLiveAgentWithControl(session);
    expect(ok).toBe(false);
    expect(getLiveAgentBySessionId("s_err")).toBeUndefined();
    expect(getLiveAgentByToken(token)).toBeUndefined();
  });
});
