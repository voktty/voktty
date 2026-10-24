// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useGlobalShortcuts } from "@/modules/shortcuts/lib/useGlobalShortcuts";
import { publishActiveSurface } from "@/modules/surfaces/lib/activeSurfaceStore";

vi.mock("@/modules/settings/preferences", () => ({
  usePreferencesStore: (select: (state: unknown) => unknown) => select({ shortcuts: {
    "pane.splitRight": [{ key: "d", ctrl: true }],
  } }),
}));

it("checks the current surface at dispatch without consuming a rejected key or remounting", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const root = createRoot(document.createElement("div"));
  const split = vi.fn();
  function Listener() { useGlobalShortcuts({ "pane.splitRight": split }); return null; }
  const key = () => {
    const event = new KeyboardEvent("keydown", { key: "d", ctrlKey: true, cancelable: true });
    window.dispatchEvent(event);
    return event;
  };
  try {
    await act(async () => root.render(<Listener />));
    publishActiveSurface({ kind: "harness", ownerId: 1, projectCwd: "remote://machine/project" });
    expect(key().defaultPrevented).toBe(false);
    expect(split).not.toHaveBeenCalled();
    publishActiveSurface({ kind: "terminal", ownerId: 2, cwd: "/project" });
    expect(key().defaultPrevented).toBe(true);
    expect(split).toHaveBeenCalledOnce();
    publishActiveSurface({ kind: "harness", ownerId: 3, projectCwd: "/project" });
    key();
    expect(split).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount());
    publishActiveSurface(null);
    vi.unstubAllGlobals();
  }
});
