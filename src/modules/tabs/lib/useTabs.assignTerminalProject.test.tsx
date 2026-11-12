// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTabs } from "@/modules/tabs/lib/useTabs";

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

let current: ReturnType<typeof useTabs>;
function Probe() {
  current = useTabs();
  return null;
}

function mount() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const root = createRoot(document.createElement("div"));
  act(() => root.render(<Probe />));
  return root;
}

function terminalKey() {
  const tab = current.tabs.find((candidate) => candidate.kind === "terminal");
  if (!tab) throw new Error("Missing terminal fixture");
  return tab.tabKey;
}

describe("assignTerminalProject", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("binds a free local terminal to a local project", () => {
    const root = mount();
    const key = terminalKey();
    let stored: string | undefined;
    act(() => {
      stored = current.assignTerminalProject(key, ["C:", "work", "app"].join(String.fromCharCode(92)));
    });
    expect(stored).toBe("C:/work/app");
    const tab = current.tabs.find((candidate) => candidate.tabKey === key);
    expect(tab?.kind === "terminal" && tab.projectCwd).toBe("C:/work/app");
    act(() => root.unmount());
  });

  it("refuses a remote project for a local terminal", () => {
    const root = mount();
    expect(
      current.assignTerminalProject(terminalKey(), "remote://box/srv/app"),
    ).toBeUndefined();
    act(() => root.unmount());
  });

  it("keeps a terminal that already belongs to another project", () => {
    const root = mount();
    const key = terminalKey();
    act(() => {
      current.assignTerminalProject(key, "/work/one");
    });
    expect(current.assignTerminalProject(key, "/work/two")).toBeUndefined();
    expect(current.assignTerminalProject(key, "/work/one")).toBe("/work/one");
    act(() => root.unmount());
  });

  it("ignores tabs that are not terminals", () => {
    const root = mount();
    expect(current.assignTerminalProject("missing", "/work")).toBeUndefined();
    act(() => root.unmount());
  });
});
