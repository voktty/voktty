import { expect, it, vi } from "vitest";
import { createHarnessWindowViews } from "@/modules/harness/lib/harnessWindowViews";
import { createHarnessWindowSessionHolds } from "@/modules/harness/lib/harnessWindowSessionHolds";
import { normalizeHarnessSessionViewReport } from "@/modules/harness/lib/harnessSessionViews";
import {
  leaf,
  leafIds,
  newTab,
  newFileTab,
  newPlanTab,
  newSessionChangesTab,
} from "@/modules/harness/lib/layout";

function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("Missing retained reference fixture");
  return value;
}
function fixture() {
  const holds = createHarnessWindowSessionHolds();
  const views = createHarnessWindowViews(holds);
  const one = newTab("one");
  const two = newTab("two");
  const input = {
    tabs: [one, two],
    activeTabId: one.id,
    projectCwd: "/work",
    projectReturnMemory: new Map([
      ["/work", "one"],
      ["/elsewhere", "remembered"],
    ]),
    projectTerminals: [],
    report: normalizeHarnessSessionViewReport({
      referencedSessionIds: ["one", "two"],
    }),
  };
  return { holds, views, one, two, input };
}

it("prunes only captured detached references under a current removal reservation", () => {
  const f = fixture();
  f.views.register(1, f.input).release();
  const old = required(f.views.getSnapshot().cohorts[0]);
  const hold = required(f.holds.acquire("removing", ["one"], () => true));
  const updated = required(f.views.pruneRetained(old, ["one"], hold.isCurrent));
  expect(updated.state.layout.tabs.map((tab) => tab.id)).toEqual([f.two.id]);
  expect(updated.state.layout.activeTabId).toBe(f.two.id);
  expect(updated.state.report.referencedSessionIds).toEqual(["two"]);
  expect(updated.state.returnTargets).toEqual([["/elsewhere", "remembered"]]);
  expect(updated.state.keptTabIds).toEqual([f.two.id]);
  expect(old.state.layout.tabs).toHaveLength(2);
  expect(Object.isFrozen(updated.state.layout.tabs)).toBe(true);
  expect(f.views.restore(2, old)).toBeNull();
  expect(required(f.views.restore(2, updated)).isCurrent()).toBe(true);
});

it("preserves unrelated file panes, terminal panes and project docks", () => {
  const f = fixture();
  const file = newFileTab("/work/file.txt", "/work");
  const terminal = { ...newFileTab("Terminal", "/work"), terminal: true };
  const tab = {
    ...f.one,
    layout: {
      type: "split" as const,
      id: "split",
      dir: "right" as const,
      children: [leaf("one"), leaf("editor"), leaf("terminal")],
      sizes: [0.3, 0.3, 0.4],
    },
    editorPanes: [{ id: "editor", files: [file], activeFileId: file.id }],
    terminalPanes: [
      { id: "terminal", files: [terminal], activeFileId: terminal.id },
    ],
  };
  f.views
    .register(1, {
      ...f.input,
      tabs: [tab, f.two],
      projectTerminals: [
        {
          projectPath: "/work",
          open: true,
          size: 200,
          side: "bottom",
          pane: {
            id: "dock",
            files: [{ ...terminal, id: "dock-file" }],
            activeFileId: "dock-file",
          },
        },
      ],
    })
    .release();
  const old = required(f.views.getSnapshot().cohorts[0]);
  const hold = required(f.holds.acquire("transfer", ["one"], () => true));
  const next = required(f.views.pruneRetained(old, ["one"], hold.isCurrent));
  expect(leafIds(next.state.layout.tabs[0].layout)).toEqual([
    "editor",
    "terminal",
  ]);
  expect(next.state.layout.tabs[0].editorPanes).toEqual(
    old.state.layout.tabs[0].editorPanes,
  );
  expect(next.state.layout.tabs[0].terminalPanes).toEqual(
    old.state.layout.tabs[0].terminalPanes,
  );
  expect(next.state.layout.projectTerminals).toEqual(
    old.state.layout.projectTerminals,
  );
});

