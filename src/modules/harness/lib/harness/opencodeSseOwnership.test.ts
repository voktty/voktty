// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(
    async (_command: string, _args?: Record<string, unknown>) => undefined,
  ),
  handlers: new Map<string, (event: { payload: unknown }) => void>(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (
    name: string,
    handler: (event: { payload: unknown }) => void,
  ) => {
    mocks.handlers.set(name, handler);
    return () => {
      if (mocks.handlers.get(name) === handler) mocks.handlers.delete(name);
    };
  },
}));

let release: (() => void) | undefined;
afterEach(() => {
  release?.();
  release = undefined;
  mocks.handlers.clear();
  mocks.invoke.mockClear();
});

async function fixture() {
  vi.resetModules();
  const child = await import("./child");
  const { OpenCodeClient } = await import("./opencodeClient");
  release = await child.acquireHarnessBridge();
  return { child, OpenCodeClient };
}
function nativeIds() {
  return vi
    .mocked(mocks.invoke)
    .mock.calls.filter((call) => call[0] === "harness_sse_open")
    .map((call) => call[1]?.sessionId);
}

describe("OpenCode SSE owner cleanup", () => {
  it("does not let an old client close a replacement client's logical session", async () => {
    const { OpenCodeClient } = await fixture();
    const old = new OpenCodeClient("http://127.0.0.1:1", "/old");
    const current = new OpenCodeClient("http://127.0.0.1:1", "/current");
    const onEvent = vi.fn();
    await old.subscribeEvents("same", vi.fn());
    await current.subscribeEvents("same", onEvent);
    const nativeId = nativeIds()[1];
    mocks.invoke.mockClear();
    await old.closeEvents("same");
    expect(mocks.invoke).not.toHaveBeenCalled();
    mocks.handlers.get("harness-sse")?.({
      payload: {
        sessionId: nativeId,
        data: JSON.stringify({ type: "current" }),
      },
    });
    expect(onEvent).toHaveBeenCalledExactlyOnceWith({ type: "current" });
    await current.closeEvents("same");
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith("harness_sse_close", {
      sessionId: nativeId,
    });
  });

  it("does not close another client's stream when this client never subscribed", async () => {
    const { OpenCodeClient } = await fixture();
    const current = new OpenCodeClient("http://127.0.0.1:1", "/current");
    await current.subscribeEvents("same", vi.fn());
    mocks.invoke.mockClear();
    await new OpenCodeClient("http://127.0.0.1:1", "/other").closeEvents(
      "same",
    );
    expect(mocks.invoke).not.toHaveBeenCalled();
    await current.closeEvents("same");
  });
});
