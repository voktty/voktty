import { afterEach, describe, expect, it, vi } from "vitest";
import {
  hasLiveCatalog,
  modelsFor,
  resetHarnessModelOverlays,
  setHarnessModels,
} from "../models";
import type { HarnessId } from "../session";
import {
  HARNESS_IDLE_PARK_MS,
  bindHarnessSession,
  canCompactHarnessContext,
  compactHarnessContext,
  isLiveHarness,
  listHarnesses,
  refreshHarnessCatalogs,
  registerHarness,
  resetHarnessIdlePark,
  sendHarnessTurn,
  steerHarnessTurn,
  rewindHarnessLastTurn,
  cancelHarnessTurn,
  forgetHarnessSession,
  stopHarnessSession,
  respondHarnessApproval,
  respondHarnessQuestion,
  keepHarnessQuestionOpen,
  type HarnessAdapter,
} from "./registry";
import type { SendTurnInput, SteerTurnInput } from "./types";
import { registerBuiltinHarnesses } from "./register";

function stub(
  id: "cursor" | "codex" | "claude" | "pi",
  extra: Partial<HarnessAdapter> = {},
): HarnessAdapter {
  return {
    id,
    live: true,
    async sendTurn(_input: SendTurnInput) {},
    async steerTurn(_input: SteerTurnInput) {},
    async cancelTurn() {},
    respondApproval() {},
    async stopSession() {},
    async forgetSession() {},
    bindSession() {},
    ...extra,
  };
}

