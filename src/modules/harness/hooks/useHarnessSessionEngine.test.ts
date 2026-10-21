// @vitest-environment happy-dom
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useHarnessSessionEngine } from "@/modules/harness/hooks/useHarnessSessionEngine";
import type { Session } from "@/modules/harness/lib/session";
import type { HarnessEvent } from "@/modules/harness/lib/harness";

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  cancel: vi.fn(),
  checkpoint: vi.fn(),
  prepareAttachments: vi.fn(),
  steer: vi.fn(),
  compact: vi.fn(),
  canCompact: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/modules/harness/lib/harness", async () => {
  const actual = await import("@/modules/harness/lib/harness/apply");
  return {
    ...actual,
    isLiveHarness: () => true,
    canSteerHarness: () => true,
    sendHarnessTurn: mocks.send,
    cancelHarnessTurn: mocks.cancel,
    generateHarnessTitle: vi.fn().mockResolvedValue(undefined),
    forgetHarnessSession: vi.fn().mockResolvedValue(undefined),
    canRewindHarnessLastTurn: () => false,
    canCompactHarnessContext: mocks.canCompact,
    compactHarnessContext: mocks.compact,
    steerHarnessTurn: mocks.steer,
    respondHarnessApproval: vi.fn(),
    respondHarnessQuestion: vi.fn(),
    keepHarnessQuestionOpen: vi.fn(),
  };
});
vi.mock("@/modules/harness/lib/checkpoint", () => ({
  beginSessionTurn: mocks.checkpoint,
  syncSessionCheckpoint: mocks.checkpoint,
  notifyReviewChanged: vi.fn(),
  prepareSessionCheckpoint: mocks.checkpoint,
  captureSessionCheckpoint: mocks.checkpoint,
}));
vi.mock("@/modules/harness/lib/attachments", () => ({
  displayAttachments: (files: unknown) => files,
  prepareAttachments: mocks.prepareAttachments,
}));
vi.mock("@/modules/harness/lib/promptPreparation", () => ({
  preparePrompt: async (text: string) => text,
}));
vi.mock("@/modules/harness/lib/providerAccounts", () => ({
  supportsProviderAccounts: () => false,
}));
vi.mock("@/modules/harness/lib/dockBadge", () => ({ syncDockBadge: vi.fn() }));
vi.mock("@/modules/harness/lib/sounds", () => ({ playCue: vi.fn() }));
vi.mock("@/modules/harness/lib/fileWatch", () => ({
  nudgeWatchedFiles: vi.fn(),
}));
vi.mock("@/modules/harness/lib/fileIndex", () => ({
  invalidateProjectFiles: vi.fn(),
}));
vi.mock("@/modules/harness/lib/fileTree", () => ({
  notifyDirsChanged: vi.fn(),
}));
vi.mock("@/modules/harness/lib/fs", () => ({ notifyGitChanged: vi.fn() }));

