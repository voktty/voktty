import { afterEach, describe, expect, it, vi } from "vitest";
import { resetHarnessModelOverlays, setHarnessModels } from "../models";
import {
  cancelHarnessTurn,
  forgetHarnessSession,
  HARNESS_IDLE_PARK_MS,
  type HarnessAdapter,
  isLiveHarness,
  listHarnesses,
  refreshHarnessCatalogs,
  registerHarness,
  resetHarnessIdlePark,
  sendHarnessTurn,
} from "./registry";
import type { SendTurnInput, SteerTurnInput } from "./types";

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

  it("forgets the previous provider before another provider claims the child", async () => {
    const order: string[] = [];
    registerHarness(
      stub("codex", {
        async sendTurn() {
          order.push("codex:send");
        },
        async forgetSession() {
          order.push("codex:forget");
        },
      }),
    );
    registerHarness(
      stub("claude", {
        async sendTurn() {
          order.push("claude:send");
        },
      }),
    );

    const input = {
      sessionId: "shared",
      cwd: "/tmp",
      text: "hi",
      runtimeMode: "supervised" as const,
      onEvent: () => undefined,
    };
    await sendHarnessTurn({ ...input, harness: "codex", model: "codex:x" });
    await sendHarnessTurn({ ...input, harness: "claude", model: "claude:y" });

    expect(order).toEqual(["codex:send", "codex:forget", "claude:send"]);
  });

  it("ignores stale cleanup after a new provider owns the session", async () => {
    const cancelCodex = vi.fn(async () => undefined);
    const forgetCodex = vi.fn(async () => undefined);
    const cancelClaude = vi.fn(async () => undefined);
    registerHarness(
      stub("codex", {
        cancelTurn: cancelCodex,
        forgetSession: forgetCodex,
      }),
    );
    registerHarness(stub("claude", { cancelTurn: cancelClaude }));

    const input = {
      sessionId: "shared",
      cwd: "/tmp",
      text: "hi",
      runtimeMode: "supervised" as const,
      onEvent: () => undefined,
    };
    await sendHarnessTurn({ ...input, harness: "codex", model: "codex:x" });
    await sendHarnessTurn({ ...input, harness: "claude", model: "claude:y" });
    forgetCodex.mockClear();

    await cancelHarnessTurn("codex", "shared");
    await forgetHarnessSession("codex", "shared");

    expect(cancelCodex).not.toHaveBeenCalled();
    expect(forgetCodex).not.toHaveBeenCalled();
    expect(cancelClaude).not.toHaveBeenCalled();
  });

  it("releases a failed provider so another provider can recover the session", async () => {
    const stopCodex = vi.fn(async () => undefined);
    const sendClaude = vi.fn(async () => undefined);
    registerHarness(
      stub("codex", {
        async sendTurn() {
          throw new Error("startup failed");
        },
        stopSession: stopCodex,
      }),
    );
    registerHarness(stub("claude", { sendTurn: sendClaude }));
    const input = {
      sessionId: "recover",
      cwd: "/tmp",
      text: "hi",
      runtimeMode: "supervised" as const,
      onEvent: () => undefined,
    };

    await expect(
      sendHarnessTurn({ ...input, harness: "codex", model: "codex:x" }),
    ).rejects.toThrow("startup failed");
    await sendHarnessTurn({ ...input, harness: "claude", model: "claude:y" });

    expect(stopCodex).toHaveBeenCalledWith("recover");
    expect(sendClaude).toHaveBeenCalledOnce();
  });

  it("lets the next provider start even when stale cleanup reports an error", async () => {
    const sendClaude = vi.fn(async () => undefined);
    registerHarness(
      stub("codex", {
        async forgetSession() {
          throw new Error("already exited");
        },
      }),
    );
    registerHarness(stub("claude", { sendTurn: sendClaude }));
    const input = {
      sessionId: "recover-cleanup",
      cwd: "/tmp",
      text: "hi",
      runtimeMode: "supervised" as const,
      onEvent: () => undefined,
    };

    await sendHarnessTurn({ ...input, harness: "codex", model: "codex:x" });
    await sendHarnessTurn({ ...input, harness: "claude", model: "claude:y" });

    expect(sendClaude).toHaveBeenCalledOnce();
  });
});
