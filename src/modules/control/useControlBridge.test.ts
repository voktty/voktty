import { describe, expect, it, vi } from "vitest";
import {
  dispatchBrowserMethod,
  dispatchHarnessMethod,
  parseOpenRequest,
} from "./useControlBridge";
import {
  registerHarnessSessionHandle,
} from "@/modules/harness/lib/harnessControlBridge";
import { newSession } from "@/modules/harness/lib/session";

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
