import { describe, expect, it } from "vitest";
import {
  createHarnessWindowViews,
  type HarnessWindowViewInput,
} from "@/modules/harness/lib/harnessWindowViews";
import { newTab } from "@/modules/harness/lib/layout";
import { newSession } from "@/modules/harness/lib/session";
import { collectWorkspaceSnapshot } from "@/modules/harness/lib/workspaceSnapshot";

function fixture(cwd = "/work/one") {
  const session = newSession("cursor", cwd);
  const tab = newTab(session.id);
  const input: HarnessWindowViewInput = {
    tabs: [tab],
    activeTabId: tab.id,
    projectCwd: cwd,
    projectReturnMemory: new Map([[cwd, session.id]]),
    projectTerminals: [],
    report: {
      referencedSessionIds: [session.id],
      foregroundSessionIds: [session.id],
      activeSessionId: session.id,
    },
  };
  return { session, tab, input };
}

function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("Missing window view fixture");
  return value;
}

describe("Harness window resource cohorts", () => {
  it("captures only the selected foreground conversation, without a fallback for file focus", () => {
    const views = createHarnessWindowViews();
    const one = fixture();
    const view = views.register(1, one.input);
    expect(views.captureFocusedSession(1, one.session.cwd)).toBeNull();
    views.select(1);
    expect(views.captureFocusedSession(1, "/other")).toBeNull();
    const capture = required(views.captureFocusedSession(1, one.session.cwd));
    expect(capture.sessionId).toBe(one.session.id);
    view.update({
      ...one.input,
      report: { ...one.input.report, activeSessionId: null },
    });
    expect(views.captureFocusedSession(1, one.session.cwd)).toBeNull();
    view.update(one.input);
    expect(capture.isCurrent()).toBe(false);
  });

  it.each([
    "focus",
    "project",
    "selection",
    "replacement",
    "release",
    "removing",
    "switching",
  ])("never revives captured focus after a %s roundtrip", (kind) => {
    const views = createHarnessWindowViews();
    const one = fixture();
    const view = views.register(1, one.input);
    views.select(1);
    const capture = required(views.captureFocusedSession(1, one.session.cwd));
    if (kind === "focus")
      view.update({
        ...one.input,
        report: { ...one.input.report, activeSessionId: null },
      });
    if (kind === "project") view.update({ ...one.input, projectCwd: "/other" });
    if (kind === "selection") views.select(null);
    if (kind === "replacement") views.register(1, one.input);
    if (kind === "release") {
      view.release();
      required(
        views.restore(1, required(views.getSnapshot().cohorts[0])),
      ).update(one.input);
    }
    if (kind === "removing")
      view.update({ ...one.input, removingSessionIds: [one.session.id] });
    if (kind === "switching")
      view.update({ ...one.input, switchingSessionIds: [one.session.id] });
    view.update(one.input);
    views.select(1);
    expect(capture.isCurrent()).toBe(false);
    expect(
      required(views.captureFocusedSession(1, one.session.cwd)).isCurrent(),
    ).toBe(true);
  });

  it("retires focus before external observers can restore it reentrantly", () => {
    const views = createHarnessWindowViews();
    const one = fixture();
    const view = views.register(1, one.input);
    views.select(1);
    const capture = required(views.captureFocusedSession(1, one.session.cwd));
    let restored = false;
    views.subscribe(() => {
      if (restored) return;
      restored = true;
      view.update(one.input);
    });
    view.update({
      ...one.input,
      report: { ...one.input.report, activeSessionId: null },
    });
    expect(capture.isCurrent()).toBe(false);
  });

  it("preserves capture across metadata updates and bounds retained captures", () => {
    const views = createHarnessWindowViews();
    const one = fixture();
    const view = views.register(1, one.input);
    views.select(1);
    const captures = Array.from({ length: 256 }, () =>
      required(views.captureFocusedSession(1, one.session.cwd)),
    );
    view.update({ ...one.input, projectReturnMemory: new Map() });
    expect(captures.every((capture) => capture.isCurrent())).toBe(true);
    expect(() => views.captureFocusedSession(1, one.session.cwd)).toThrow(
      "capacity",
    );
    captures[0].release();
    expect(
      required(views.captureFocusedSession(1, one.session.cwd)).isCurrent(),
    ).toBe(true);
    views.select(null);
    views.select(1);
    expect(
      required(views.captureFocusedSession(1, one.session.cwd)).isCurrent(),
    ).toBe(true);
  });
  it("captures both projects independently of the selected view", () => {
    const views = createHarnessWindowViews();
    const one = fixture();
    const two = fixture("remote://machine/srv/two");
    views.register(1, one.input);
    views.register(2, two.input);
    views.select(2);
    const capture = views.capture([one.session, two.session]);
    expect(capture.tabs.map((tab) => tab.id)).toEqual([one.tab.id, two.tab.id]);
    expect(capture.sessions).toEqual([one.session, two.session]);
    expect(capture.activeTabId).toBe(two.tab.id);
    expect(capture.projectCwd).toBe(two.session.cwd);
    views.select(null);
    const unfocused = views.capture([one.session, two.session]);
    expect(unfocused.tabs).toHaveLength(2);
    expect(unfocused.selectedOwnerId).toBeNull();
    expect(unfocused.activeTabId).toBe("");
    expect(unfocused.projectCwd).toBe("~");
  });

  it("retains resources with no views and reads current canonical session state", () => {
    const views = createHarnessWindowViews();
    const one = fixture();
    const view = views.register(1, {
      ...one.input,
      removingSessionIds: [one.session.id],
      switchingSessionIds: [one.session.id],
    });
    views.select(1);
    view.release();
    const latest = { ...one.session, busy: true, title: "Still running" };
    const capture = views.capture([latest]);
    expect(capture.sessions[0]).toBe(latest);
    expect(capture.tabs).toHaveLength(1);
    expect(capture.selectedOwnerId).toBeNull();
    expect(views.isForeground(latest.id)).toBe(false);
    expect(views.isRemoving(latest.id)).toBe(false);
    expect(views.isSwitching(latest.id)).toBe(false);
    view.update({ ...one.input, tabs: [] });
    expect(views.capture([latest]).tabs).toHaveLength(1);
  });

  it("a replaced handle cannot mutate or release the replacement", () => {
    const views = createHarnessWindowViews();
    const one = fixture();
    const two = fixture("/work/two");
    const old = views.register(1, one.input);
    views.register(1, two.input);
    old.update(one.input);
    old.release();
    views.select(1);
    expect(views.capture([two.session]).activeTabId).toBe(two.tab.id);
  });

  it.each([1, 2])(
    "reclaims the exact retired cohort into owner %s without copying docks",
    (ownerId) => {
      const views = createHarnessWindowViews();
      const one = fixture();
      one.input.projectTerminals.push({
        projectPath: one.session.cwd,
        side: "bottom",
        size: 240,
        open: true,
        pane: {
          id: "dock",
          activeFileId: "terminal",
          files: [
            {
              id: "terminal",
              path: "Terminal",
              cwd: one.session.cwd,
              terminal: true,
            },
          ],
        },
      });
      const old = views.register(1, one.input);
      old.release();
      const retired = required(views.getSnapshot().cohorts[0]);
      const restored = required(views.restore(ownerId, retired));
      old.release();
      expect(views.restore(3, retired)).toBeNull();
      views.select(ownerId);
      const capture = views.capture([one.session]);
      expect(capture.tabs[0].id).toBe(one.tab.id);
      expect(capture.projectTerminals[0].pane.files[0].id).toBe("terminal");
      expect(views.getSnapshot().cohorts).toHaveLength(1);
      expect(capture.selectedOwnerId).toBe(ownerId);
      restored.release();
    },
  );

  it("cannot claim or retire an active or superseded cohort", () => {
    const views = createHarnessWindowViews();
    const one = fixture();
    const handle = views.register(1, one.input);
    const active = required(views.getSnapshot().cohorts[0]);
    expect(views.restore(2, active)).toBeNull();
    expect(views.retire(active)).toBe(false);
    handle.release();
    const retired = required(views.getSnapshot().cohorts[0]);
    views.register(1, one.input);
    expect(views.restore(2, retired)).toBeNull();
    expect(views.retire(retired)).toBe(false);
  });

  it("retires only an explicit exact detached cohort", () => {
    const views = createHarnessWindowViews();
    const one = fixture();
    views.register(1, one.input).release();
    const retired = required(views.getSnapshot().cohorts[0]);
    expect(views.retire({ ...retired })).toBe(false);
    expect(views.retire(retired)).toBe(true);
    expect(views.retire(retired)).toBe(false);
    expect(views.capture([one.session]).sessions).toEqual([one.session]);
    expect(views.capture([one.session]).tabs).toEqual([]);
  });

  it("owns detached metadata and never freezes the caller's input", () => {
    const views = createHarnessWindowViews();
    const one = fixture();
    views.register(1, one.input);
    one.tab.focusedId = "other";
    one.input.tabs.length = 0;
    const capture = views.capture([one.session]);
    expect(capture.tabs[0].focusedId).toBe(one.session.id);
    expect(Object.isFrozen(one.tab)).toBe(false);
    expect(Object.isFrozen(capture.tabs[0])).toBe(true);
  });

  it("keeps shared session stubs when another cohort retains their tab", () => {
    const views = createHarnessWindowViews();
    const one = fixture();
    const secondTab = newTab(one.session.id);
    views.register(1, { ...one.input, keepTab: () => false });
    views.register(2, {
      ...one.input,
      tabs: [secondTab],
      activeTabId: secondTab.id,
    });
    const capture = views.capture([one.session]);
    const snapshot = collectWorkspaceSnapshot(
      capture.tabs,
      capture.sessions,
      capture.activeTabId,
      capture.projectCwd,
      capture.projectReturnMemory,
      capture.projectTerminals,
      capture.keepTab,
    );
    expect(snapshot.tabs.map((tab) => tab.id)).toEqual([secondTab.id]);
    expect(snapshot.sessions.map((session) => session.id)).toEqual([
      one.session.id,
    ]);
  });

  it("does not reintroduce stubs for sessions whose only tabs were filtered", () => {
    const views = createHarnessWindowViews();
    const one = fixture();
    const two = fixture("/work/two");
    views.register(1, { ...one.input, keepTab: () => false });
    views.register(2, two.input);
    const capture = views.capture([one.session, two.session]);
    const snapshot = collectWorkspaceSnapshot(
      capture.tabs,
      capture.sessions,
      capture.activeTabId,
      capture.projectCwd,
      capture.projectReturnMemory,
      capture.projectTerminals,
      capture.keepTab,
    );
    expect(snapshot.sessions.map((session) => session.id)).toEqual([
      two.session.id,
    ]);
  });

  it("arbitrates return memory as presentation metadata without resource collisions", () => {
    const views = createHarnessWindowViews();
    const one = fixture();
    const two = fixture();
    const first = views.register(1, one.input);
    views.register(2, two.input);
    views.select(1);
    expect(
      views
        .capture([one.session, two.session])
        .projectReturnMemory.get(one.session.cwd),
    ).toBe(one.session.id);
    first.release();
    expect(
      views
        .capture([one.session, two.session])
        .projectReturnMemory.get(one.session.cwd),
    ).toBe(two.session.id);
  });

  it("rejects conflicting resources atomically before notifying observers", () => {
    const views = createHarnessWindowViews();
    const one = fixture();
    const two = fixture("/work/two");
    views.register(1, one.input);
    const before = views.getSnapshot();
    expect(() =>
      views.register(2, {
        ...two.input,
        tabs: [{ ...two.tab, id: one.tab.id }],
      }),
    ).toThrow("Harness workspace collision");
    expect(views.getSnapshot()).toBe(before);
  });

  it("rejects oversized raw reports even when all entries duplicate", () => {
    const views = createHarnessWindowViews();
    const one = fixture();
    expect(() =>
      views.register(1, {
        ...one.input,
        report: {
          ...one.input.report,
          referencedSessionIds: Array(257).fill(one.session.id),
        },
      }),
    ).toThrow();
    expect(views.getSnapshot().cohorts).toHaveLength(0);
  });

  it("bounds the aggregate resource union before admission", () => {
    const views = createHarnessWindowViews();
    for (let index = 1; index <= 128; index++)
      views.register(index, fixture(`/work/${index}`).input);
    const before = views.getSnapshot();
    expect(() => views.register(129, fixture("/work/overflow").input)).toThrow(
      RangeError,
    );
    expect(views.getSnapshot()).toBe(before);
  });
});
