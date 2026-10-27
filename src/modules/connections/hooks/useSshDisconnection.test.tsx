// @vitest-environment happy-dom
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Tab, HarnessTab } from "@/modules/tabs";
import type { WorkspaceEnv } from "@/modules/workspace";
import { asTabKey } from "@/modules/tabs/lib/tabIdentity";

const mocks = vi.hoisted(() => ({
  env: { kind: "local" } as WorkspaceEnv,
  profiles: [{ id: "one", name: "One", host: "host.test" }, { id: "alias", name: "Alias", host: "HOST.test", port: 22 }, { id: "other", name: "Other", host: "other.test" }],
  activeId: "space" as string | null,
  closeProfiles: vi.fn(), closeSession: vi.fn(), setEnv: vi.fn(), setRoot: vi.fn(), setSpaceEnv: vi.fn(), success: vi.fn(),
}));
vi.mock("@/modules/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("sonner", () => ({ toast: { success: mocks.success } }));
vi.mock("@/modules/settings/preferences", () => ({ usePreferencesStore: { getState: () => ({ sshConnections: mocks.profiles }) } }));
vi.mock("@/modules/workspace", () => ({ LOCAL_WORKSPACE: { kind: "local" }, useWorkspaceEnvStore: { getState: () => ({ env: mocks.env, setEnv: mocks.setEnv }) } }));
vi.mock("@/modules/spaces", () => ({ useSpaces: { getState: () => ({ activeId: mocks.activeId, setEnv: mocks.setSpaceEnv, setRoot: mocks.setRoot }) } }));
vi.mock("@/modules/remote/sessionManager", () => ({ closeRemoteSessionById: mocks.closeSession, remoteSessions: {} }));
vi.mock("@/modules/harness/lib/harnessEnvStore", () => ({ useHarnessProjectEnvStore: { getState: () => ({}) } }));
vi.mock("@/modules/connections/model/sshConnectionActions", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/modules/connections/model/sshConnectionActions")>(),
  closeSshProfileSessions: mocks.closeProfiles,
}));

import { useSshDisconnection } from "@/modules/connections/hooks/useSshDisconnection";
import { DISCONNECT_SSH_EVENT, harnessProjectPath } from "@/modules/connections/model/sshConnectionActions";
import { subscribeHarnessProjectRequests } from "@/modules/surfaces/lib/harnessProjectRequest";

const harness = (id: number, cwd?: string): HarnessTab => ({ id, kind: "harness", title: "Harness", cwd, tabKey: asTabKey(`tab-${id}`), spaceId: "space", workspaceScopeId: "space" as HarnessTab["workspaceScopeId"] });
const ssh = (): WorkspaceEnv => ({ kind: "ssh", connection: mocks.profiles[0], root: "/project", sessionId: 44 });
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  mocks.env = ssh();
  mocks.activeId = "space";
  mocks.closeProfiles.mockReset().mockResolvedValue(undefined);
  mocks.closeSession.mockReset().mockResolvedValue(undefined);
  mocks.setEnv.mockImplementation((env: WorkspaceEnv) => { mocks.env = env; });
});
afterEach(() => vi.unstubAllGlobals());

async function setup() {
  const root = createRoot(document.createElement("div"));
  const tabsRef = { current: [harness(1, harnessProjectPath("one", "/a")), harness(2, harnessProjectPath("alias", "C:/b")), harness(3, harnessProjectPath("other", "/c")), harness(4, "//server/share/local"),
    { ...harness(5, harnessProjectPath("one", "/terminal")), kind: "terminal" } as Tab] };
  let selected = 1;
  const getTab = (id: number) => tabsRef.current.find((tab) => tab.id === id);
  const update = vi.fn((id: number, patch: { cwd: string }) => {
    tabsRef.current = tabsRef.current.map((tab) => tab.id === id ? { ...tab, ...patch } : tab);
  });
  const fallback = vi.fn();
  const requests = vi.fn();
  const unsubscribe = subscribeHarnessProjectRequests(requests);
  function Window() {
    useSshDisconnection({ tabsRef, getTab, getSelectedTab: () => getTab(selected), updateTab: update, setProjectFallback: fallback, localHome: "C:/home", localRoot: "C:/launch" });
    return null;
  }
  await act(async () => root.render(<StrictMode><Window /></StrictMode>));
  return { tabsRef, update, fallback, requests, select: (id: number) => { selected = id; },
    disconnect: (connectionId?: unknown) => act(async () => window.dispatchEvent(new CustomEvent(DISCONNECT_SSH_EVENT, { detail: { connectionId } }))),
    close: async () => {
      await act(async () => root.unmount());
      unsubscribe();
    },
  };
}

it("disconnects related profiles, resets only captured Harness projects and directs the selected fallback", async () => {
  const fixture = await setup();
  try {
    await fixture.disconnect("alias");
    expect(mocks.closeProfiles).toHaveBeenCalledExactlyOnceWith("alias", new Set(["alias", "one"]));
    expect(mocks.closeSession).toHaveBeenCalledExactlyOnceWith("workspace", 44);
    expect(mocks.setSpaceEnv).toHaveBeenCalledExactlyOnceWith("space", { kind: "local" });
    expect(mocks.setRoot).toHaveBeenCalledExactlyOnceWith("space", "C:/launch");
    expect(mocks.setEnv).toHaveBeenCalledExactlyOnceWith({ kind: "local" });
    expect(fixture.update.mock.calls).toEqual([[1, { cwd: "C:/home" }], [2, { cwd: "C:/home" }]]);
    expect(fixture.fallback).toHaveBeenCalledExactlyOnceWith("C:/home");
    expect(fixture.requests.mock.calls[0][0]).toEqual({ path: "C:/home", target: { ownerId: 1, tabKey: "tab-1" } });
  } finally { await fixture.close(); }
});

