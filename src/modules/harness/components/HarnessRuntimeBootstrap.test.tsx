// @vitest-environment happy-dom
import { act, StrictMode, useContext, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { HarnessWindowHost } from "@/modules/harness/components/HarnessWindowHost";
import { newSession } from "@/modules/harness/lib/session";
import { newTab } from "@/modules/harness/lib/layout";
import { collectWorkspaceSnapshot } from "@/modules/harness/lib/workspaceSnapshot";

const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
type Props = ComponentProps<typeof HarnessWindowHost>;
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  native.invoke.mockReset().mockResolvedValue(null);
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

function fixture() {
  const sessions = ["one", "two"].map((id) => ({ ...newSession("cursor", "/project"), id,
    blocks: [{ id: `block-${id}`, role: "user" as const, text: `transcript-${id}` }] }));
  const views = sessions.map((session, index) => {
    const tab = newTab(session.id);
    return { tabKey: `tab-${index}`, workspace: collectWorkspaceSnapshot([tab], [session], tab.id, "/project", new Map()) };
  });
  const workspace = collectWorkspaceSnapshot(views.flatMap((view) => view.workspace.tabs), sessions,
    views[0].workspace.activeTabId, "/project", new Map());
  return { sessions, views, workspace };
}

it("loads real stored transcripts before rendering distinct stable views under StrictMode", async () => {
  const f = fixture();
  const { windowSessionState } = await import("@/modules/lifecycle/windowSessionState");
  windowSessionState.manage();
  windowSessionState.seed({ version: 1, payload: JSON.stringify({ workspace: f.workspace, views: f.views }) }, true);
  native.invoke.mockImplementation(async (command, args) => {
    if (command === "session_get") return f.sessions.find((session) => session.id === args.sessionId);
    if (command === "session_upsert_batch") return args.sessions;
    if (command === "session_list_in_flight") return [];
    return null;
  });
  const { HarnessRestoreContext } = await import("@/modules/harness/hooks/harnessRestoreContext");
  const { loadHarnessRuntime } = await import("@/modules/harness/components/HarnessRuntimeBootstrap");
  const { default: Runtime } = await loadHarnessRuntime((props) => {
    const context = useContext(HarnessRestoreContext);
    expect(props.initialSessions?.().map((session) => session.blocks[0].text)).toEqual(["transcript-one", "transcript-two"]);
    expect(props.initialViews?.map((view) => view.ownerId)).toEqual([17, 22]);
    expect(context?.views.get("tab-0")?.resumed?.tabs).toEqual(f.views[0].workspace.tabs);
    expect(context?.views.get("tab-1")?.resumed?.tabs).toEqual(f.views[1].workspace.tabs);
    return <div data-restored />;
  });
  await act(async () => root.render(<StrictMode><Runtime viewIdentities={[
    { ownerId: 17, tabKey: "tab-0" }, { ownerId: 22, tabKey: "tab-1" },
  ]}>{null}</Runtime></StrictMode>));
  expect(container.querySelector("[data-restored]")).not.toBeNull();
  expect(native.invoke.mock.calls.filter(([command]) => command === "session_get")).toHaveLength(2);
  expect(native.invoke.mock.calls.some(([command]) => command === "workspace_get_snapshot")).toBe(false);
  const store = await import("@/modules/harness/lib/sessionStore");
  await store.saveWorkspaceSnapshot(f.workspace);
  expect(native.invoke.mock.calls.some(([command]) => command === "workspace_set_snapshot")).toBe(false);
});

it("fresh directory boot does not read the old workspace or its transcripts", async () => {
  const { windowSessionState } = await import("@/modules/lifecycle/windowSessionState");
  windowSessionState.manage();
  windowSessionState.seed(undefined, false);
  const { loadHarnessRuntime } = await import("@/modules/harness/components/HarnessRuntimeBootstrap");
  const { default: Runtime } = await loadHarnessRuntime((props: Props) => {
    expect(props.initialSessions?.()).toEqual([]);
    expect(props.initialViews).toEqual([]);
    return null;
  });
  await act(async () => root.render(<Runtime>{null}</Runtime>));
  expect(native.invoke.mock.calls.map(([command]) => command)).toEqual(["take_window_transfer"]);
});

it("rejects malformed combined state before publishing a replacement runtime", async () => {
  const { windowSessionState } = await import("@/modules/lifecycle/windowSessionState");
  windowSessionState.manage();
  windowSessionState.seed({ version: 1, payload: "malformed" }, true);
  const { loadHarnessRuntime } = await import("@/modules/harness/components/HarnessRuntimeBootstrap");
  const host = vi.fn(() => null);
  await expect(loadHarnessRuntime(host)).rejects.toThrow();
  expect(host).not.toHaveBeenCalled();
  expect(native.invoke.mock.calls.some(([command]) => command === "workspace_set_snapshot")).toBe(false);
});

it("retains cold and headless view identities before their outer views mount", async () => {
  const f = fixture();
  const { windowSessionState } = await import("@/modules/lifecycle/windowSessionState");
  windowSessionState.manage();
  windowSessionState.seed({ version: 1, payload: JSON.stringify({ workspace: f.workspace, views: f.views }) }, true);
  const { HarnessRestoreContext } = await import("@/modules/harness/hooks/harnessRestoreContext");
  const { loadHarnessRuntime } = await import("@/modules/harness/components/HarnessRuntimeBootstrap");
  const { default: Runtime } = await loadHarnessRuntime((props) => {
    const context = useContext(HarnessRestoreContext);
    expect(props.initialViews).toHaveLength(2);
    expect(props.initialViews?.[0]).toMatchObject({ ownerId: 17, tabKey: "tab-0" });
    expect(props.initialViews?.[1]).toMatchObject({ ownerId: Number.MAX_SAFE_INTEGER - 1, tabKey: "tab-1" });
    expect(context?.views.has("tab-0")).toBe(true);
    return null;
  });
  await act(async () => root.render(<Runtime viewIdentities={[{ ownerId: 17, tabKey: "tab-0" }]}>{null}</Runtime>));
});

it("delivers the complete transfer to one selected view without consuming dirty-file metadata", async () => {
  const f = fixture();
  const transfer = { ...f.workspace, sessions: f.sessions, dirtyFileIds: ["dirty-file"] };
  const { windowSessionState } = await import("@/modules/lifecycle/windowSessionState");
  windowSessionState.manage();
  windowSessionState.seed(undefined, false);
  native.invoke.mockImplementation(async (command) => command === "take_window_transfer" ? JSON.stringify(transfer) : null);
  const { HarnessRestoreContext } = await import("@/modules/harness/hooks/harnessRestoreContext");
  const { loadHarnessRuntime } = await import("@/modules/harness/components/HarnessRuntimeBootstrap");
  const { default: Runtime } = await loadHarnessRuntime((props) => {
    const context = useContext(HarnessRestoreContext);
    expect(context?.views.size).toBe(1);
    expect(context?.views.get("tab-1")?.windowTransfer).toEqual(transfer);
    expect(props.initialSessions?.()).toEqual(f.sessions);
    expect(props.initialViews?.[0].ownerId).toBe(22);
    return null;
  });
  await act(async () => root.render(<Runtime initialOwnerId={22} viewIdentities={[
    { ownerId: 17, tabKey: "tab-0" }, { ownerId: 22, tabKey: "tab-1" },
  ]}>{null}</Runtime>));
  expect(native.invoke.mock.calls.map(([command]) => command)).toEqual(["take_window_transfer"]);
});

it("reads a legacy workspace once and assigns its layout only to the selected outer view", async () => {
  const f = fixture();
  const { windowSessionState } = await import("@/modules/lifecycle/windowSessionState");
  windowSessionState.manage();
  windowSessionState.seed(undefined, true);
  native.invoke.mockImplementation(async (command) => command === "workspace_get_snapshot" ? f.workspace : null);
  const { HarnessRestoreContext } = await import("@/modules/harness/hooks/harnessRestoreContext");
  const { loadHarnessRuntime } = await import("@/modules/harness/components/HarnessRuntimeBootstrap");
  const { default: Runtime } = await loadHarnessRuntime((props) => {
    const context = useContext(HarnessRestoreContext);
    expect(props.initialViews).toHaveLength(1);
    expect(context?.views.size).toBe(1);
    expect(context?.views.get("tab-1")?.resumed?.tabs).toEqual(f.workspace.tabs);
    return null;
  });
  await act(async () => root.render(<Runtime initialOwnerId={22} viewIdentities={[
    { ownerId: 17, tabKey: "tab-0" }, { ownerId: 22, tabKey: "tab-1" },
  ]}>{null}</Runtime>));
  expect(native.invoke.mock.calls.filter(([command]) => command === "workspace_get_snapshot")).toHaveLength(1);
});
