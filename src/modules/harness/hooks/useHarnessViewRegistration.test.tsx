// @vitest-environment happy-dom
import { act, StrictMode, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useHarnessViewRegistration } from "@/modules/harness/hooks/useHarnessViewRegistration";
import { createHarnessWindowViews } from "@/modules/harness/lib/harnessWindowViews";
import { createHarnessWindowSessionHolds } from "@/modules/harness/lib/harnessWindowSessionHolds";
import { createHarnessWindowViewRemoval } from "@/modules/harness/lib/harnessWindowViewRemoval";
import { createHarnessWindowNavigation } from "@/modules/harness/lib/harnessWindowNavigation";
import { createPersistenceAdmission } from "@/modules/harness/lib/persistenceAdmission";
import {
  leafIds,
  newTab,
  type WorkspaceTab,
} from "@/modules/harness/lib/layout";

let root: Root;
let host: HTMLDivElement;
const project = "/work/project";

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function mount() {
  const admission = createPersistenceAdmission();
  const source = admission.createOwner();
  const target = admission.createOwner();
  const holds = createHarnessWindowSessionHolds();
  const views = createHarnessWindowViews(holds);
  const removals = createHarnessWindowViewRemoval(views, holds);
  const navigation = createHarnessWindowNavigation(views);
  const runtime = {
    holds,
    views,
    removals,
    navigation,
    admitSeeds: () => true,
    engine: { flushForegroundHarnessEvents: vi.fn() },
  } as unknown as Parameters<typeof useHarnessViewRegistration>[0]["runtime"];
  const fileTab: WorkspaceTab = {
    ...newTab("editor"),
    editorPanes: [
      {
        id: "editor",
        activeFileId: "file",
        files: [{ id: "file", path: "/work/project/file", cwd: project }],
      },
    ],
  };
  const terminalTab: WorkspaceTab = {
    ...newTab("terminal"),
    terminalPanes: [
      {
        id: "terminal",
        activeFileId: "pty",
        files: [{ id: "pty", path: "terminal", cwd: project, terminal: true }],
      },
    ],
  };
  const input = (tabs: WorkspaceTab[], activeTabId = tabs[0]?.id ?? "") => ({
    tabs,
    activeTabId,
    projectCwd: project,
    projectTerminals: [],
    projectReturnMemory: new Map([[project, "shared"]]),
    report: {
      referencedSessionIds: tabs
        .flatMap((tab) => leafIds(tab.layout))
        .filter((id) => id === "shared"),
      foregroundSessionIds: [],
      activeSessionId: null,
    },
  });
  views.register(1, input([newTab("shared")]));
  const retained = views.register(3, input([newTab("shared")]));
  retained.release();
  let change!: () => void;
  const committed = vi.fn();
  function View() {
    const [tabs, setTabs] = useState([newTab("shared"), fileTab, terminalTab]);
    const [active, setActive] = useState(tabs[0].id);
    const memory = useRef(new Map([[project, "shared"]]));
    change = () => setTabs((current) => [...current, newTab("other")]);
    useHarnessViewRegistration({
      runtime,
      ownerId: 2,
      seeds: [],
      revision: tabs,
      getOwner: () => target,
      openSession: async () => false,
      activate: () => true,
      read: () => ({
        ...input(tabs, active),
        projectReturnMemory: memory.current,
      }),
      applyRemoval: (next) => {
        memory.current = new Map(next.returnTargets);
        setTabs(next.layout.tabs);
        setActive(next.layout.activeTabId);
      },
    });
    return (
      <div
        ref={() => {
          committed(tabs);
        }}
      >
        {tabs.flatMap((tab) => leafIds(tab.layout)).join(",")}
      </div>
    );
  }
  await act(async () =>
    root.render(
      <StrictMode>
        <View />
      </StrictMode>,
    ),
  );
  const permit = source.capture();
  if (!permit) throw new Error("Missing source permit");
  return {
    permit,
    source,
    target,
    views,
    holds,
    removals,
    change: () => change(),
    committed,
    fileTab,
    terminalTab,
  };
}

it("commits React and prunes retained references before permitting a global write", async () => {
  const fixture = await mount();
  const operation = await fixture.removals.prepare(
    1,
    ["shared"],
    fixture.permit,
  );
  expect(operation).not.toBeNull();
  if (!operation) throw new Error("Missing removal operation");
  const write = vi.fn(async () => {
    expect(host.textContent).toBe("editor,terminal");
    expect(
      fixture.views
        .getSnapshot()
        .cohorts.filter((cohort) => cohort.ownerId !== 1)
        .every(
          (cohort) =>
            !cohort.state.report.referencedSessionIds.includes("shared"),
        ),
    ).toBe(true);
  });
  expect(await operation.run(write)).toBe(false);
  expect(write).not.toHaveBeenCalled();
  await act(async () => {
    expect(await operation.commit()).toBe(true);
  });
  expect(fixture.committed.mock.lastCall?.[0]).toEqual([
    fixture.fileTab,
    fixture.terminalTab,
  ]);
  expect(await operation.run(write)).toBe(true);
  expect(fixture.holds.has("removing", "shared")).toBe(true);
  operation.release();
  expect(fixture.holds.hasAny("shared")).toBe(false);
});

it("vetoes a prepared removal when the participant changes its layout", async () => {
  const fixture = await mount();
  const operation = await fixture.removals.prepare(
    1,
    ["shared"],
    fixture.permit,
  );
  if (!operation) throw new Error("Missing removal operation");
  await act(async () => fixture.change());
  expect(await operation.commit()).toBe(false);
  expect(host.textContent).toContain("shared");
  expect(host.textContent).toContain("other");
  operation.release();
});

it("does not enqueue a React update after the participant permit retires", async () => {
  const fixture = await mount();
  const operation = await fixture.removals.prepare(
    1,
    ["shared"],
    fixture.permit,
  );
  if (!operation) throw new Error("Missing removal operation");
  fixture.target.retire();
  await act(async () => {
    expect(await operation.commit()).toBe(false);
  });
  expect(host.textContent).toContain("shared");
  operation.release();
});

it("rejects an operation after the registered React view unmounts", async () => {
  const fixture = await mount();
  const operation = await fixture.removals.prepare(
    1,
    ["shared"],
    fixture.permit,
  );
  if (!operation) throw new Error("Missing removal operation");
  await act(async () => root.render(null));
  expect(await operation.commit()).toBe(false);
  expect(fixture.holds.hasAny("shared")).toBe(false);
  operation.release();
});