it("disconnects a background profile without resetting unrelated selected state", async () => {
  const fixture = await setup();
  try {
    await fixture.disconnect("other");
    expect(fixture.update.mock.calls).toEqual([[3, { cwd: "C:/home" }]]);
    expect(mocks.closeSession).not.toHaveBeenCalled();
    expect(mocks.setEnv).not.toHaveBeenCalled();
    expect(fixture.fallback).not.toHaveBeenCalled();
    expect(fixture.requests).not.toHaveBeenCalled();
  } finally { await fixture.close(); }
});

it("uses the current SSH workspace when the event omits its profile", async () => {
  const fixture = await setup();
  try {
    fixture.select(4);
    await fixture.disconnect();
    expect(mocks.closeProfiles).toHaveBeenCalledExactlyOnceWith("one", new Set(["one", "alias"]));
    expect(fixture.update.mock.calls.map(([id]) => id)).toEqual([1, 2, 4]);
    expect(fixture.requests.mock.calls[0][0].target.ownerId).toBe(4);
  } finally { await fixture.close(); }
});

it("preserves local state and unknown namespaces when no SSH target exists", async () => {
  mocks.env = { kind: "local" };
  const fixture = await setup();
  try {
    fixture.tabsRef.current = [harness(1, "remote://machine/root"), harness(2, "remote://voktty-ssh-%ZZ/root")];
    await fixture.disconnect();
    expect(fixture.update).not.toHaveBeenCalled();
    expect(mocks.closeProfiles).not.toHaveBeenCalled();
    expect(mocks.setEnv).not.toHaveBeenCalled();
  } finally { await fixture.close(); }
});

it.each(["key", "cwd", "space", "removed"] as const)("preserves a captured target after reentrant %s replacement", async (change) => {
  const fixture = await setup();
  try {
    mocks.closeProfiles.mockImplementationOnce(async () => {
      const old = fixture.tabsRef.current[0];
      const replacement = change === "key" ? { ...old, tabKey: asTabKey("tab-replaced") } : change === "cwd" ? { ...old, cwd: "/explicit-navigation" } : { ...old, spaceId: "moved" };
      fixture.tabsRef.current = change === "removed" ? fixture.tabsRef.current.slice(1) : [replacement, ...fixture.tabsRef.current.slice(1)];
    });
    await fixture.disconnect("one");
    expect(fixture.update.mock.calls.map(([id]) => id)).toEqual([2]);
    expect(fixture.fallback).not.toHaveBeenCalled();
    expect(fixture.requests).not.toHaveBeenCalled();
  } finally { await fixture.close(); }
});

it("does not select another Harness when closure changes the current selection", async () => {
  const fixture = await setup();
  try {
    mocks.closeProfiles.mockImplementationOnce(async () => fixture.select(3));
    await fixture.disconnect("one");
    expect(fixture.update.mock.calls.map(([id]) => id)).toEqual([1, 2]);
    expect(fixture.fallback).not.toHaveBeenCalled();
    expect(fixture.requests).not.toHaveBeenCalled();
  } finally { await fixture.close(); }
});

it("does not overwrite a successor workspace and observes cleanup failures", async () => {
  const fixture = await setup();
  const successor = { ...ssh(), sessionId: 77 } as WorkspaceEnv;
  try {
    mocks.closeProfiles.mockImplementationOnce(async () => { mocks.env = successor; throw new Error("Cleanup failed"); });
    mocks.closeSession.mockRejectedValueOnce(new Error("Release failed"));
    await fixture.disconnect("one");
    expect(mocks.setEnv).not.toHaveBeenCalled();
    expect(mocks.setSpaceEnv).not.toHaveBeenCalled();
    expect(mocks.env).toBe(successor);
    expect(mocks.closeSession).toHaveBeenCalledExactlyOnceWith("workspace", 44);
  } finally { await fixture.close(); }
});

it("releases its listener on unmount under StrictMode", async () => {
  const fixture = await setup();
  await fixture.close();
  await fixture.disconnect("one");
  expect(mocks.closeProfiles).not.toHaveBeenCalled();
  expect(fixture.update).not.toHaveBeenCalled();
});

it("revalidates selection and navigation after publishing the fallback", async () => {
  const fixture = await setup();
  try {
    fixture.fallback.mockImplementationOnce(() => {
      fixture.tabsRef.current = fixture.tabsRef.current.map((tab) => tab.id === 1 ? { ...tab, cwd: "/new-navigation" } : tab);
    });
    await fixture.disconnect("one");
    expect(fixture.fallback).toHaveBeenCalledOnce();
    expect(fixture.requests).not.toHaveBeenCalled();
    expect(fixture.tabsRef.current[0]).toMatchObject({ kind: "harness", cwd: "/new-navigation" });
  } finally { await fixture.close(); }
});

it("does not reset another workspace selected reentrantly during profile cleanup", async () => {
  const fixture = await setup();
  try {
    mocks.closeProfiles.mockImplementationOnce(async () => { mocks.activeId = "other-space"; });
    await fixture.disconnect("one");
    expect(mocks.closeSession).toHaveBeenCalledExactlyOnceWith("workspace", 44);
    expect(mocks.setEnv).not.toHaveBeenCalled();
    expect(mocks.setRoot).not.toHaveBeenCalled();
    expect(mocks.setSpaceEnv).not.toHaveBeenCalled();
  } finally { await fixture.close(); }
});
