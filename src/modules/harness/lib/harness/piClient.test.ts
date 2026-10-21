import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ writeChild: vi.fn() }));

vi.mock("./child", () => ({ writeChild: mocks.writeChild }));

import { PiRpc } from "./piClient";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

afterEach(() => {
  mocks.writeChild.mockReset();
  vi.useRealTimers();
});

describe("PiRpc.request", () => {
  it("captures the optional writer without using the legacy transport", async () => {
    const writer = vi.fn(async () => undefined);
    const rpc = new PiRpc("native", vi.fn(), "omp", writer);
    const result = rpc.request({ type: "get_state", id: "explicit" });
    const accepted = expect(result).resolves.toMatchObject({ id: "explicit" });
    rpc.pushLine(
      JSON.stringify({
        type: "response",
        id: "explicit",
        command: "get_state",
        success: true,
      }),
    );
    await accepted;
    expect(writer).toHaveBeenCalledWith(
      JSON.stringify({ type: "get_state", id: "explicit" }),
    );
    expect(mocks.writeChild).not.toHaveBeenCalled();
    rpc.close();
  });
  it("cleans synchronous writer throws without orphaned pending requests or timers", async () => {
    vi.useFakeTimers();
    const original = new Error("sync write failure");
    const rpc = new PiRpc("native", vi.fn(), "Pi", () => {
      throw original;
    });
    await expect(rpc.request({ type: "prompt", id: "same" })).rejects.toBe(
      original,
    );
    expect(vi.getTimerCount()).toBe(0);
    await expect(rpc.request({ type: "prompt", id: "same" })).rejects.toBe(
      original,
    );
    rpc.close();
  });
  it("does not reject reused explicit ID B when cancelled A writer fails late", async () => {
    let reject!: (error: Error) => void;
    const held = new Promise<void>((_, no) => {
      reject = no;
    });
    void held.catch(() => undefined);
    const writer = vi
      .fn()
      .mockReturnValueOnce(held)
      .mockResolvedValue(undefined);
    mocks.writeChild.mockImplementation(writer);
    const rpc = new PiRpc("native", vi.fn(), "Pi", writer);
    const old = expect(
      rpc.request({ type: "prompt", id: "same" }),
    ).rejects.toThrow("cancelled");
    rpc.cancelRequest("same");
    await old;
    const result = rpc.request({ type: "get_state", id: "same" });
    const accepted = expect(result).resolves.toMatchObject({ id: "same" });
    reject(new Error("old write failure"));
    await Promise.resolve();
    await Promise.resolve();
    rpc.pushLine(
      JSON.stringify({
        type: "response",
        command: "get_state",
        id: "same",
        success: true,
      }),
    );
    await accepted;
    rpc.close();
  });
  it("captured writer preserves asynchronous error identity and close/cancel/deadline controls", async () => {
    vi.useFakeTimers();
    const original = new Error("async original");
    const rpc = new PiRpc("native", vi.fn(), "omp", async () => {
      throw original;
    });
    await expect(rpc.request({ type: "prompt" })).rejects.toBe(original);
    rpc.close();
    const stalled = deferred<void>();
    const controls = new PiRpc("native", vi.fn(), "omp", () => stalled.promise);
    const cancelled = expect(
      controls.request({ type: "prompt", id: "cancel" }),
    ).rejects.toThrow("omp request cancelled");
    controls.cancelRequest("cancel");
    await cancelled;
    const timeout = expect(
      controls.request({ type: "get_state", id: "timeout" }, 100),
    ).rejects.toThrow("omp get_state timed out");
    await vi.advanceTimersByTimeAsync(100);
    await timeout;
    const closed = expect(
      controls.request({ type: "prompt", id: "close" }),
    ).rejects.toBe(original);
    controls.close(original);
    await closed;
    stalled.resolve();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("rejects when the transport write fails", async () => {
    mocks.writeChild.mockRejectedValue(new Error("write failed"));
    const rpc = new PiRpc("probe", vi.fn());

    await expect(rpc.request({ type: "get_commands" })).rejects.toThrow(
      "write failed",
    );
    rpc.close();
  });

  it("times out even when the transport write stalls", async () => {
    vi.useFakeTimers();
    const write = deferred<void>();
    mocks.writeChild.mockReturnValue(write.promise);
    const rpc = new PiRpc("probe", vi.fn());
    const request = rpc.request({ type: "get_commands" }, 100);
    const rejected = expect(request).rejects.toThrow(
      "Pi get_commands timed out",
    );

    await vi.advanceTimersByTimeAsync(100);
    await rejected;

    write.resolve();
    rpc.close();
  });
});