describe("harness registry", () => {
  afterEach(() => {
    resetHarnessModelOverlays();
    resetHarnessIdlePark();
    vi.useRealTimers();
  });

  it("tracks live adapters", () => {
    registerHarness(stub("cursor"));
    registerHarness(stub("codex"));
    registerHarness(stub("claude"));
    expect(isLiveHarness("cursor")).toBe(true);
    expect(isLiveHarness("codex")).toBe(true);
    expect(isLiveHarness("claude")).toBe(true);
    expect(
      listHarnesses()
        .map((a) => a.id)
        .filter((id) => id === "claude" || id === "codex" || id === "cursor")
        .sort(),
    ).toEqual(["claude", "codex", "cursor"]);
  });

  it("advertises and dispatches compaction only when an adapter supports it", async () => {
    const compactContext = vi.fn(async () => undefined);
    registerHarness(stub("codex", { compactContext }));
    registerHarness(stub("claude"));

    expect(canCompactHarnessContext("codex")).toBe(true);
    expect(canCompactHarnessContext("claude")).toBe(false);

    await compactHarnessContext({
      harness: "codex",
      sessionId: "compact-1",
      cwd: "/tmp",
      model: "codex:gpt-5.4",
      runtimeMode: "supervised",
      onEvent: () => undefined,
    });

    expect(compactContext).toHaveBeenCalledOnce();
    await expect(
      compactHarnessContext({
        harness: "claude",
        sessionId: "compact-2",
        cwd: "/tmp",
        model: "claude:sonnet",
        runtimeMode: "supervised",
        onEvent: () => undefined,
      }),
    ).rejects.toThrow("does not support manual compaction");
  });

  it("exposes the native compaction support matrix", () => {
    registerBuiltinHarnesses();
    const ids: HarnessId[] = [
      "claude",
      "codex",
      "cursor",
      "grok",
      "opencode",
      "pi",
      "omp",
      "fx",
    ];

    expect(
      Object.fromEntries(ids.map((id) => [id, canCompactHarnessContext(id)])),
    ).toEqual({
      claude: true,
      codex: true,
      cursor: false,
      grok: true,
      opencode: true,
      pi: true,
      omp: true,
      fx: false,
    });
  });

  it("refreshes only the requested catalogs", async () => {
    const pi = vi.fn(async () => undefined);
    const claude = vi.fn(async () => undefined);
    registerHarness(stub("pi", { refreshCatalog: pi }));
    registerHarness(stub("claude", { refreshCatalog: claude }));

    await refreshHarnessCatalogs(["claude"]);

    expect(claude).toHaveBeenCalledOnce();
    expect(pi).not.toHaveBeenCalled();
  });

  it("does not spawn a catalog probe twice after a live list lands", async () => {
    const pi = vi.fn(async () => {
      setHarnessModels("pi", [
        {
          id: "pi:opus",
          harness: "pi",
          name: "Opus",
          nativeId: "anthropic/opus",
        },
      ]);
    });
    registerHarness(stub("pi", { refreshCatalog: pi }));

    await refreshHarnessCatalogs(["pi"]);
    await refreshHarnessCatalogs(["pi"]);

    expect(pi).toHaveBeenCalledOnce();
  });

  it("refreshes Pi when fallback models are visible but no live catalog exists", async () => {
    const pi = vi.fn(async () => undefined);
    registerHarness(stub("pi", { refreshCatalog: pi }));

    expect(modelsFor("pi").length).toBeGreaterThan(0);
    expect(hasLiveCatalog("pi")).toBe(false);

    await refreshHarnessCatalogs(["pi"]);

    expect(pi).toHaveBeenCalledOnce();
  });

  it("forces a catalog probe past the live-list skip on request", async () => {
    const pi = vi.fn(async () => {
      setHarnessModels("pi", [
        {
          id: "pi:opus",
          harness: "pi",
          name: "Opus",
          nativeId: "anthropic/opus",
        },
      ]);
    });
    registerHarness(stub("pi", { refreshCatalog: pi }));

    await refreshHarnessCatalogs(["pi"]);
    await refreshHarnessCatalogs(["pi"], { force: true });

    expect(pi).toHaveBeenCalledTimes(2);
  });

  it("skips catalog refresh when no harness is in use", async () => {
    const pi = vi.fn(async () => undefined);
    registerHarness(stub("pi", { refreshCatalog: pi }));
    await refreshHarnessCatalogs([]);
    expect(pi).not.toHaveBeenCalled();
  });

  it("parks a live child a few minutes after the turn settles", async () => {
    vi.useFakeTimers();
    const stopSession = vi.fn(async () => undefined);
    registerHarness(stub("cursor", { stopSession }));

    await sendHarnessTurn({
      harness: "cursor",
      sessionId: "s1",
      cwd: "/tmp",
      model: "cursor:composer-2.5",
      text: "hi",
      runtimeMode: "supervised",
      onEvent: () => undefined,
    });

    expect(stopSession).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(HARNESS_IDLE_PARK_MS - 1);
    expect(stopSession).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(stopSession).toHaveBeenCalledWith("s1");
  });

  it("binds a restored session and forwards its task panels", () => {
    const bindSession = vi.fn();
    const restoreTaskLists = vi.fn();
    registerHarness(stub("claude", { bindSession, restoreTaskLists }));
    const taskList = {
      key: "claude-tasks",
      items: [{ id: "1", text: "Write tests", status: "pending" as const }],
    };

    bindHarnessSession("claude", "s1", "sess_1", "/repo", "work", [
      { id: "b1", role: "user", text: "go" },
      { id: "b2", role: "tasks", text: "Write tests", taskList },
    ]);
    bindHarnessSession("claude", "s2", "sess_2", "/repo");

    expect(bindSession).toHaveBeenCalledWith("s1", "sess_1", "/repo", "work");
    expect(bindSession).toHaveBeenCalledWith(
      "s2",
      "sess_2",
      "/repo",
      undefined,
    );
    expect(restoreTaskLists).toHaveBeenCalledTimes(1);
    expect(restoreTaskLists).toHaveBeenCalledWith("s1", [taskList]);
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function idleTurn(harness: HarnessId = "codex", sessionId = "shared") {
  return {
    harness,
    sessionId,
    cwd: "/repo",
    model: "model",
    text: "hello",
    runtimeMode: "supervised" as const,
    onEvent: vi.fn<(event: import("./types").HarnessEvent) => void>(),
  };
}

describe("owned idle parking", () => {
  it("does not stop an adapter disabled before its timer fires", async () => {
    vi.useFakeTimers();
    const stopSession = vi.fn(async () => undefined);
    const adapter = stub("codex", { stopSession });
    registerHarness(adapter);
    await sendHarnessTurn(idleTurn());
    adapter.live = false;
    await vi.advanceTimersByTimeAsync(HARNESS_IDLE_PARK_MS);
    expect(stopSession).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["compact", "rewind", "cancel"] as const)(
    "rejects stale %s settlement after binding a replacement",
    async (kind) => {
      vi.useFakeTimers();
      const old = deferred<void>();
      const next = deferred<void>();
      const stopSession = vi.fn(async () => undefined);
      registerHarness(
        stub("codex", {
          sendTurn: () => next.promise,
          compactContext: () => old.promise,
          rewindLastTurn: async () => {
            await old.promise;
            return { submitted: false };
          },
          cancelTurn: () => old.promise,
          stopSession,
        }),
      );
      const input = idleTurn();
      const previous =
        kind === "compact"
          ? compactHarnessContext(input)
          : kind === "rewind"
            ? rewindHarnessLastTurn(input)
            : cancelHarnessTurn("codex", "shared");
      bindHarnessSession("codex", "shared", "same-provider-id", "/repo");
      const current = sendHarnessTurn(input);
      old.resolve();
      await previous;
      await vi.advanceTimersByTimeAsync(HARNESS_IDLE_PARK_MS);
      expect(stopSession).not.toHaveBeenCalled();
      next.resolve();
      await current;
      await vi.advanceTimersByTimeAsync(HARNESS_IDLE_PARK_MS);
      expect(stopSession).toHaveBeenCalledOnce();
    },
  );

  it("keeps overflowed input held until its incarnation is invalidated", async () => {
    vi.useFakeTimers();
    let captured: SendTurnInput | undefined;
    const stopSession = vi.fn(async () => undefined);
    registerHarness(
      stub("codex", {
        sendTurn: async (input) => {
          captured = input;
        },
        stopSession,
      }),
    );
    await sendHarnessTurn(idleTurn());
    expect(captured).toBeDefined();
    for (let id = 0; id < 257; id++)
      captured?.onEvent({
        type: "approval.requested",
        requestId: id,
        title: "Confirm",
      });
    for (let id = 0; id < 257; id++)
      captured?.onEvent({
        type: "approval.resolved",
        requestId: id,
        decision: "allow",
      });
    await vi.advanceTimersByTimeAsync(HARNESS_IDLE_PARK_MS);
    expect(stopSession).not.toHaveBeenCalled();
    bindHarnessSession("codex", "shared", "same-provider-id", "/repo");
    await sendHarnessTurn(idleTurn());
    await vi.advanceTimersByTimeAsync(HARNESS_IDLE_PARK_MS);
    expect(stopSession).toHaveBeenCalledOnce();
  });

  afterEach(() => {
    resetHarnessIdlePark();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it.each(["forget", "bind", "stop", "replace", "reset"] as const)(
    "does not park a replacement after old settlement following %s",
    async (action) => {
      vi.useFakeTimers();
      const old = deferred<void>();
      const next = deferred<void>();
      const stopSession = vi.fn(async () => undefined);
      const adapter = stub("codex", {
        sendTurn: vi
          .fn()
          .mockReturnValueOnce(old.promise)
          .mockReturnValueOnce(next.promise),
        stopSession,
      });
      registerHarness(adapter);
      const oldTurn = sendHarnessTurn(idleTurn());
      if (action === "forget") await forgetHarnessSession("codex", "shared");
      if (action === "bind")
        bindHarnessSession("codex", "shared", "same-provider-id", "/repo");
      if (action === "stop") await stopHarnessSession("codex", "shared");
      if (action === "reset") resetHarnessIdlePark();
      if (action === "replace")
        registerHarness(
          stub("codex", { sendTurn: () => next.promise, stopSession }),
        );
      stopSession.mockClear();
      const nextTurn = sendHarnessTurn(idleTurn());
      old.resolve();
      await oldTurn;
      await vi.advanceTimersByTimeAsync(HARNESS_IDLE_PARK_MS);
      expect(stopSession).not.toHaveBeenCalled();
      next.resolve();
      await nextTurn;
      await vi.advanceTimersByTimeAsync(HARNESS_IDLE_PARK_MS);
      expect(stopSession).toHaveBeenCalledOnce();
    },
  );

  it.each(["send", "compact", "rewind", "steer", "cancel"] as const)(
    "waits for all concurrent operations including %s",
    async (kind) => {
      vi.useFakeTimers();
      const pending = deferred<void>();
      const stopSession = vi.fn(async () => undefined);
      registerHarness(
        stub("codex", {
          sendTurn: () => pending.promise,
          compactContext: () => pending.promise,
          rewindLastTurn: async () => {
            await pending.promise;
            return { submitted: false };
          },
          steerTurn: () => pending.promise,
          cancelTurn: () => pending.promise,
          stopSession,
        }),
      );
      const input = idleTurn();
      const active =
        kind === "send"
          ? sendHarnessTurn(input)
          : kind === "compact"
            ? compactHarnessContext(input)
            : kind === "rewind"
              ? rewindHarnessLastTurn(input)
              : kind === "steer"
                ? steerHarnessTurn(input)
                : cancelHarnessTurn("codex", "shared");
      await cancelHarnessTurn("claude", "unrelated");
      registerHarness(stub("claude", { stopSession }));
      await sendHarnessTurn(idleTurn("claude"));
      await vi.advanceTimersByTimeAsync(HARNESS_IDLE_PARK_MS);
      expect(stopSession).toHaveBeenCalledTimes(1);
      expect(stopSession).toHaveBeenCalledWith("shared");
      stopSession.mockClear();
      pending.resolve();
      await active;
      await vi.advanceTimersByTimeAsync(HARNESS_IDLE_PARK_MS);
      expect(stopSession).toHaveBeenCalledOnce();
    },
  );

  it("does not park after one of two same-adapter operations finishes", async () => {
    vi.useFakeTimers();
    const pending = deferred<void>();
    const stopSession = vi.fn(async () => undefined);
    registerHarness(
      stub("codex", { sendTurn: () => pending.promise, stopSession }),
    );
    const active = sendHarnessTurn(idleTurn());
    await cancelHarnessTurn("codex", "shared");
    await vi.advanceTimersByTimeAsync(HARNESS_IDLE_PARK_MS);
    expect(stopSession).not.toHaveBeenCalled();
    pending.resolve();
    await active;
    await vi.advanceTimersByTimeAsync(HARNESS_IDLE_PARK_MS);
    expect(stopSession).toHaveBeenCalledOnce();
  });

  it("ignores a cached timer delivered after cancellation and after rearming", async () => {
    vi.useFakeTimers();
    const timer = vi.spyOn(globalThis, "setTimeout");
    const stopSession = vi.fn(async () => undefined);
    registerHarness(stub("codex", { stopSession }));
    await sendHarnessTurn(idleTurn());
    const callback = timer.mock.calls[timer.mock.calls.length - 1]?.[0];
    expect(typeof callback).toBe("function");
    await sendHarnessTurn(idleTurn());
    if (typeof callback === "function") callback();
    expect(stopSession).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(HARNESS_IDLE_PARK_MS);
    expect(stopSession).toHaveBeenCalledOnce();
  });

  it("keeps equal session IDs in sibling adapters independently parked", async () => {
    vi.useFakeTimers();
    const codexStop = vi.fn(async () => undefined);
    const claudeStop = vi.fn(async () => undefined);
    registerHarness(stub("codex", { stopSession: codexStop }));
    registerHarness(stub("claude", { stopSession: claudeStop }));
    await sendHarnessTurn(idleTurn());
    await sendHarnessTurn(idleTurn("claude"));
    await vi.advanceTimersByTimeAsync(HARNESS_IDLE_PARK_MS);
    expect(codexStop).toHaveBeenCalledOnce();
    expect(claudeStop).toHaveBeenCalledOnce();
  });

  it.each(["approval", "question"] as const)(
    "holds late %s events between turns",
    async (kind) => {
      vi.useFakeTimers();
      let captured!: SendTurnInput;
      const stopSession = vi.fn(async () => undefined);
      registerHarness(
        stub("codex", {
          sendTurn: async (input) => {
            captured = input;
          },
          stopSession,
        }),
      );
      const input = idleTurn();
      await sendHarnessTurn(input);
      captured.onEvent(
        kind === "approval"
          ? { type: "approval.requested", requestId: 1, title: "approve" }
          : { type: "question.asked", requestId: 1, questions: [] },
      );
      expect(input.onEvent).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(HARNESS_IDLE_PARK_MS);
      expect(stopSession).not.toHaveBeenCalled();
      captured.onEvent(
        kind === "approval"
          ? { type: "approval.resolved", requestId: 1, decision: "allow" }
          : { type: "question.resolved", requestId: 1, decision: "answered" },
      );
      await vi.advanceTimersByTimeAsync(HARNESS_IDLE_PARK_MS);
      expect(stopSession).toHaveBeenCalledOnce();
    },
  );

  it.each(["approval", "question", "keep"] as const)(
    "restarts idle delay for synchronous %s activity",
    async (kind) => {
      vi.useFakeTimers();
      const stopSession = vi.fn(async () => undefined);
      registerHarness(
        stub("codex", {
          stopSession,
          respondQuestion() {},
          keepQuestionOpen() {},
        }),
      );
      await sendHarnessTurn(idleTurn());
      await vi.advanceTimersByTimeAsync(HARNESS_IDLE_PARK_MS - 1);
      if (kind === "approval")
        respondHarnessApproval("codex", "shared", 1, "allow");
      if (kind === "question")
        respondHarnessQuestion("codex", "shared", 1, { kind: "skipped" });
      if (kind === "keep") keepHarnessQuestionOpen("codex", "shared", 1);
      await vi.advanceTimersByTimeAsync(1);
      expect(stopSession).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(HARNESS_IDLE_PARK_MS - 1);
      expect(stopSession).toHaveBeenCalledOnce();
    },
  );

  it("observes parking failures without unhandled rejection", async () => {
    vi.useFakeTimers();
    registerHarness(
      stub("codex", {
        stopSession: async () => {
          throw new Error("private-provider-detail");
        },
      }),
    );
    await sendHarnessTurn(idleTurn());
    await vi.advanceTimersByTimeAsync(HARNESS_IDLE_PARK_MS);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds live entries before dispatch without cancelling an admitted timer", async () => {
    vi.useFakeTimers();
    const sendTurn = vi.fn(async () => undefined);
    registerHarness(stub("codex", { sendTurn }));
    for (let i = 0; i < 256; i++)
      await sendHarnessTurn(idleTurn("codex", `entry-${i}`));
    const refused = idleTurn("codex", "private-session");
    await expect(sendHarnessTurn(refused)).rejects.toThrow(
      "HARNESS_ACTIVITY_CAPACITY",
    );
    expect(sendTurn).toHaveBeenCalledTimes(256);
    expect(refused.onEvent).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(256);
    await forgetHarnessSession("codex", "entry-0");
    await sendHarnessTurn(refused);
    expect(sendTurn).toHaveBeenCalledTimes(257);
  });

  it("retains pending-operation budget through reset and invalidation", async () => {
    vi.useFakeTimers();
    const pending = deferred<void>();
    const sendTurn = vi.fn(() => pending.promise);
    registerHarness(stub("codex", { sendTurn }));
    const turns = Array.from({ length: 256 }, () =>
      sendHarnessTurn(idleTurn()),
    );
    resetHarnessIdlePark();
    bindHarnessSession("codex", "shared", "same-provider-id", "/repo");
    await expect(sendHarnessTurn(idleTurn())).rejects.toThrow(
      "HARNESS_ACTIVITY_CAPACITY",
    );
    expect(sendTurn).toHaveBeenCalledTimes(256);
    pending.resolve();
    await Promise.all(turns);
    expect(vi.getTimerCount()).toBe(0);
    await sendHarnessTurn(idleTurn());
    expect(vi.getTimerCount()).toBe(1);
  });
});

describe("remote projects", () => {
  afterEach(() => resetHarnessIdlePark());

  const turn = (harness: "cursor" | "codex", cwd: string) =>
    ({
      harness,
      sessionId: "s1",
      cwd,
      model: "m",
      text: "hi",
    }) as SendTurnInput & { harness: HarnessId };

  it("refuses a harness without a remote path before its adapter runs", async () => {
    const sendTurn = vi.fn(async () => {});
    registerHarness(stub("cursor", { sendTurn }));
    await expect(
      sendHarnessTurn(turn("cursor", "remote://voktty-ssh-p1/srv/app")),
    ).rejects.toThrow(/cursor cannot run on a remote host/);
    expect(sendTurn).not.toHaveBeenCalled();
  });

  it("lets supported agents and local projects through", async () => {
    const remoteSend = vi.fn(async () => {});
    const localSend = vi.fn(async () => {});
    registerHarness(stub("codex", { sendTurn: remoteSend }));
    await sendHarnessTurn(turn("codex", "remote://voktty-ssh-p1/srv/app"));
    expect(remoteSend).toHaveBeenCalledOnce();

    registerHarness(stub("cursor", { sendTurn: localSend }));
    await sendHarnessTurn(turn("cursor", "/home/me/app"));
    expect(localSend).toHaveBeenCalledOnce();
  });
});
