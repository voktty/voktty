import { beforeEach, describe, expect, it, vi } from "vitest";
import { readRoster, readTeamState, writeTeamState } from "./teamFs";
import {
  clearLiveAgentRegistry,
  generateAgentToken,
  getLiveAgentBySessionId,
  getLiveAgentByToken,
  registerLiveAgent,
} from "./agentRegistry";
import { dispatchAgentMethod } from "./agentControlBridge";
import { openAgent } from "./agentLauncher";
import {
  getHarnessSessionSnapshot,
  interruptHarnessSession,
} from "@/modules/harness/lib/harnessControlBridge";

vi.mock("./teamFs", () => ({
  readRoster: vi.fn(),
  readTeamState: vi.fn(),
  writeTeamState: vi.fn(),
  runProjectExclusive: vi.fn((_path, op) => op()),
  teamPath: vi.fn((...parts) => parts.join("/")),
}));

vi.mock("./teamBus", () => ({
  sendMessage: vi.fn().mockResolvedValue({ id: "msg_1", delivered: true }),
  deliverPendingMessages: vi.fn().mockResolvedValue(0),
}));

vi.mock("./agentLauncher", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./agentLauncher")>();
  return {
    ...actual,
    openAgent: vi.fn(),
  };
});

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

  // --- B1 E2E: Token delivery, authentication and revocation ---
  it("B1 E2E: authenticates with live agent token, and rejects once closed or revoked", async () => {
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
          { name: "orchestrator", role: "roles/orchestrator.md", start: "always" },
          { name: "worker", role: "roles/developer.md", start: "on-demand" },
        ],
      },
    });

    vi.mocked(readTeamState).mockResolvedValue({
      $schema: "urn:voktty:team-state:1",
      version: 1,
      updatedAt: "",
      agents: {
        orchestrator: { sessionId: "s_orch", status: "idle" },
        worker: { sessionId: "s_worker", status: "idle" },
      },
    });

    // 1. Worker is live with its own token
    const worker = createLiveAgent({
      sessionId: "s_worker",
      agentName: "worker",
      projectPath: "/project",
      role: "roles/developer.md",
      isOrchestrator: false,
      permissions: { canManageAgents: false },
    });

    // 2. Worker calls agent.list using its token -> succeeds
    const listRes: any = await dispatchAgentMethod(
      "agent.list",
      {},
      { agent_token: worker.agentToken },
    );
    expect(listRes.project).toBe("/project");
    expect(listRes.agents).toHaveLength(2);

    // 3. Orchestrator closes worker
    const closeRes: any = await dispatchAgentMethod(
      "agent.close",
      { agent: "worker" },
      { agent_token: orch.agentToken },
    );
    expect(closeRes.closed).toBe(true);

    // 4. Worker token is now revoked in registry
    expect(getLiveAgentByToken(worker.agentToken)).toBeUndefined();
    expect(getLiveAgentBySessionId("s_worker")).toBeUndefined();

    // 5. Worker calls agent.list again with old token -> rejected with forbidden
    await expect(
      dispatchAgentMethod("agent.list", {}, { agent_token: worker.agentToken }),
    ).rejects.toMatchObject({ code: "forbidden" });

    // 6. Unknown / random token is also rejected with forbidden
    await expect(
      dispatchAgentMethod("agent.list", {}, { agent_token: "unknown_token" }),
    ).rejects.toMatchObject({ code: "forbidden" });

    // 7. Missing token is rejected with forbidden
    await expect(
      dispatchAgentMethod("agent.list", {}, {}),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  // --- Cross-project security ---
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
        { agent_token: liveAgent.agentToken },
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  // --- B6: Management permission strictly based on role roles/orchestrator.md ---
  it("B6: rejects agent.start/stop/close from agent named 'orchestrator' if role is not roles/orchestrator.md", async () => {
    // Imposter agent: named "orchestrator" but with role "roles/developer.md"
    const imposter = createLiveAgent({
      sessionId: "s_fake_orch",
      agentName: "orchestrator",
      projectPath: "/project",
      role: "roles/developer.md",
      isOrchestrator: false,
      permissions: { canManageAgents: false },
    });

    // agent.start rejected
    await expect(
      dispatchAgentMethod(
        "agent.start",
        { agent: "tester" },
        { agent_token: imposter.agentToken },
      ),
    ).rejects.toMatchObject({ code: "forbidden" });

    // agent.stop rejected
    await expect(
      dispatchAgentMethod(
        "agent.stop",
        { agent: "tester" },
        { agent_token: imposter.agentToken },
      ),
    ).rejects.toMatchObject({ code: "forbidden" });

    // agent.close rejected
    await expect(
      dispatchAgentMethod(
        "agent.close",
        { agent: "tester" },
        { agent_token: imposter.agentToken },
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  // --- B5: Unified forbiddenModels policy check ---
  it("B5: enforces forbiddenModels on agent.start with wildcards and case-insensitivity", async () => {
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
          forbiddenModels: ["gpt-4*", "FORBIDDEN-ai"],
        },
      },
    });

    // 1. Wildcard match (gpt-4o matches gpt-4*)
    await expect(
      dispatchAgentMethod(
        "agent.start",
        { agent: "developer", model: "gpt-4o" },
        { agent_token: orch.agentToken },
      ),
    ).rejects.toMatchObject({ code: "forbidden_model" });

    // 2. Case-insensitive match (forbidden-ai matches FORBIDDEN-ai)
    await expect(
      dispatchAgentMethod(
        "agent.start",
        { agent: "developer", model: "forbidden-ai" },
        { agent_token: orch.agentToken },
      ),
    ).rejects.toMatchObject({ code: "forbidden_model" });
  });

  // --- Capacity limit check ---
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
        agents: [{ name: "a7", role: "roles/7.md", start: "on-demand" }],
      },
    });

    vi.mocked(openAgent).mockResolvedValue({
      ok: false,
      error: "capacity_exceeded",
      reason: "Maximum 6 concurrent agents per project",
      agent: "a7",
      sessionId: "",
      supervised: true,
      mode: "new",
    });

    await expect(
      dispatchAgentMethod(
        "agent.start",
        { agent: "a7" },
        { agent_token: orch.agentToken },
        { onNewHarnessTab: vi.fn().mockReturnValue(42) },
      ),
    ).rejects.toMatchObject({ code: "capacity_exceeded" });
  });

  // --- B2 & F3: agent.close behavior ---
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

    vi.mocked(getHarnessSessionSnapshot).mockReturnValue({
      state: "working",
    } as any);

    await expect(
      dispatchAgentMethod(
        "agent.close",
        { agent: "developer" },
        { agent_token: orch.agentToken },
      ),
    ).rejects.toMatchObject({ code: "busy" });
  });

  it("F3: agent.close closes mounted tab and revokes token", async () => {
    const orch = createLiveAgent({
      sessionId: "s_orch",
      agentName: "orchestrator",
      projectPath: "/project",
      role: "roles/orchestrator.md",
      isOrchestrator: true,
      permissions: { canManageAgents: true },
    });

    createLiveAgent({
      sessionId: "s_dev",
      agentName: "developer",
      projectPath: "/project",
      role: "roles/developer.md",
      isOrchestrator: false,
      permissions: { canManageAgents: false },
    });

    vi.mocked(readTeamState).mockResolvedValue({
      $schema: "urn:voktty:team-state:1",
      version: 1,
      updatedAt: "",
      agents: {
        developer: { sessionId: "s_dev", status: "idle" },
      },
    });

    vi.mocked(getHarnessSessionSnapshot).mockReturnValue({
      state: "idle",
    } as any);

    const onCloseTab = vi.fn();
    const tabsRef = {
      current: [{ id: 42, kind: "harness", sessionId: "s_dev" }],
    };

    const res: any = await dispatchAgentMethod(
      "agent.close",
      { agent: "developer" },
      { agent_token: orch.agentToken },
      { onCloseTab, tabsRef },
    );

    expect(res.ok).toBe(true);
    expect(res.closed).toBe(true);
    expect(onCloseTab).toHaveBeenCalledWith(42);
    expect(getLiveAgentBySessionId("s_dev")).toBeUndefined();
  });

  // --- F2: Verdict cursor and task freshness ---
  it("F2: agent.wait --until verdict ignores verdicts older than currentTaskStartedAt", async () => {
    const orch = createLiveAgent({
      sessionId: "s_orch",
      agentName: "orchestrator",
      projectPath: "/project",
      role: "roles/orchestrator.md",
      isOrchestrator: true,
      permissions: { canManageAgents: true },
    });

    const oldVerdictTime = "2026-11-10T10:00:00.000Z";
    const taskStartTime = "2026-11-10T12:00:00.000Z";
    const newVerdictTime = "2026-11-10T12:05:00.000Z";

    // 1. Worker has old verdict from earlier task
    vi.mocked(readTeamState).mockResolvedValue({
      $schema: "urn:voktty:team-state:1",
      version: 1,
      updatedAt: "",
      agents: {
        developer: {
          sessionId: "s_dev",
          status: "working",
          currentTaskStartedAt: taskStartTime,
          lastVerdict: {
            text: "Old task green",
            timestamp: oldVerdictTime,
          },
        },
      },
    });

    vi.mocked(getHarnessSessionSnapshot).mockReturnValue({
      state: "working",
    } as any);

    // Should NOT match old verdict
    const waitRes1: any = await dispatchAgentMethod(
      "agent.wait",
      { agent: "developer", until: "verdict" },
      { agent_token: orch.agentToken },
    );
    expect(waitRes1.matched).toBe(false);

    // 2. Worker produces fresh verdict after currentTaskStartedAt
    vi.mocked(readTeamState).mockResolvedValue({
      $schema: "urn:voktty:team-state:1",
      version: 1,
      updatedAt: "",
      agents: {
        developer: {
          sessionId: "s_dev",
          status: "idle",
          currentTaskStartedAt: taskStartTime,
          lastVerdict: {
            text: "Fresh task green",
            timestamp: newVerdictTime,
          },
        },
      },
    });

    vi.mocked(getHarnessSessionSnapshot).mockReturnValue({
      state: "idle",
    } as any);

    // Should match fresh verdict
    const waitRes2: any = await dispatchAgentMethod(
      "agent.wait",
      { agent: "developer", until: "verdict" },
      { agent_token: orch.agentToken },
    );
    expect(waitRes2.matched).toBe(true);
    expect(waitRes2.verdict).toBe("Fresh task green");
  });

  // --- F3: agent.stop confirmation ---
  it("F3: agent.stop confirms interruption before marking idle", async () => {
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

    // Session snapshot transitions to idle after interrupt
    vi.mocked(getHarnessSessionSnapshot).mockReturnValue({
      state: "idle",
    } as any);

    const res: any = await dispatchAgentMethod(
      "agent.stop",
      { agent: "developer" },
      { agent_token: orch.agentToken },
    );

    expect(res.ok).toBe(true);
    expect(res.stopped).toBe(true);
    expect(interruptHarnessSession).toHaveBeenCalledWith("s_dev");
    expect(writeTeamState).toHaveBeenCalled();
  });

  // --- F5: Model resolution does not invent claude-3-7-sonnet ---
  it("F5: agent.list resolves model without inventing claude-3-7-sonnet", async () => {
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
            name: "codex-worker",
            role: "roles/developer.md",
            start: "on-demand",
            runtime: { adapter: "codex" }, // No model specified!
          },
        ],
      },
    });

    vi.mocked(readTeamState).mockResolvedValue({
      $schema: "urn:voktty:team-state:1",
      version: 1,
      updatedAt: "",
      agents: {
        "codex-worker": { status: "unopened" },
      },
    });

    const res: any = await dispatchAgentMethod(
      "agent.list",
      {},
      { agent_token: orch.agentToken },
    );

    const worker = res.agents.find((a: any) => a.name === "codex-worker");
    expect(worker.model).toBe("default");
    expect(worker.model).not.toBe("claude-3-7-sonnet");
  });

  // --- N1: agent.start requires real tab opener in context ---
  it("N1: agent.start fails with request_failed when onNewHarnessTab is missing in context", async () => {
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
          { name: "orchestrator", role: "roles/orchestrator.md", start: "always" },
          { name: "worker", role: "roles/developer.md", start: "on-demand" },
        ],
      },
    });

    await expect(
      dispatchAgentMethod(
        "agent.start",
        { agent: "worker" },
        { agent_token: orch.agentToken },
        {}, // context without onNewHarnessTab
      ),
    ).rejects.toMatchObject({
      code: "request_failed",
      message: expect.stringContaining("No harness tab opener is available"),
    });
  });

  // --- M1: agent.stop and agent.close run within runProjectExclusive ---
  it("M1: agent.stop and agent.close execute under runProjectExclusive", async () => {
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
          { name: "orchestrator", role: "roles/orchestrator.md", start: "always" },
          { name: "worker", role: "roles/developer.md", start: "on-demand" },
        ],
      },
    });

    vi.mocked(readTeamState).mockResolvedValue({
      $schema: "urn:voktty:team-state:1",
      version: 1,
      updatedAt: "",
      agents: {
        worker: { sessionId: "s_worker", status: "idle" },
      },
    });

    vi.mocked(getHarnessSessionSnapshot).mockReturnValue({
      state: "idle",
    } as any);

    // Call agent.stop
    await dispatchAgentMethod(
      "agent.stop",
      { agent: "worker" },
      { agent_token: orch.agentToken },
    );

    const { runProjectExclusive } = await import("./teamFs");
    expect(runProjectExclusive).toHaveBeenCalledWith("/project", expect.any(Function));

    // Call agent.close
    await dispatchAgentMethod(
      "agent.close",
      { agent: "worker" },
      { agent_token: orch.agentToken },
    );

    expect(runProjectExclusive).toHaveBeenCalledWith("/project", expect.any(Function));
  });

  // --- E4: awaiting_owner and copies support in control bridge ---
  describe("E4: awaiting_owner and copies support in control bridge", () => {
    it("E4: agent.list includes active copies and preserves awaiting_owner status", async () => {
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
            { name: "orchestrator", role: "roles/orchestrator.md", start: "always" },
            { name: "developer", role: "roles/developer.md", start: "on-demand" },
          ],
        },
      });

      vi.mocked(readTeamState).mockResolvedValue({
        $schema: "urn:voktty:team-state:1",
        version: 1,
        updatedAt: "",
        agents: {
          developer: {
            sessionId: "s_dev",
            status: "awaiting_owner",
            task: "Wait for owner",
          },
          "developer-2": {
            sessionId: "s_dev2",
            status: "working",
            worktree: "/project-worktrees/developer-2",
          },
        },
      });

      vi.mocked(getHarnessSessionSnapshot).mockImplementation((sId) => {
        if (sId === "s_dev") {
          return { state: "idle" } as any; // session not working yet
        }
        if (sId === "s_dev2") {
          return { state: "working" } as any;
        }
        return null;
      });

      const res: any = await dispatchAgentMethod(
        "agent.list",
        {},
        { agent_token: orch.agentToken },
      );

      const dev = res.agents.find((a: any) => a.name === "developer");
      const dev2 = res.agents.find((a: any) => a.name === "developer-2");

      expect(dev).toBeDefined();
      expect(dev.status).toBe("awaiting_owner");

      expect(dev2).toBeDefined();
      expect(dev2.role).toBe("roles/developer.md");
      expect(dev2.status).toBe("working");
    });

    it("E4: agent.status reports awaiting_owner when agent waits for owner input", async () => {
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
            status: "awaiting_owner",
          },
        },
      });

      vi.mocked(getHarnessSessionSnapshot).mockReturnValue({
        state: "idle",
      } as any);

      const res: any = await dispatchAgentMethod(
        "agent.status",
        { agent: "developer" },
        { agent_token: orch.agentToken },
      );

      expect(res.status).toBe("awaiting_owner");
    });

    it("E4: agent.wait returns immediately with awaiting_owner status instead of waiting indefinitely", async () => {
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
            status: "awaiting_owner",
          },
        },
      });

      vi.mocked(getHarnessSessionSnapshot).mockReturnValue({
        state: "idle",
      } as any);

      const res: any = await dispatchAgentMethod(
        "agent.wait",
        { agent: "developer", until: "verdict" },
        { agent_token: orch.agentToken },
      );

      expect(res.ok).toBe(true);
      expect(res.matched).toBe(true);
      expect(res.status).toBe("awaiting_owner");
      expect(res.info).toContain("awaiting owner input");
    });

    it("E4: agent.list marks copies whose session no longer exists as unopened", async () => {
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
            { name: "orchestrator", role: "roles/orchestrator.md", start: "always" },
            { name: "developer", role: "roles/developer.md", start: "on-demand" },
          ],
        },
      });

      vi.mocked(readTeamState).mockResolvedValue({
        $schema: "urn:voktty:team-state:1",
        version: 1,
        updatedAt: "",
        agents: {
          "developer-2": {
            sessionId: "s_old_closed_session",
            status: "working",
          },
        },
      });

      // Session snapshot is null (session no longer alive in memory)
      vi.mocked(getHarnessSessionSnapshot).mockReturnValue(null);

      const res: any = await dispatchAgentMethod(
        "agent.list",
        {},
        { agent_token: orch.agentToken },
      );

      const dev2 = res.agents.find((a: any) => a.name === "developer-2");
      expect(dev2).toBeDefined();
      expect(dev2.status).toBe("unopened");
    });

    it("E4: agent.start rejects orchestrator copies with invalid_params", async () => {
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
            { name: "orchestrator", role: "roles/orchestrator.md", start: "always" },
          ],
        },
      });

      await expect(
        dispatchAgentMethod(
          "agent.start",
          { agent: "orchestrator-2" },
          { agent_token: orch.agentToken },
          { onNewHarnessTab: vi.fn() },
        ),
      ).rejects.toThrow("Copies of the orchestrator agent are forbidden");
    });
  });
});
