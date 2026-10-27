// @vitest-environment happy-dom
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { HarnessTab, Tab } from "@/modules/tabs";
import { asTabKey } from "@/modules/tabs/lib/tabIdentity";
import { subscribeHarnessProjectRequests } from "@/modules/surfaces/lib/harnessProjectRequest";
import { useHarnessProjectOpening } from "@/modules/surfaces/lib/useHarnessProjectOpening";

afterEach(() => vi.unstubAllGlobals());

const tab = (id: number, spaceId = "one"): HarnessTab => ({
  id, spaceId, tabKey: asTabKey(`tab-${id}`), kind: "harness", title: "Harness",
  workspaceScopeId: spaceId as HarnessTab["workspaceScopeId"],
});
const deferred = () => {
  let resolve!: (path: string) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<string>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

async function setup(items: Tab[] = [tab(1), tab(2, "two")]) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const root = createRoot(document.createElement("div"));
  const tabsRef = { current: items };
  const created = vi.fn((spaceId = "one", cwd?: string) => {
    const existing = tabsRef.current.find((item) => item.kind === "harness" && item.spaceId === spaceId);
    if (existing) return existing.id;
    const next = { ...tab(3, spaceId), cwd };
    tabsRef.current = [...tabsRef.current, next];
    return next.id;
  });
  const activate = vi.fn();
  const error = vi.fn();
  const missing = vi.fn();
  const createWorktree = vi.fn< (root: string, name: string) => Promise<string> >().mockResolvedValue("/worktree");
  const selected = vi.fn();
  const unsubscribe = subscribeHarnessProjectRequests(selected);
  const getTab = (id: number) => tabsRef.current.find((item) => item.id === id);
  let result!: ReturnType<typeof useHarnessProjectOpening>;
  function Window({ spaceId, selectedKey, localRoot }: { spaceId: string; selectedKey: string; localRoot?: string }) {
    result = useHarnessProjectOpening({ spaceId, selectedTabKey: selectedKey, localRoot, tabsRef,
      getTab, newHarnessTab: created, activateTab: activate, createWorktree, onError: error,
      onMissingProject: missing, openEventName: "voktty:open-harness" });
    return null;
  }
  const render = (spaceId = "one", selectedKey = "tab-1", localRoot: string | undefined = "C:/project") =>
    act(async () => root.render(<StrictMode><Window spaceId={spaceId} selectedKey={selectedKey} localRoot={localRoot} /></StrictMode>));
  await render();
  return { tabsRef, created, activate, error, missing, createWorktree, selected, render,
    current: () => result,
    close: async () => {
      await act(async () => root.unmount());
      unsubscribe();
    },
  };
}

it("opens profile projects against the returned exact tab, including synchronous new creation", async () => {
  const fixture = await setup();
  try {
    await act(async () => window.dispatchEvent(new CustomEvent("voktty:open-harness", { detail: { path: "remote://machine/root" } })));
    expect(fixture.created).toHaveBeenCalledExactlyOnceWith("one", "remote://machine/root");
    expect(fixture.activate).toHaveBeenCalledExactlyOnceWith(1);
    expect(fixture.selected.mock.calls[0][0]).toEqual({ path: "remote://machine/root", target: { ownerId: 1, tabKey: "tab-1" } });
    fixture.tabsRef.current = [];
    await act(async () => window.dispatchEvent(new CustomEvent("voktty:open-harness", { detail: { path: "//server/share/project" } })));
    expect(fixture.activate).toHaveBeenLastCalledWith(3);
    expect(fixture.selected.mock.calls[1][0].target).toEqual({ ownerId: 3, tabKey: "tab-3" });
    await act(async () => window.dispatchEvent(new CustomEvent("voktty:open-harness", { detail: { path: " ", target: null } })));
    expect(fixture.selected).toHaveBeenCalledTimes(2);
  } finally { await fixture.close(); }
});

it("selects the captured worktree destination and preserves local launch roots", async () => {
  const fixture = await setup();
  try {
    await act(async () => fixture.current().openNewHarnessInWorktree());
    expect(fixture.createWorktree).toHaveBeenCalledExactlyOnceWith("C:/project", expect.any(String));
    expect(fixture.created).not.toHaveBeenCalled();
    expect(fixture.activate).toHaveBeenCalledExactlyOnceWith(1);
    expect(fixture.selected.mock.calls[0][0]).toEqual({ path: "/worktree", target: { ownerId: 1, tabKey: "tab-1" } });
    await fixture.render("two", "tab-2", "/local-home");
    fixture.current().openNewHarness();
    expect(fixture.created).toHaveBeenCalledExactlyOnceWith("two", "/local-home");
  } finally { await fixture.close(); }
});

