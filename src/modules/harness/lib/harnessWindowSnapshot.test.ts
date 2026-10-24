import { describe, expect, it } from "vitest";
import { collectHarnessWindowState, parseHarnessWindowSnapshot } from "@/modules/harness/lib/harnessWindowSnapshot";
import { createHarnessWindowViews } from "@/modules/harness/lib/harnessWindowViews";
import { normalizeHarnessSessionViewReport } from "@/modules/harness/lib/harnessSessionViews";
import { newSession } from "@/modules/harness/lib/session";
import { newTab } from "@/modules/harness/lib/layout";
import { hydrateWorkspaceSnapshot } from "@/modules/harness/lib/workspaceSnapshot";

describe("Harness window snapshot", () => {
  it("round-trips distinct views of one project with stable keys and headless stubs", () => {
    const views = createHarnessWindowViews();
    const a = { ...newSession("cursor", "/project"), id: "session-a" };
    const b = { ...newSession("cursor", "/project"), id: "session-b" };
    const headless = { ...newSession("cursor", "/project"), id: "headless" };
    const first = newTab(a.id);
    const second = newTab(b.id);
    const register = (owner: number, tab: typeof first, sessionId: string) => views.register(owner, {
      tabs: [tab], activeTabId: tab.id, projectCwd: "/project",
      projectTerminals: [], projectReturnMemory: new Map(),
      report: normalizeHarnessSessionViewReport({ referencedSessionIds: [sessionId] }),
    });
    register(1, first, a.id);
    register(2, second, b.id).release();
    const state = collectHarnessWindowState(views.getSnapshot(), [a, b, headless],
      new Map([[1, "tab-first"], [2, "tab-second"]]));
    const parsed = parseHarnessWindowSnapshot(state);
    expect(parsed.views.map((view) => view.tabKey)).toEqual(["tab-first", "tab-second"]);
    expect(parsed.views.map((view) => view.workspace.tabs.map((tab) => tab.id))).toEqual([[first.id], [second.id]]);
    expect(parsed.workspace.sessions.map((session) => session.id)).toEqual([a.id, b.id, headless.id]);
    expect(state.payload).not.toContain('"blocks"');
    expect(state.payload).not.toContain('"ownerId"');
  });

  it("retains sessions with zero cohorts and hydrates their persisted transcript", () => {
    const session = { ...newSession("cursor", "/project"), id: "headless",
      blocks: [{ id: "message", role: "user" as const, text: "persisted transcript" }] };
    const parsed = parseHarnessWindowSnapshot(collectHarnessWindowState(
      createHarnessWindowViews().getSnapshot(), [session], new Map(),
    ));
    expect(parsed.views).toEqual([]);
    expect(parsed.workspace.tabs).toEqual([]);
    expect(hydrateWorkspaceSnapshot(parsed.workspace, new Map([[session.id, session]]), new Set(), true)
      ?.sessions[0].blocks).toEqual(session.blocks);
  });

  it("rejects duplicate stable view keys and malformed or excessive trees", () => {
    const empty = { tabs: [], sessions: [], activeTabId: "", projectCwd: "~", projectTerminals: [] };
    const parse = (value: unknown) => parseHarnessWindowSnapshot({ version: 1, payload: JSON.stringify(value) });
    expect(() => parse({ workspace: empty, views: [
      { tabKey: "tab-same", workspace: empty }, { tabKey: "tab-same", workspace: empty },
    ] })).toThrow("identity");
    expect(() => parse({ workspace: empty, views: [{ workspace: empty }] })).toThrow("identity");
    let tree: unknown = null;
    for (let i = 0; i < 66; i++) tree = { child: tree };
    expect(() => parse({ workspace: empty, views: [], tree })).toThrow("Invalid");
    expect(() => parse({ workspace: empty, views: Array(257).fill(null) })).toThrow("Invalid");
  });
});
