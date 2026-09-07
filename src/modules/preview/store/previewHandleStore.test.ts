import { beforeEach, describe, expect, it } from "vitest";
import type { PreviewPaneHandle } from "../PreviewPane";
import { usePreviewHandleStore } from "./previewHandleStore";

function handle(url: string): PreviewPaneHandle {
  return {
    reload: () => {},
    focusAddressBar: () => {},
    getUrl: () => url,
    navigate: () => {},
    sendBrowserCommand: <T>() => Promise.resolve(undefined as T),
  };
}

describe("previewHandleStore", () => {
  beforeEach(() => {
    usePreviewHandleStore.setState({
      handles: new Map(),
      activeTabId: null,
    });
  });

  it("returns null when no preview is registered", () => {
    expect(usePreviewHandleStore.getState().getActiveHandle()).toBeNull();
  });

  it("falls back to the only registered preview when none is active", () => {
    const only = handle("http://localhost:3000");
    usePreviewHandleStore.getState().registerHandle(1, only);
    expect(usePreviewHandleStore.getState().getActiveHandle()).toBe(only);
  });

  it("returns null when several previews are registered and none is active", () => {
    usePreviewHandleStore.getState().registerHandle(1, handle("a"));
    usePreviewHandleStore.getState().registerHandle(2, handle("b"));
    expect(usePreviewHandleStore.getState().getActiveHandle()).toBeNull();
  });

  it("resolves the explicit active preview among several", () => {
    const first = handle("a");
    const second = handle("b");
    usePreviewHandleStore.getState().registerHandle(1, first);
    usePreviewHandleStore.getState().registerHandle(2, second);
    usePreviewHandleStore.getState().setActiveTabId(2);
    expect(usePreviewHandleStore.getState().getActiveHandle()).toBe(second);
  });

  it("falls back to the only remaining preview when the active id has no handle", () => {
    const only = handle("solo");
    usePreviewHandleStore.getState().registerHandle(1, only);
    usePreviewHandleStore.getState().setActiveTabId(99);
    expect(usePreviewHandleStore.getState().getActiveHandle()).toBe(only);
  });

  it("unregisters a handle and forgets it", () => {
    const only = handle("gone");
    usePreviewHandleStore.getState().registerHandle(1, only);
    usePreviewHandleStore.getState().registerHandle(1, null);
    expect(usePreviewHandleStore.getState().getActiveHandle()).toBeNull();
  });
});
