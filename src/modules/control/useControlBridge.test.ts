// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

// Configure React act environment for happy-dom
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
import {
  dispatchBrowserMethod,
  dispatchHarnessMethod,
  parseOpenRequest,
  useControlBridge,
} from "./useControlBridge";
import {
  registerHarnessSessionHandle,
} from "@/modules/harness/lib/harnessControlBridge";
import { newSession } from "@/modules/harness/lib/session";
import { invoke } from "@tauri-apps/api/core";

const bridgeMockState = vi.hoisted(() => ({
  capturedListener: null as
    | ((event: { payload: any }) => Promise<void>)
    | null,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string, args?: any) => {
    if (cmd === "read_text_file") {
      if (args?.path?.endsWith("agents.json")) {
        return Promise.resolve(
          JSON.stringify({
            version: 1,
            defaults: { runtime: { adapter: "claude" } },
            agents: [
              { name: "orchestrator", role: "roles/orchestrator.md" },
              { name: "developer", role: "roles/developer.md" },
            ],
          }),
        );
      }
      return Promise.resolve("{}");
    }
    return Promise.resolve(true);
  }),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((event: string, handler: any) => {
    if (event === "voktty:control-request") {
      bridgeMockState.capturedListener = handler;
    }
    return Promise.resolve(() => {
      if (bridgeMockState.capturedListener === handler) {
        bridgeMockState.capturedListener = null;
      }
    });
  }),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    unminimize: vi.fn().mockResolvedValue(undefined),
    show: vi.fn().mockResolvedValue(undefined),
    setFocus: vi.fn().mockResolvedValue(undefined),
  }),
}));

describe("parseOpenRequest", () => {
  it("defaults focus only when it is absent", () => {
    expect(parseOpenRequest({ path: "/repo/main.rs" }).focus).toBe(true);
    expect(
      parseOpenRequest({ path: "/repo/main.rs", focus: false }).focus,
    ).toBe(false);
  });

  it.each([0, "false", null, {}])(
    "rejects non-boolean focus value %o",
    (focus) => {
      expect(() => parseOpenRequest({ path: "/repo/main.rs", focus })).toThrow(
        "focus must be a boolean",
      );
    },
  );
});

describe("dispatchBrowserMethod", () => {
  it("rejects type and eval without required fields", async () => {
    await expect(dispatchBrowserMethod("browser.type", {})).rejects.toThrow(
      "browser type requires text",
    );
    await expect(dispatchBrowserMethod("browser.eval", {})).rejects.toThrow(
      "browser eval requires a script",
    );
  });

  it("returns no_active_preview when no preview is mounted", async () => {
    const result = (await dispatchBrowserMethod("browser.snapshot", {})) as {
      error: string;
    };
    expect(result.error).toBe("no_active_preview");
  });
});

describe("dispatchHarnessMethod", () => {
  it("creates a new session when harness.new is called with onNewHarness handler", async () => {
    const onNewHarness = vi.fn().mockResolvedValue({
      sessionId: "test-session-123",
      tabId: 42,
    });

    const result = await dispatchHarnessMethod(
      "harness.new",
      {
        harness: "codex",
        cwd: "/my/project",
        model: "o3-mini",
        runtime_mode: "auto",
        auto_submit: false,
      },
      onNewHarness,
    );

    expect(onNewHarness).toHaveBeenCalledWith({
      harness: "codex",
      cwd: "/my/project",
      prompt: undefined,
      model: "o3-mini",
      runtimeMode: "auto",
      spaceId: undefined,
    });

    expect(result).toEqual({
      ok: true,
      session_id: "test-session-123",
      tab_id: 42,
    });
  });

  it("throws unsupported_method if harness.new has no handler registered", async () => {
    await expect(
      dispatchHarnessMethod("harness.new", { harness: "claude" }),
    ).rejects.toThrow("harness.new handler is not registered");
  });

  it("handles harness.list, harness.status, harness.send, and harness.interrupt", async () => {
    const session = newSession("claude", "/tmp/demo");
    const submit = vi.fn().mockResolvedValue(undefined);
    const interrupt = vi.fn();
    const unregister = registerHarnessSessionHandle(session.id, {
      getSession: () => session,
      submit,
      interrupt,
    });

    try {
      const list = (await dispatchHarnessMethod("harness.list", {})) as Array<{
        sessionId: string;
      }>;
      expect(list.some((s) => s.sessionId === session.id)).toBe(true);

      const status = (await dispatchHarnessMethod("harness.status", {
        session_id: session.id,
      })) as { sessionId: string; state: string };
      expect(status.sessionId).toBe(session.id);
      expect(status.state).toBe("idle");

      const sendResult = await dispatchHarnessMethod("harness.send", {
        session_id: session.id,
        text: "hello steering",
        interrupt: true,
      });
      expect(sendResult).toEqual({ ok: true });
      expect(interrupt).toHaveBeenCalledTimes(1);
      expect(submit).toHaveBeenCalledWith("hello steering", undefined);

      const interruptResult = await dispatchHarnessMethod("harness.interrupt", {
        session_id: session.id,
      });
      expect(interruptResult).toEqual({ ok: true });
      expect(interrupt).toHaveBeenCalledTimes(2);
    } finally {
      unregister();
    }
  });
});

