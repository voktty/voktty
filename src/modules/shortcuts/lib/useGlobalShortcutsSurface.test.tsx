// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useGlobalShortcuts } from "@/modules/shortcuts/lib/useGlobalShortcuts";
import { publishActiveSurface } from "@/modules/surfaces/lib/activeSurfaceStore";
import { shouldDisableShortcut } from "@/modules/shortcuts/lib/shortcutScope";

vi.mock("@/modules/settings/preferences", () => ({
  usePreferencesStore: (select: (state: unknown) => unknown) => select({ shortcuts: {
    "pane.splitRight": [{ key: "d", ctrl: true }],
    "terminal.clear": [{ key: "k", ctrl: true, alt: true, shift: true }],
    "terminal.copilot": [{ key: "l", ctrl: true, alt: true, shift: true }],
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

it.each(["/project", "remote://machine/project"])("keeps actual terminal focus guards inside the Harness surface at %s", async (projectCwd) => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const clear = vi.fn();
  const copilot = vi.fn();
  function Listener() {
    useGlobalShortcuts({ "terminal.clear": clear, "terminal.copilot": copilot }, {
      isDisabled: (id, event) => shouldDisableShortcut({ id, event, activeTabKind: "harness" }),
    });
    return <><button type="button">Composer</button><div className="xterm"><textarea /></div></>;
  }
  const key = (target: Element, key: string) => {
    const event = new KeyboardEvent("keydown", { key, ctrlKey: true, altKey: true, shiftKey: true, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    return event;
  };
  try {
    await act(async () => root.render(<Listener />));
    publishActiveSurface({ kind: "harness", ownerId: 1, projectCwd });
    const outside = container.querySelector("button");
    const terminal = container.querySelector("textarea");
    if (!outside || !terminal) throw new Error("Missing terminal focus fixture");
    for (const value of ["k", "l"]) expect(key(outside, value).defaultPrevented).toBe(false);
    expect(clear).not.toHaveBeenCalled();
    expect(copilot).not.toHaveBeenCalled();
    for (const value of ["k", "l"]) expect(key(terminal, value).defaultPrevented).toBe(true);
    expect(clear).toHaveBeenCalledOnce();
    expect(copilot).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount());
    container.remove();
    publishActiveSurface(null);
    vi.unstubAllGlobals();
  }
});

it.each(["/project/file.ts", "remote://machine/project/file.ts"])("admits editor split through the actual shortcut dispatcher at %s", async (folder) => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const root = createRoot(document.createElement("div"));
  const split = vi.fn();
  function Listener() { useGlobalShortcuts({ "pane.splitRight": split }); return null; }
  try {
    await act(async () => root.render(<Listener />));
    publishActiveSurface({ kind: "editor", ownerId: 1, folder });
    const event = new KeyboardEvent("keydown", { key: "d", ctrlKey: true, cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(split).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount());
    publishActiveSurface(null);
    vi.unstubAllGlobals();
  }
});
