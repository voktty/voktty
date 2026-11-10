import { beforeEach, describe, expect, it, vi } from "vitest";
import { readRoster, readTeamState } from "./teamFs";
import {
  clearLiveAgentRegistry,
  generateAgentToken,
  registerLiveAgent,
} from "./agentRegistry";
import { dispatchAgentMethod } from "./agentControlBridge";

vi.mock("./teamFs", () => ({
  readRoster: vi.fn(),
  readTeamState: vi.fn(),
  writeTeamState: vi.fn(),
  teamPath: vi.fn((...parts) => parts.join("/")),
}));

vi.mock("./teamBus", () => ({
  sendMessage: vi.fn(),
  deliverPendingMessages: vi.fn(),
}));

vi.mock("./agentLauncher", () => ({
  openAgent: vi.fn(),
}));

vi.mock("@/modules/harness/lib/harnessControlBridge", () => ({
  getHarnessSessionSnapshot: vi.fn(),
  interruptHarnessSession: vi.fn(),
}));

describe("agentControlBridge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearLiveAgentRegistry();
  });

  function createLiveAgent(opts: {
    sessionId: string;
    agentName: string;
    projectPath: string;
    role: string;
    isOrchestrator: boolean;
    permissions: { canManageAgents: boolean };
  }) {
    const agentToken = generateAgentToken();
    const session = {
      ...opts,
      agentToken,
      launchedAt: new Date().toISOString(),
    };
    registerLiveAgent(session);
    return session;
  }

  it("rejects caller without agent token or with unregistered token", async () => {
    // 1. Missing token
    await expect(
      dispatchAgentMethod("agent.list", {}, {} as any),
    ).rejects.toMatchObject({ code: "forbidden" });

    // 2. Unregistered token
    await expect(
      dispatchAgentMethod("agent.list", {}, { agent_token: "fake_token" } as any),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("rejects cross-project calls", async () => {
    const liveAgent = createLiveAgent({
      sessionId: "s_orch",
      agentName: "orchestrator",
      projectPath: "/project-a",
      role: "roles/orchestrator.md",
      isOrchestrator: true,
      permissions: { canManageAgents: true },
    });

    await expect(
      dispatchAgentMethod(
        "agent.list",
        { project: "/project-b" },
        { agent_token: liveAgent.agentToken } as any,
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("rejects agent.start from non-orchestrator", async () => {
    const worker = createLiveAgent({
      sessionId: "s_worker",
      agentName: "developer",
      projectPath: "/project",
      role: "roles/developer.md",
      isOrchestrator: false,
      permissions: { canManageAgents: false },
    });

    await expect(
      dispatchAgentMethod(
        "agent.start",
        { agent: "tester" },
        { agent_token: worker.agentToken } as any,
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("enforces forbiddenModels on agent.start", async () => {
    const orch = createLiveAgent({
      sessionId: "s_orch",
      agentName: "orchestrator",
      projectPath: "/project",
      role: "roles/orchestrator.md",
      isOrchestrator: true,
      permissions: { canManageAgents: true },
    });

    vi.mocked(readRoster).mockResolvedValue({
      roster: {
        version: 1,
        agents: [
          {
            name: "developer",
            role: "roles/developer.md",
            start: "on-demand",
            runtime: { adapter: "claude-code", model: "claude-3-7-sonnet" },
          },
        ],
        policies: {
          forbiddenModels: ["gpt-4o", "forbidden-ai"],
        },
      },
    });

    await expect(
      dispatchAgentMethod(
        "agent.start",
        { agent: "developer", model: "gpt-4o" },
        { agent_token: orch.agentToken } as any,
      ),
    ).rejects.toMatchObject({ code: "forbidden_model" });
  });

  it("enforces capacity limit of 6 active agents", async () => {
    const orch = createLiveAgent({
      sessionId: "s_orch",
      agentName: "orchestrator",
      projectPath: "/project",
      role: "roles/orchestrator.md",
      isOrchestrator: true,
      permissions: { canManageAgents: true },
    });

    vi.mocked(readRoster).mockResolvedValue({
      roster: {
        version: 1,
        agents: [
          { name: "a1", role: "roles/1.md", start: "on-demand" },
          { name: "a2", role: "roles/2.md", start: "on-demand" },
          { name: "a3", role: "roles/3.md", start: "on-demand" },
          { name: "a4", role: "roles/4.md", start: "on-demand" },
          { name: "a5", role: "roles/5.md", start: "on-demand" },
          { name: "a6", role: "roles/6.md", start: "on-demand" },
          { name: "a7", role: "roles/7.md", start: "on-demand" },
        ],
      },
    });

    vi.mocked(readTeamState).mockResolvedValue({
      $schema: "urn:voktty:team-state:1",
      version: 1,
      updatedAt: "",
      agents: {
        a1: { status: "working" },
        a2: { status: "idle" },
        a3: { status: "working" },
        a4: { status: "idle" },
        a5: { status: "waiting_approval" },
        a6: { status: "working" },
      },
    });

    await expect(
      dispatchAgentMethod(
        "agent.start",
        { agent: "a7" },
        { agent_token: orch.agentToken } as any,
      ),
    ).rejects.toMatchObject({ code: "capacity_exceeded" });
  });

  it("rejects agent.close with 'busy' when agent is actively working", async () => {
    const orch = createLiveAgent({
      sessionId: "s_orch",
      agentName: "orchestrator",
      projectPath: "/project",
      role: "roles/orchestrator.md",
      isOrchestrator: true,
      permissions: { canManageAgents: true },
    });

    vi.mocked(readTeamState).mockResolvedValue({
      $schema: "urn:voktty:team-state:1",
      version: 1,
      updatedAt: "",
      agents: {
        developer: { sessionId: "s_dev", status: "working" },
      },
    });

    const { getHarnessSessionSnapshot } = await import(
      "@/modules/harness/lib/harnessControlBridge"
    );
    vi.mocked(getHarnessSessionSnapshot).mockReturnValue({
      state: "working",
    } as any);

    await expect(
      dispatchAgentMethod(
        "agent.close",
        { agent: "developer" },
        { agent_token: orch.agentToken } as any,
      ),
    ).rejects.toMatchObject({ code: "busy" });
  });

  it("agent.wait returns matched verdict", async () => {
    const orch = createLiveAgent({
      sessionId: "s_orch",
      agentName: "orchestrator",
      projectPath: "/project",
      role: "roles/orchestrator.md",
      isOrchestrator: true,
      permissions: { canManageAgents: true },
    });

    vi.mocked(readTeamState).mockResolvedValue({
      $schema: "urn:voktty:team-state:1",
      version: 1,
      updatedAt: "",
      agents: {
        developer: {
          sessionId: "s_dev",
          status: "idle",
          lastVerdict: {
            text: "All tests green",
            timestamp: new Date().toISOString(),
          },
        },
      },
    });

    const res: any = await dispatchAgentMethod(
      "agent.wait",
      { agent: "developer", until: "verdict" },
      { agent_token: orch.agentToken } as any,
    );

    expect(res.ok).toBe(true);
    expect(res.matched).toBe(true);
    expect(res.verdict).toBe("All tests green");
  });
});