it.each(["space", "selection", "root", "replacement", "removal", "unmount"] as const)("suppresses worktree publication after %s retirement", async (change) => {
  const fixture = await setup();
  const work = deferred();
  fixture.createWorktree.mockReturnValueOnce(work.promise);
  let pending!: Promise<void>;
  try {
    await act(async () => { pending = fixture.current().openNewHarnessInWorktree(); });
    if (change === "space") { await fixture.render("two", "tab-2"); await fixture.render(); }
    if (change === "selection") await fixture.render("one", "tab-2");
    if (change === "root") await fixture.render("one", "tab-1", "/new-root");
    if (change === "replacement") fixture.tabsRef.current = [{ ...tab(1), tabKey: asTabKey("tab-replacement") }, tab(2, "two")];
    if (change === "removal") fixture.tabsRef.current = [tab(2, "two")];
    if (change === "unmount") await fixture.close();
    await act(async () => { work.resolve("/created-but-retired"); await pending; });
    expect(fixture.activate).not.toHaveBeenCalled();
    expect(fixture.selected).not.toHaveBeenCalled();
    expect(fixture.created).not.toHaveBeenCalled();
    expect(fixture.error).not.toHaveBeenCalled();
  } finally { if (change !== "unmount") await fixture.close(); }
});

it("reports only current worktree failures and never revives cached callbacks", async () => {
  const fixture = await setup();
  try {
    const originalError = new Error("Git rejected the operation");
    fixture.createWorktree.mockRejectedValueOnce(originalError);
    await act(async () => fixture.current().openNewHarnessInWorktree());
    expect(fixture.error).toHaveBeenCalledExactlyOnceWith(originalError);
    const old = fixture.current();
    const work = deferred();
    fixture.createWorktree.mockReturnValueOnce(work.promise);
    let pending!: Promise<void>;
    await act(async () => { pending = old.openNewHarnessInWorktree(); });
    await fixture.render("two", "tab-2");
    await fixture.render();
    old.openNewHarness();
    await act(async () => { work.reject(new Error("Retired Git failure")); await pending; });
    expect(fixture.error).toHaveBeenCalledOnce();
    expect(fixture.created).not.toHaveBeenCalled();
  } finally { await fixture.close(); }
});

it("creates a missing Harness in its explicit original workspace after worktree settlement", async () => {
  const fixture = await setup([]);
  try {
    await act(async () => fixture.current().openNewHarnessInWorktree());
    expect(fixture.created).toHaveBeenCalledExactlyOnceWith("one", "/worktree");
    expect(fixture.activate).toHaveBeenCalledExactlyOnceWith(3);
    expect(fixture.selected.mock.calls[0][0].target).toEqual({ ownerId: 3, tabKey: "tab-3" });
  } finally { await fixture.close(); }
});

it("keeps retired worktree requests charged until settlement and releases their capacity", async () => {
  const fixture = await setup();
  const work = deferred();
  const requests: Promise<void>[] = [];
  fixture.createWorktree.mockReturnValue(work.promise);
  try {
    await act(async () => {
      for (let index = 0; index < 256; index++) requests.push(fixture.current().openNewHarnessInWorktree());
    });
    expect(fixture.createWorktree).toHaveBeenCalledTimes(256);
    await fixture.render("two", "tab-2");
    await act(async () => fixture.current().openNewHarnessInWorktree());
    expect(fixture.error).toHaveBeenCalledOnce();
    expect(fixture.createWorktree).toHaveBeenCalledTimes(256);
    await act(async () => { work.resolve("/retired-result"); await Promise.all(requests); });
    expect(fixture.selected).not.toHaveBeenCalled();
    fixture.createWorktree.mockResolvedValue("/current-result");
    await act(async () => fixture.current().openNewHarnessInWorktree());
    expect(fixture.activate).toHaveBeenCalledExactlyOnceWith(2);
  } finally { await fixture.close(); }
});

it("retires its event listener and current callbacks on unmount", async () => {
  const fixture = await setup();
  const callbacks = fixture.current();
  await fixture.close();
  window.dispatchEvent(new CustomEvent("voktty:open-harness", { detail: { path: "/after-unmount" } }));
  callbacks.openNewHarness();
  await callbacks.openNewHarnessInWorktree();
  expect(fixture.created).not.toHaveBeenCalled();
  expect(fixture.createWorktree).not.toHaveBeenCalled();
  expect(fixture.activate).not.toHaveBeenCalled();
});

it("uses the selected Harness when several views share a workspace", async () => {
  const fixture = await setup([tab(1), tab(2)]);
  try {
    await fixture.render("one", "tab-2");
    await act(async () => fixture.current().openNewHarnessInWorktree());
    expect(fixture.activate).toHaveBeenCalledExactlyOnceWith(2);
    expect(fixture.selected.mock.calls[0][0].target).toEqual({ ownerId: 2, tabKey: "tab-2" });
  } finally { await fixture.close(); }
});