function chat(id: string, patch: Partial<Session> = {}): Session {
  return {
    id,
    harness: "claude",
    model: "test",
    modelSettings: {},
    runtimeMode: "supervised",
    cwd: "/repo",
    title: "named",
    blocks: [{ id: `${id}-user`, role: "user", text: "previous" }],
    ...patch,
  };
}
let roots: Root[] = [];
let containers: HTMLElement[] = [];
function mount(sessions: Session[]) {
  let engine!: ReturnType<typeof useHarnessSessionEngine>;
  const container = document.createElement("div");
  containers.push(container);
  const root = createRoot(container);
  roots.push(root);
  function Harness() {
    engine = useHarnessSessionEngine({
      initialSessions: () => sessions,
      isForeground: () => true,
      isRemoving: () => false,
      isSwitching: () => false,
    });
    return null;
  }
  act(() =>
    root.render(createElement(StrictMode, null, createElement(Harness))),
  );
  return () => engine;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers({
    toFake: [
      "setTimeout",
      "clearTimeout",
      "requestAnimationFrame",
      "cancelAnimationFrame",
    ],
  });
  mocks.send.mockReset().mockResolvedValue(undefined);
  mocks.cancel.mockReset().mockResolvedValue(undefined);
  mocks.checkpoint.mockReset().mockResolvedValue(undefined);
  mocks.prepareAttachments
    .mockReset()
    .mockImplementation(async (files) => files);
  mocks.steer.mockReset().mockResolvedValue(undefined);
  mocks.compact.mockReset().mockResolvedValue(undefined);
  mocks.canCompact.mockReset().mockReturnValue(false);
});
afterEach(() => {
  act(() => {
    for (const root of roots) root.unmount();
  });
  roots = [];
  for (const container of containers) container.remove();
  containers = [];
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("instance-local Harness session execution", () => {
  it("preserves queued React edits and admission when an immediate event batch is a no-op", async () => {
    let sink!: (event: HarnessEvent) => void;
    mocks.send.mockImplementation((input) => {
      sink = input.onEvent;
      return new Promise(() => {});
    });
    const engine = mount([chat("running")]);
    await act(async () => {
      engine().onSubmit("running", "first");
    });
    act(() => {
      engine().updateSession("running", (session) => ({
        ...session,
        title: "scheduled title",
      }));
      engine().admitSession(chat("scheduled admission"));
      sink({ type: "session.started" });
      engine().flushHarnessEvents();
    });
    expect(engine().sessions[0].title).toBe("scheduled title");
    expect(engine().sessions.map((session) => session.id)).toEqual([
      "running",
      "scheduled admission",
    ]);
  });

  it("delivers a reused provider event object independently to concurrent sessions", async () => {
    const sinks = new Map<string, (event: HarnessEvent) => void>();
    mocks.send.mockImplementation((input) => {
      sinks.set(input.sessionId, input.onEvent);
      return new Promise(() => {});
    });
    const engine = mount([chat("a"), chat("b")]);
    await act(async () => {
      engine().onSubmit("a", "first");
      engine().onSubmit("b", "second");
    });
    const shared: HarnessEvent = { type: "message.delta", text: "x" };
    act(() => {
      sinks.get("a")?.(shared);
      sinks.get("b")?.(shared);
      engine().flushHarnessEvents();
    });
    expect(
      engine().sessions.map((session) =>
        session.blocks
          .filter((block) => block.role === "assistant")
          .map((block) => block.text)
          .join(""),
      ),
    ).toEqual(["x", "x"]);
  });

  it("does not retag an old queued event when its object is reused by replacement compaction", async () => {
    let oldSink!: (event: HarnessEvent) => void;
    let compactSink!: (event: HarnessEvent) => void;
    mocks.send.mockImplementation((input) => {
      oldSink = input.onEvent;
      return new Promise(() => {});
    });
    mocks.canCompact.mockReturnValue(true);
    mocks.compact.mockImplementation((input) => {
      compactSink = input.onEvent;
      return new Promise(() => {});
    });
    const engine = mount([chat("reused")]);
    await act(async () => {
      engine().onSubmit("reused", "first");
    });
    const shared: HarnessEvent = { type: "message.delta", text: "x" };
    act(() => {
      oldSink(shared);
      engine().applySessionDeltas(
        [
          { kind: "remove", id: "reused" },
          { kind: "admit", session: chat("reused") },
        ],
        "immediate",
      );
      expect(engine().onCompactContext("reused")).toBe(true);
      compactSink(shared);
      engine().flushHarnessEvents();
    });
    expect(
      engine()
        .sessions[0].blocks.filter((block) => block.role === "assistant")
        .map((block) => block.text)
        .join(""),
    ).toBe("x");
  });

  it("composes scheduled per-ID updates against React's latest state", () => {
    const unchanged = chat("other");
    const engine = mount([chat("changed"), unchanged]);
    act(() => {
      engine().updateSession("changed", (session) => ({
        ...session,
        title: "first",
      }));
      engine().updateSession("changed", (session) => ({
        ...session,
        cwd: "/second",
      }));
      engine().admitSession(chat("new"));
    });
    expect(engine().sessions[0]).toMatchObject({
      title: "first",
      cwd: "/second",
    });
    expect(engine().sessions[1]).toBe(unchanged);
    expect(engine().sessions[2].id).toBe("new");
  });

  it("does not send a stopped turn after delayed attachment preparation", async () => {
    let prepared!: (value: []) => void;
    mocks.prepareAttachments.mockImplementationOnce(
      () =>
        new Promise<[]>((resolve) => {
          prepared = resolve;
        }),
    );
    const engine = mount([chat("delayed")]);
    await act(async () => {
      engine().onSubmit("delayed", "first");
    });
    act(() => engine().onStop("delayed"));
    await act(async () => {
      prepared([]);
    });
    expect(mocks.send).not.toHaveBeenCalled();
    expect(engine().sessions[0].busy).toBe(false);
  });

  it("queues a busy follow-up without replacing the running turn generation", async () => {
    let sink!: (event: HarnessEvent) => void;
    mocks.send.mockImplementation((input) => {
      sink = input.onEvent;
      return new Promise(() => {});
    });
    const engine = mount([chat("busy")]);
    await act(async () => {
      engine().onSubmit("busy", "first");
    });
    act(() =>
      engine().onSubmit("busy", "follow-up", [], { followUpBehavior: "queue" }),
    );
    act(() => {
      sink({ type: "status", text: "still running" });
      engine().flushHarnessEvents();
    });
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(engine().sessions[0].queuedMessages?.[0].text).toBe("follow-up");
    expect(
      engine().sessions[0].blocks.some(
        (block) => block.text === "still running",
      ),
    ).toBe(true);
    expect(engine().sessions[0].busy).toBe(true);
  });

  it("steers a busy follow-up without stopping its original event sink", async () => {
    let sink!: (event: HarnessEvent) => void;
    mocks.send.mockImplementation((input) => {
      sink = input.onEvent;
      return new Promise(() => {});
    });
    const engine = mount([chat("steer")]);
    await act(async () => {
      engine().onSubmit("steer", "first");
    });
    await act(async () => {
      engine().onSubmit("steer", "follow-up", [], {
        followUpBehavior: "steer",
      });
    });
    act(() => {
      sink({ type: "status", text: "running after steer" });
      engine().flushHarnessEvents();
    });
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.steer).toHaveBeenCalledTimes(1);
    expect(
      engine().sessions[0].blocks.some(
        (block) => block.text === "running after steer",
      ),
    ).toBe(true);
  });

  it("does not steer a replaced active turn after delayed preparation", async () => {
    let prepared!: (value: []) => void;
    mocks.prepareAttachments.mockImplementationOnce(
      () =>
        new Promise<[]>((resolve) => {
          prepared = resolve;
        }),
    );
    const engine = mount([chat("stale-steer", { busy: true })]);
    await act(async () => {
      engine().onSubmit("stale-steer", "follow-up", [], {
        followUpBehavior: "steer",
      });
    });
    act(() =>
      engine().applySessionDeltas(
        [
          { kind: "remove", id: "stale-steer" },
          { kind: "admit", session: chat("stale-steer") },
        ],
        "immediate",
      ),
    );
    await act(async () => {
      prepared([]);
    });
    expect(mocks.steer).not.toHaveBeenCalled();
  });

  it("buffers edited-resend events until provider acceptance", async () => {
    let sink!: (event: HarnessEvent) => void;
    let accept!: () => void;
    mocks.send.mockImplementation((input) => {
      sink = input.onEvent;
      accept = input.onAccepted;
      return new Promise(() => {});
    });
    const engine = mount([chat("edited", { harness: "pi" })]);
    await act(async () => {
      engine().onSubmit("edited", "replacement", [], { resendEdited: true });
    });
    act(() => {
      sink({ type: "status", text: "pending acceptance" });
      engine().flushHarnessEvents();
    });
    expect(engine().sessions[0].blocks[0].text).toBe("previous");
    expect(
      engine().sessions[0].blocks.some(
        (block) => block.text === "pending acceptance",
      ),
    ).toBe(false);
    act(() => {
      accept();
      engine().flushHarnessEvents();
    });
    expect(engine().sessions[0].blocks[0].text).toBe("replacement");
    expect(
      engine().sessions[0].blocks.some(
        (block) => block.text === "pending acceptance",
      ),
    ).toBe(true);
  });

  it("rejects edited-resend acceptance after the session is replaced", async () => {
    let accept!: () => void;
    mocks.send.mockImplementation((input) => {
      accept = input.onAccepted;
      return new Promise(() => {});
    });
    const engine = mount([chat("edited", { harness: "pi" })]);
    await act(async () => {
      engine().onSubmit("edited", "replacement", [], { resendEdited: true });
    });
    const replacement = chat("edited", {
      harness: "pi",
      title: "new incarnation",
    });
    act(() =>
      engine().applySessionDeltas(
        [
          { kind: "remove", id: "edited" },
          { kind: "admit", session: replacement },
        ],
        "immediate",
      ),
    );
    act(() => accept());
    expect(engine().sessions[0]).toBe(replacement);
  });

  it("keeps paused queue dormant until explicit resume and claims its head once", async () => {
    const engine = mount([
      chat("paused", {
        queueStatus: "paused",
        queuedMessages: [{ id: "head", text: "next", attachments: [] }],
      }),
    ]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mocks.send).not.toHaveBeenCalled();
    act(() => engine().onResumeQueue("paused"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(engine().sessions[0].queuedMessages).toBeUndefined();
  });

  it("compacts through the engine and rejects stale completion after stop", async () => {
    let finish!: () => void;
    let sink!: (event: HarnessEvent) => void;
    mocks.canCompact.mockReturnValue(true);
    mocks.compact.mockImplementation((input) => {
      sink = input.onEvent;
      return new Promise<void>((resolve) => {
        finish = resolve;
      });
    });
    const engine = mount([chat("compact")]);
    act(() => expect(engine().onCompactContext("compact")).toBe(true));
    expect(engine().sessions[0].busy).toBe(true);
    act(() => engine().onStop("compact"));
    act(() =>
      engine().updateSession("compact", (session) => ({
        ...session,
        busy: true,
      })),
    );
    await act(async () => {
      sink({ type: "session.error", message: "old compaction" });
      finish();
    });
    expect(engine().sessions[0].busy).toBe(true);
    expect(
      engine().sessions[0].blocks.some((block) =>
        block.text.includes("old compaction"),
      ),
    ).toBe(false);
  });

  it("retired engine callbacks do not enqueue events or finalize checkpoints", async () => {
    let finish!: () => void;
    let sink!: (event: HarnessEvent) => void;
    mocks.send.mockImplementation((input) => {
      sink = input.onEvent;
      return new Promise<void>((resolve) => {
        finish = resolve;
      });
    });
    const engine = mount([chat("retired")]);
    await act(async () => {
      engine().onSubmit("retired", "first");
    });
    const checkpointsBefore = mocks.checkpoint.mock.calls.length;
    act(() => roots[0].unmount());
    await act(async () => {
      sink({ type: "session.error", message: "retired" });
      finish();
    });
    expect(mocks.checkpoint).toHaveBeenCalledTimes(checkpointsBefore);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("owns state independently and preserves scheduled updates until React commits", () => {
    const a = chat("same");
    const first = mount([a]);
    const second = mount([chat("same")]);
    act(() => {
      first().updateSession("same", (current) => ({
        ...current,
        title: "changed",
      }));
      expect(first().sessionsRef.current[0]).toBe(a);
    });
    expect(first().sessions[0].title).toBe("changed");
    expect(second().sessions[0].title).toBe("named");
    expect("setSessions" in first()).toBe(false);
  });

  it("claims and executes one queued head once after its editing hold clears", async () => {
    const engine = mount([
      chat("queue", {
        editingQueuedMessageId: "head",
        queuedMessages: [{ id: "head", text: "next", attachments: [] }],
      }),
    ]);
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    expect(mocks.send).not.toHaveBeenCalled();
    act(() => engine().onQueuedMessageEditingChange("queue"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(engine().sessions[0].queuedMessages).toBeUndefined();
    expect(engine().sessions[0].busy).toBe(false);
  });

  it("rejects stale provider events and finalization after stop and another turn", async () => {
    const turns: Array<{
      onEvent: (event: HarnessEvent) => void;
      finish: () => void;
    }> = [];
    mocks.send.mockImplementation(
      (input) =>
        new Promise<void>((finish) =>
          turns.push({ onEvent: input.onEvent, finish }),
        ),
    );
    const engine = mount([chat("turn")]);
    await act(async () => {
      engine().onSubmit("turn", "first");
    });
    act(() => engine().onStop("turn"));
    await act(async () => {
      engine().onSubmit("turn", "second");
    });
    await act(async () => {
      turns[0].onEvent({ type: "session.error", message: "obsolete" });
      turns[0].finish();
      engine().flushHarnessEvents();
    });
    expect(engine().sessions[0].busy).toBe(true);
    expect(
      engine().sessions[0].blocks.some((block) =>
        block.text.includes("obsolete"),
      ),
    ).toBe(false);
    await act(async () => {
      turns[1].finish();
    });
    expect(engine().sessions[0].busy).toBe(false);
  });

  it("invalidates an atomic same-ID replacement before old queued events or finalization", async () => {
    let sink!: (event: HarnessEvent) => void;
    let finish!: () => void;
    mocks.send.mockImplementation((input) => {
      sink = input.onEvent;
      return new Promise<void>((resolve) => {
        finish = resolve;
      });
    });
    const engine = mount([chat("atomic")]);
    await act(async () => {
      engine().onSubmit("atomic", "first");
    });
    act(() => {
      sink({ type: "status", text: "old queued" });
      engine().applySessionDeltas(
        [
          { kind: "remove", id: "atomic" },
          { kind: "admit", session: chat("atomic", { busy: true }) },
        ],
        "immediate",
      );
      engine().flushHarnessEvents();
    });
    await act(async () => {
      sink({ type: "session.error", message: "old sink" });
      finish();
    });
    expect(engine().sessions[0].busy).toBe(true);
    expect(
      engine().sessions[0].blocks.some(
        (block) =>
          block.text === "old queued" || block.text.includes("old sink"),
      ),
    ).toBe(false);
  });

  it("does not apply already queued old events to a same-ID replacement", async () => {
    let sink!: (event: HarnessEvent) => void;
    mocks.send.mockImplementation((input) => {
      sink = input.onEvent;
      return new Promise(() => {});
    });
    const engine = mount([chat("replace")]);
    await act(async () => {
      engine().onSubmit("replace", "first");
    });
    act(() => {
      sink({ type: "status", text: "old queued" });
      engine().removeSession("replace", "immediate");
      engine().admitSession(chat("replace"), "immediate");
      engine().flushHarnessEvents();
    });
    expect(
      engine().sessions[0].blocks.some((block) => block.text === "old queued"),
    ).toBe(false);
  });
});
