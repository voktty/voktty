import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PreviewPaneHandle } from "../PreviewPane";
import { usePreviewHandleStore } from "../store/previewHandleStore";
import { usePreviewDevtoolsStore } from "../store/previewDevtoolsStore";
import {
  runBrowserClick,
  runBrowserNavigate,
  runBrowserSnapshot,
  getBrowserNetworkLog,
  NO_ACTIVE_PREVIEW,
} from "./browserCommands";

function fakeHandle(
  send: (command: string, args?: unknown) => Promise<unknown>,
  navigate = vi.fn(),
): PreviewPaneHandle {
  return {
    reload: () => {},
    focusAddressBar: () => {},
    getUrl: () => "http://localhost:3000",
    navigate,
    sendBrowserCommand: <T>(command: string, args?: unknown) =>
      send(command, args) as Promise<T>,
  };
}

describe("browserCommands", () => {
  beforeEach(() => {
    usePreviewHandleStore.setState({ handles: new Map(), activeTabId: null });
    usePreviewDevtoolsStore.getState().clearNetwork();
  });

  it("returns no_active_preview when nothing is registered", async () => {
    expect(await runBrowserSnapshot()).toEqual(NO_ACTIVE_PREVIEW);
    expect(await runBrowserClick({ selector: "button" })).toMatchObject({
      error: "no_active_preview",
    });
  });

  it("sends snapshot and click through the active handle", async () => {
    const send = vi.fn(async (command: string) => {
      if (command === "snapshot") return { nodes: [{ ref: 1, tag: "button" }] };
      return { ok: true };
    });
    usePreviewHandleStore.getState().registerHandle(1, fakeHandle(send));

    const snapshot = await runBrowserSnapshot();
    expect(snapshot).toEqual({
      ok: true,
      result: { nodes: [{ ref: 1, tag: "button" }] },
    });

    const click = await runBrowserClick({ selector: "button.pay" });
    expect(click.ok).toBe(true);
    expect(send).toHaveBeenCalledWith("click", {
      ref: undefined,
      selector: "button.pay",
    });
  });

  it("maps iframe errors to a typed failure", async () => {
    usePreviewHandleStore.getState().registerHandle(
      1,
      fakeHandle(async () => {
        throw new Error("element_not_found");
      }),
    );
    const result = await runBrowserClick({ ref: 99 });
    expect(result).toEqual({
      ok: false,
      error: "element_not_found",
      message: "element_not_found",
    });
  });

  it("navigates only loopback urls on the handle", () => {
    const navigate = vi.fn();
    usePreviewHandleStore.getState().registerHandle(
      1,
      fakeHandle(async () => ({}), navigate),
    );
    expect(runBrowserNavigate("http://localhost:5173")).toEqual({
      ok: true,
      url: "http://localhost:5173",
    });
    expect(navigate).toHaveBeenCalledWith("http://localhost:5173");
    expect(runBrowserNavigate("https://example.com")).toMatchObject({
      error: "url_not_local",
    });
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it("reads the network ring buffer", () => {
    usePreviewDevtoolsStore.getState().addNetworkEntry({
      id: "n1",
      method: "GET",
      url: "http://localhost:3000/api",
      status: 200,
      durationMs: 12,
      size: 40,
      timestamp: 1,
    });
    expect(getBrowserNetworkLog().entries).toHaveLength(1);
  });
});