describe("useControlBridge wiring (N1)", () => {
  function TestHost({
    onNewHarnessTab,
  }: {
    onNewHarnessTab?: (
      spaceId?: string,
      cwd?: string,
      sessionId?: string,
    ) => number;
  }) {
    useControlBridge({
      ready: true,
      tabsRef: { current: [] },
      activeTabIdRef: { current: 1 },
      activeSpaceIdRef: { current: "space-1" },
      onOpen: () => 1,
      onNewHarnessTab,
    });
    return null;
  }

  it("N1: passes onNewHarnessTab through bridge context to dispatchAgentMethod and returns real tabId", async () => {
    const mockOnNewHarnessTab = vi.fn().mockReturnValue(77);

    // Spy on dispatchAgentMethod
    const agentBridge = await import("@/modules/teams/lib/agentControlBridge");
    const dispatchSpy = vi
      .spyOn(agentBridge, "dispatchAgentMethod")
      .mockResolvedValue({
        ok: true,
        agent: "developer",
        sessionId: "s_dev",
        tabId: 77,
        tab_id: 77,
        mode: "new",
        supervised: true,
      } as any);

    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        React.createElement(TestHost, { onNewHarnessTab: mockOnNewHarnessTab }),
      );
    });

    expect(bridgeMockState.capturedListener).not.toBeNull();

    await act(async () => {
      await bridgeMockState.capturedListener!({
        payload: {
          id: "req-agent-start-1",
          method: "agent.start",
          params: { agent: "developer" },
          caller: { pane_id: "pane_1" },
        },
      });
    });

    // Verify dispatchAgentMethod was called with context containing onNewHarnessTab
    expect(dispatchSpy).toHaveBeenCalledWith(
      "agent.start",
      { agent: "developer" },
      expect.objectContaining({ pane_id: "pane_1" }),
      expect.objectContaining({
        onNewHarnessTab: mockOnNewHarnessTab,
      }),
    );

    // Verify respond was sent with real tabId and tab_id
    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("control_respond", {
        requestId: "req-agent-start-1",
        response: {
          ok: true,
          result: expect.objectContaining({
            agent: "developer",
            tabId: 77,
            tab_id: 77,
          }),
        },
      });
    });

    await act(async () => {
      root.unmount();
    });
    dispatchSpy.mockRestore();
  });

  it("N1: fails with request_failed when onNewHarnessTab is not provided to useControlBridge", async () => {
    const { registerLiveAgent, clearLiveAgentRegistry } = await import(
      "@/modules/teams/lib/agentRegistry"
    );
    clearLiveAgentRegistry();

    const orchToken = "0123456789abcdef0123456789abcdef";
    registerLiveAgent({
      sessionId: "s_orch",
      agentName: "orchestrator",
      projectPath: "/repo",
      role: "roles/orchestrator.md",
      isOrchestrator: true,
      permissions: { canManageAgents: true },
      agentToken: orchToken,
      launchedAt: new Date().toISOString(),
    });

    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        React.createElement(TestHost, { onNewHarnessTab: undefined }),
      );
    });

    expect(bridgeMockState.capturedListener).not.toBeNull();

    await act(async () => {
      await bridgeMockState.capturedListener!({
        payload: {
          id: "req-agent-start-2",
          method: "agent.start",
          params: { agent: "developer", project: "/repo" },
          caller: { pane_id: "pane_1", agent_token: orchToken },
        },
      });
    });

    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("control_respond", {
        requestId: "req-agent-start-2",
        response: {
          ok: false,
          error: expect.objectContaining({
            code: "request_failed",
            message: expect.stringContaining("No harness tab opener is available"),
          }),
        },
      });
    });

    await act(async () => {
      root.unmount();
    });
    clearLiveAgentRegistry();
  });
});