it.each(["active", "stale", "no hold", "retired"] as const)(
  "rejects %s authority without publication",
  (kind) => {
    const f = fixture();
    const handle = f.views.register(1, f.input);
    if (kind !== "active") handle.release();
    const old = required(f.views.getSnapshot().cohorts[0]);
    let current = true;
    const hold =
      kind === "no hold"
        ? null
        : f.holds.acquire("removing", ["one"], () => current);
    if (kind === "stale") {
      hold?.release();
      f.views.register(1, f.input).release();
    }
    if (kind === "retired") current = false;
    const before = f.views.getSnapshot();
    const changed = vi.fn();
    f.views.subscribe(changed);
    expect(
      f.views.pruneRetained(old, ["one"], () => hold?.isCurrent() ?? true),
    ).toBeNull();
    expect(f.views.getSnapshot()).toBe(before);
    expect(changed).not.toHaveBeenCalled();
  },
);

it("revalidates the exact cohort after an authority callback restores it", () => {
  const f = fixture();
  f.views.register(1, f.input).release();
  const old = required(f.views.getSnapshot().cohorts[0]);
  const hold = required(f.holds.acquire("removing", ["one"], () => true));
  const current = () => {
    hold.release();
    f.views.restore(2, old);
    return true;
  };
  expect(f.views.pruneRetained(old, ["one"], current)).toBeNull();
  expect(f.views.getSnapshot().cohorts[0].ownerId).toBe(2);
});

it("validates the raw session limit before changing a cohort", () => {
  const f = fixture();
  f.views.register(1, f.input).release();
  const old = required(f.views.getSnapshot().cohorts[0]);
  expect(() =>
    f.views.pruneRetained(old, Array(257).fill("one"), () => true),
  ).toThrow("Invalid Harness session view report");
  expect(f.views.getSnapshot().cohorts[0]).toBe(old);
});

it("removes session documents while retaining the physical editor in the same pane", () => {
  const f = fixture();
  const file = newFileTab("/work/file.txt", "/work");
  const plan = newPlanTab("one", "block", "Plan", "/work");
  const diff = newSessionChangesTab("/work", "one");
  const tab = {
    ...f.one,
    layout: leaf("editor"),
    focusedId: "editor",
    editorPanes: [
      { id: "editor", files: [plan, diff, file], activeFileId: plan.id },
    ],
  };
  f.views.register(1, { ...f.input, tabs: [tab, f.two] }).release();
  const old = required(f.views.getSnapshot().cohorts[0]);
  const hold = required(f.holds.acquire("removing", ["one"], () => true));
  const next = required(f.views.pruneRetained(old, ["one"], hold.isCurrent));
  expect(next.state.layout.tabs[0].editorPanes[0].files).toEqual([file]);
  expect(next.state.layout.tabs[0].editorPanes[0].activeFileId).toBe(file.id);
  expect(next.state.layout.tabs[0].focusedId).toBe("editor");
});

it("fails closed rather than discarding orphaned physical panes", () => {
  const f = fixture();
  const file = newFileTab("/work/file.txt", "/work");
  const tab = {
    ...f.one,
    editorPanes: [{ id: "editor", files: [file], activeFileId: file.id }],
  };
  f.views.register(1, { ...f.input, tabs: [tab] }).release();
  const old = required(f.views.getSnapshot().cohorts[0]);
  const hold = required(f.holds.acquire("removing", ["one"], () => true));
  expect(f.views.pruneRetained(old, ["one"], hold.isCurrent)).toBeNull();
  expect(f.views.getSnapshot().cohorts[0]).toBe(old);
});

it("can remove every retained conversation without creating a replacement session", () => {
  const f = fixture();
  f.views.register(1, f.input).release();
  const old = required(f.views.getSnapshot().cohorts[0]);
  const hold = required(
    f.holds.acquire("removing", ["one", "two"], () => true),
  );
  const next = required(
    f.views.pruneRetained(old, ["one", "two"], hold.isCurrent),
  );
  expect(next.state.layout.tabs).toEqual([]);
  expect(next.state.layout.activeTabId).toBe("");
  expect(next.state.report.referencedSessionIds).toEqual([]);
  expect(next.state.layout.sessions).toEqual([]);
});
