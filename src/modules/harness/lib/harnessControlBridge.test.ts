import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getHarnessSessionResult,
  getHarnessSessionSnapshot,
  harnessSessionState,
  interruptHarnessSession,
  listHarnessSessionSnapshots,
  registerHarnessSessionHandle,
  sendHarnessSessionMessage,
  waitForHarnessSession,
  waitForHarnessSessionHandle,
} from "./harnessControlBridge";
import { newSession, type Session } from "./session";

function withBlocks(patch: Partial<Session> = {}): Session {
  const session = newSession("claude", "/tmp/project");
  return { ...session, ...patch };
}

describe("harnessSessionState", () => {
  it("is idle before any turn", () => {
    expect(harnessSessionState(withBlocks())).toBe("idle");
  });

  it("is working while busy", () => {
    expect(harnessSessionState(withBlocks({ busy: true }))).toBe("working");
  });

  it("is waiting on an undecided approval even if not busy", () => {
    const session = withBlocks({
      blocks: [
        { id: "a1", role: "approval", text: "", approval: { requestId: 1 } },
      ],
    });
    expect(harnessSessionState(session)).toBe("waiting");
  });

  it("is done once a user turn finished without pending approval", () => {
    const session = withBlocks({
      blocks: [{ id: "u1", role: "user", text: "hi" }],
    });
    expect(harnessSessionState(session)).toBe("done");
  });
});

describe("registerHarnessSessionHandle", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("exposes and then removes a mounted session with rich metadata", () => {
    const session = withBlocks({ id: "s1" });
    const submit = vi.fn().mockResolvedValue(undefined);
    const unregister = registerHarnessSessionHandle("s1", {
      getSession: () => session,
      submit,
    });

    expect(getHarnessSessionSnapshot("s1")).toEqual({
      sessionId: "s1",
      harness: "claude",
      cwd: "/tmp/project",
      title: session.title,
      state: "idle",
      model: session.model,
      runtimeMode: "supervised",
      turnCount: 0,
      toolsExecutedCount: 0,
      subagentsCount: 0,
      pendingApproval: false,
    });
    expect(listHarnessSessionSnapshots()).toHaveLength(1);

    unregister();

    expect(getHarnessSessionSnapshot("s1")).toBeNull();
    expect(listHarnessSessionSnapshots()).toHaveLength(0);
  });

  it("sends through the registered submit closure and supports interrupt", async () => {
    const session = withBlocks({ id: "s2" });
    const submit = vi.fn().mockResolvedValue(undefined);
    const interrupt = vi.fn();
    const unregister = registerHarnessSessionHandle("s2", {
      getSession: () => session,
      submit,
      interrupt,
    });

    await sendHarnessSessionMessage("s2", "hello");
    expect(submit).toHaveBeenCalledWith("hello", undefined);

    await sendHarnessSessionMessage("s2", "stop and do this", { interrupt: true });
    expect(interrupt).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith("stop and do this", undefined);

    expect(interruptHarnessSession("s2")).toBe(true);
    expect(interrupt).toHaveBeenCalledTimes(2);

    unregister();
  });

  it("rejects when no session is mounted", async () => {
    await expect(sendHarnessSessionMessage("missing", "hi")).rejects.toThrow(
      /no mounted harness session/,
    );
  });

  it("returns the last assistant text as the result", () => {
    const session = withBlocks({
      id: "s3",
      blocks: [
        { id: "u1", role: "user", text: "hi" },
        { id: "a1", role: "assistant", text: "hello back" },
      ],
    });
    const unregister = registerHarnessSessionHandle("s3", {
      getSession: () => session,
      submit: vi.fn(),
    });

    expect(getHarnessSessionResult("s3")).toEqual({
      sessionId: "s3",
      harness: "claude",
      cwd: "/tmp/project",
      title: session.title,
      state: "done",
      text: "hello back",
      model: session.model,
      runtimeMode: "supervised",
      turnCount: 1,
      toolsExecutedCount: 0,
      subagentsCount: 0,
      pendingApproval: false,
    });

    unregister();
  });
});

describe("waitForHarnessSession", () => {
  it("resolves immediately when the session already matches", async () => {
    const session = withBlocks({ id: "s4", busy: true });
    const unregister = registerHarnessSessionHandle("s4", {
      getSession: () => session,
      submit: vi.fn(),
    });

    const result = await waitForHarnessSession("s4", ["working"], 1000);
    expect(result.reached).toBe(true);
    expect(result.snapshot.state).toBe("working");

    unregister();
  });

  it("times out when the target state is never reached", async () => {
    const session = withBlocks({ id: "s5", busy: true });
    const unregister = registerHarnessSessionHandle("s5", {
      getSession: () => session,
      submit: vi.fn(),
    });

    const result = await waitForHarnessSession("s5", ["done"], 200);
    expect(result.reached).toBe(false);
    expect(result.snapshot.state).toBe("working");

    unregister();
  });

  it("throws if the session is not mounted", async () => {
    await expect(
      waitForHarnessSession("missing", ["done"], 100),
    ).rejects.toThrow(/no mounted harness session/);
  });
});

describe("waitForHarnessSessionHandle", () => {
  it("resolves when handle is registered before timeout", async () => {
    const session = withBlocks({ id: "s6" });
    const submit = vi.fn().mockResolvedValue(undefined);
    setTimeout(() => {
      registerHarnessSessionHandle("s6", {
        getSession: () => session,
        submit,
      });
    }, 50);

    const handle = await waitForHarnessSessionHandle("s6", 500);
    expect(handle.getSession()).toBe(session);
  });

  it("throws when handle fails to mount in time", async () => {
    await expect(waitForHarnessSessionHandle("missing-handle", 100)).rejects.toThrow(
      /did not mount within 100ms/,
    );
  });
});
