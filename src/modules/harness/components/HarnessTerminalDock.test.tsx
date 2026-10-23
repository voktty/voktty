// @vitest-environment happy-dom
import { act, useContext, useLayoutEffect } from "react";
import { HarnessTerminalRecovery } from "@/modules/harness/hooks/useHarnessTerminalRecovery";
import { asTabKey } from "@/modules/tabs/lib/tabIdentity";
import {
  TerminalSurfaceProvider,
  useTerminalSurfaceController,
} from "@/modules/terminal/TerminalSurface";
import { normalizeProjectPath } from "@/modules/harness/lib/recents";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, assert, expect, it, vi } from "vitest";
import { HarnessApp } from "@/modules/harness/components/HarnessApp";
import { HarnessTerminalOwner } from "@/modules/harness/hooks/harnessTerminalContext";
import { CanonicalTerminalCatalog } from "@/modules/terminal/CanonicalTerminalCatalog";
import {
  claimProjectTerminalRequest,
  PROJECT_TERMINAL_REQUEST_EVENT,
} from "@/modules/terminal/lib/projectTerminalRequest";
import { createPersistenceAdmission } from "@/modules/harness/lib/persistenceAdmission";
import { createTabIdentity } from "@/modules/tabs/lib/tabIdentity";
import { newSession } from "@/modules/harness/lib/session";
import type { Tab, TerminalTab, HarnessTab } from "@/modules/tabs";
import type { PersistencePermit } from "@/modules/harness/lib/persistenceAdmission";
import {
  newEditorPane,
  newFileTab,
  newTab,
  newTerminalFile,
  newTerminalWorkspaceTab,
  splitPane,
} from "@/modules/harness/lib/layout";
import type { ResumedWorkspace } from "@/modules/harness/lib/inFlight";
type PaneProps = Parameters<
  typeof import("@/modules/harness/surfaces/PaneTree").PaneTree
>[0];
type SidebarProps = Parameters<
  typeof import("@/modules/harness/chrome/Sidebar").Sidebar
>[0];
type DockProps = Parameters<
  typeof import("@/modules/harness/surfaces/ProjectTerminalDock").ProjectTerminalDock
>[0];
type ViewState = ReturnType<
  Parameters<
    typeof import("@/modules/harness/hooks/useHarnessViewRegistration").useHarnessViewRegistration
  >[0]["read"]
>;

const state = vi.hoisted(() => ({
  sidebar: null as SidebarProps | null,
  dock: null as DockProps | null,
  view: null as ViewState | null,
  pane: null as PaneProps | null,
  recover: null as React.ContextType<typeof HarnessTerminalRecovery>,
  capture: (): PersistencePermit | null | undefined => undefined,
  runtime: null as unknown,
  error: vi.fn(),
  close: vi.fn(),
  focus: vi.fn(),
  admit: vi.fn(),
  stop: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("@/modules/harness/components/HarnessWindowHost", () => ({
  useHarnessWindow: () => state.runtime,
}));
vi.mock("@/modules/harness/hooks/useHarnessViewEngine", () => ({
  useHarnessViewEngine: () => ({
    updateSessions: vi.fn(),
    admitSession: state.admit,
    onStop: state.stop,
    removeSession: state.remove,
  }),
}));
vi.mock("@/modules/harness/hooks/useWindowPersistenceAdmission", () => ({
  useWindowPersistenceAdmission: () => ({
    getOwner: () => ({ capture: state.capture }),
    revision: 0,
  }),
}));
vi.mock("@/modules/harness/hooks/useHarnessViewRegistration", () => ({
  useHarnessViewRegistration: (props: { read: () => ViewState }) => {
    state.view = props.read();
  },
}));
vi.mock("@/modules/harness/hooks/useInitialHarnessSession", () => ({
  useInitialHarnessSession: () => {},
}));
vi.mock("@/modules/harness/hooks/useHarnessSummaryUpdates", () => ({
  useHarnessSummaryUpdates: () => {},
}));
vi.mock("@/modules/harness/hooks/useInboxUnseen", () => ({
  useInboxUnseen: () => {},
}));
vi.mock("@/modules/harness/hooks/useSessionReminders", () => ({
  useSessionReminders: () => ({ reminders: [], due: [] }),
}));
vi.mock("@/modules/harness/hooks/useSidebarLayout", () => ({
  useSidebarLayout: () => "deck",
}));
vi.mock("@/modules/harness/hooks/useProjectBranches", () => ({
  useProjectBranches: () => undefined,
}));
const cancel = () => {};
vi.mock("@/modules/harness/hooks/useWorkspaceNavigation", () => ({
  useWorkspaceNavigation: () => ({
    cancel,
    selectProject: cancel,
    selectWorkspace: cancel,
    revision: 0,
  }),
}));
vi.mock("@/modules/harness/chrome/Sidebar", () => ({
  Sidebar: (props: SidebarProps) => {
    state.sidebar = props;
    return null;
  },
}));
vi.mock("@/modules/harness/chrome/TitleBar", () => ({ TitleBar: () => null }));
vi.mock("@/modules/harness/chrome/UsageFooter", () => ({
  UsageFooter: () => null,
}));
vi.mock("@/modules/harness/chrome/HarnessUpdateNotice", () => ({
  HarnessUpdateNotice: () => null,
}));
vi.mock("@/modules/harness/surfaces/PaneTree", () => ({
  PaneTree: (props: PaneProps) => {
    state.pane = props;
    state.recover = useContext(HarnessTerminalRecovery);
    return null;
  },
}));
vi.mock("@/modules/harness/surfaces/ProjectTerminalDock", () => ({
  ProjectTerminalDock: (props: DockProps) => {
    state.dock = props;
    state.recover = useContext(HarnessTerminalRecovery);
    const surfaces = useTerminalSurfaceController();
    const reference = props.dock.open
      ? props.dock.pane.files.find(
          (file) => file.id === props.dock.pane.activeFileId,
        )?.canonicalTerminal
      : undefined;
    useLayoutEffect(() => {
      if (!reference || !surfaces) return;
      const receipt = surfaces.register({
        ...reference,
        ownerTabKey: ownerKey,
        slotKey: `dock:${normalizeProjectPath(props.dock.projectPath)}`,
        focused: true,
        rect: { left: 0, top: 0, width: 0, height: 0 },
      });
      return receipt.release;
    }, [surfaces, reference, props.dock.projectPath]);
    return null;
  },
}));
vi.mock("@/modules/harness/lib/harness", () => ({
  isLiveHarness: () => false,
  pickTextHarness: () => "claude",
  refreshHarnessCatalogs: vi.fn(),
}));
vi.mock("@/modules/harness/lib/fileIndex", () => ({
  prefetchProjectFiles: () => {},
  invalidateProjectFiles: () => {},
  rememberOpenedFile: () => {},
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue([]),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onFocusChanged: vi.fn().mockResolvedValue(() => {}),
  }),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  message: state.error,
  ask: vi.fn().mockResolvedValue(true),
}));

const project = "/srv/app";
const identity = createTabIdentity("main", () => "terminal");
const terminal: TerminalTab = {
  id: 42,
  ...identity,
  spaceId: "main",
  kind: "terminal",
  title: "shell",
  cwd: project,
  projectCwd: project,
  paneTree: { kind: "leaf", id: 43 },
  activeLeafId: 43,
};
const ownerKey = createTabIdentity("main", () => "owner").tabKey;
const secondTerminal = {
  ...terminal,
  id: 50,
  ...createTabIdentity("main", () => "second"),
};
const thirdTerminal = {
  ...terminal,
  id: 60,
  ...createTabIdentity("main", () => "third"),
};
let root: Root;
let node: HTMLDivElement;
let admission: ReturnType<typeof createPersistenceAdmission>;
let claims: Array<NonNullable<ReturnType<typeof claimProjectTerminalRequest>>>;
let autoConfirm: boolean;
function required<T>(value: T | null | undefined): T {
  assert(value != null);
  return value;
}
const sidebar = () => required(state.sidebar);
const dock = () => required(state.dock);
const view = () => required(state.view);
function handle(event: Event) {
  const ticket = claimProjectTerminalRequest(event, ownerKey, project);
  if (!ticket) return;
  claims.push(ticket);
  if (autoConfirm) {
    ticket.created({
      tabKey: [terminal, secondTerminal, thirdTerminal][claims.length - 1]
        .tabKey,
    });
    ticket.finish();
  }
}
function Host({
  tabs = [terminal],
  focused = true,
  currentProject = project,
  resumed,
}: {
  tabs?: Tab[];
  focused?: boolean;
  currentProject?: string;
  resumed?: ResumedWorkspace;
}) {
  return (
    <TerminalSurfaceProvider>
      <CanonicalTerminalCatalog
        tabs={[
          {
            ...createTabIdentity("main", () => "owner"),
            tabKey: ownerKey,
            id: 1,
            kind: "harness",
            title: "Harness",
            spaceId: "main",
            cwd: currentProject,
          } satisfies HarnessTab,
          ...tabs,
        ]}
        activeId={1}
        onClose={state.close}
      >
        <HarnessTerminalOwner
          value={{ tabKey: ownerKey, visible: true, onFocus: state.focus }}
        >
          <HarnessApp
            surfaceOwnerId={1}
            initialCwd={currentProject}
            focused={focused}
            resumed={resumed}
          />
        </HarnessTerminalOwner>
      </CanonicalTerminalCatalog>
    </TerminalSurfaceProvider>
  );
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  vi.clearAllMocks();
  state.sidebar = null;
  state.dock = null;
  state.view = null;
  admission = createPersistenceAdmission();
  const owner = admission.createOwner();
  state.capture = () => owner.capture();
  const session = newSession("cursor", project);
  state.runtime = {
    engine: {
      sessions: [session],
      sessionsRef: { current: [session] },
      readSession: () => undefined,
    },
    views: { getSnapshot: () => ({ cohorts: [] }) },
    projects: { has: () => false },
    holds: { has: () => false },
    unseenFinishedIds: new Set(),
    transcripts: {},
    summaries: {},
    automations: {},
  };
  claims = [];
  autoConfirm = true;
  window.addEventListener(PROJECT_TERMINAL_REQUEST_EVENT, handle);
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(async () => {
  await act(async () => root.unmount());
  for (const ticket of claims) ticket.finish();
  window.removeEventListener(PROJECT_TERMINAL_REQUEST_EVENT, handle);
  node.remove();
  vi.unstubAllGlobals();
});
it("creates a dock reference through the production App action before displaying any legacy terminal", async () => {
  await act(async () => root.render(<Host />));
  await act(async () => required(sidebar().onNewTerminal)());
  expect(claims).toHaveLength(1);
  expect(state.focus).toHaveBeenCalledOnce();
  expect(view().projectTerminals[0].pane.files).toEqual([
    expect.objectContaining({
      canonicalTerminal: { tabKey: terminal.tabKey, projectCwd: project },
    }),
  ]);
  expect(dock().dock.pane.files[0].canonicalTerminal?.tabKey).toBe(
    terminal.tabKey,
  );
});
it.each(["dock", "pane"])(
  "explicitly recovers a missing %s reference through the real App creator",
  async (kind) => {
    const file = {
      ...newTerminalFile("/srv/app/src", "Build"),
      foreground: "old process",
      canonicalTerminal: { tabKey: asTabKey("missing"), projectCwd: project },
    };
    const tab = newTerminalWorkspaceTab(file);
    const { createProjectTerminal } = await import(
      "@/modules/harness/lib/projectTerminal"
    );
    const originalDock = createProjectTerminal(project, file);
    const resumed: ResumedWorkspace = {
      tabs: kind === "pane" ? [tab] : [],
      sessions: [],
      activeTabId: kind === "pane" ? tab.id : "",
      projectCwd: project,
      projectTerminals: kind === "dock" ? [originalDock] : [],
    };
    await act(async () => root.render(<Host resumed={resumed} />));
    expect(claims).toEqual([]);
    const slotKey =
      kind === "dock" ? `dock:${project}` : `pane:${tab.terminalPanes[0].id}`;
    let accepted = false;
    await act(async () => {
      accepted = required(state.recover)(file, slotKey, () => true, vi.fn());
    });
    expect(accepted).toBe(true);
    expect(claims).toHaveLength(1);
    expect(claims[0].cwd).toBe(file.cwd);
    const recovered =
      kind === "dock"
        ? view().projectTerminals[0].pane.files[0]
        : view().tabs[0].terminalPanes[0].files[0];
    expect(recovered).toEqual({
      ...file,
      foreground: undefined,
      canonicalTerminal: { tabKey: terminal.tabKey, projectCwd: project },
    });
    expect(state.admit).not.toHaveBeenCalled();
    expect(state.close).not.toHaveBeenCalled();
    expect(state.error).not.toHaveBeenCalled();
  },
);

it.each(["selection", "permit", "focus", "resolved"])(
  "rejects recovery after %s changes before creation confirms",
  async (reason) => {
    autoConfirm = false;
    const file = {
      ...newTerminalFile(project),
      canonicalTerminal: { tabKey: asTabKey("missing"), projectCwd: project },
    };
    const { createProjectTerminal } = await import(
      "@/modules/harness/lib/projectTerminal"
    );
    const originalDock = createProjectTerminal(project, file);
    const resumed: ResumedWorkspace = {
      tabs: [],
      sessions: [],
      activeTabId: "",
      projectCwd: project,
      projectTerminals: [originalDock],
    };
    const other = newTerminalFile(project);
    originalDock.pane.files.push(other);
    await act(async () => root.render(<Host resumed={resumed} />));
    await act(async () => {
      required(state.recover)(file, `dock:${project}`, () => true, vi.fn());
    });
    expect(claims).toHaveLength(1);
    if (reason === "selection")
      await act(async () => dock().onSelectTerminal(other.id));
    if (reason === "permit") admission.createOwner().capture()?.seal();
    if (reason === "focus")
      await act(async () =>
        root.render(<Host resumed={resumed} focused={false} />),
      );
    if (reason === "resolved")
      await act(async () =>
        root.render(
          <Host
            resumed={resumed}
            tabs={[
              terminal,
              { ...secondTerminal, tabKey: asTabKey("missing") },
            ]}
          />,
        ),
      );
    expect(claims[0].isCurrent()).toBe(false);
    expect(() => claims[0].created({ tabKey: terminal.tabKey })).toThrow();
    expect(state.close).not.toHaveBeenCalled();
  },
);
it("keeps a failed recovery retryable without dropping its original reference", async () => {
  autoConfirm = false;
  const file = {
    ...newTerminalFile(project),
    canonicalTerminal: { tabKey: asTabKey("missing"), projectCwd: project },
  };
  const { createProjectTerminal } = await import(
    "@/modules/harness/lib/projectTerminal"
  );
  const resumed: ResumedWorkspace = {
    tabs: [],
    sessions: [],
    activeTabId: "",
    projectCwd: project,
    projectTerminals: [createProjectTerminal(project, file)],
  };
  await act(async () =>
    root.render(<Host resumed={resumed} tabs={[terminal, secondTerminal]} />),
  );
  const settled = vi.fn();
  await act(async () => {
    required(state.recover)(file, `dock:${project}`, () => true, settled);
  });
  await act(async () => {
    claims[0].fail(new Error("Unavailable transport"));
    claims[0].finish();
  });
  expect(view().projectTerminals[0].pane.files).toEqual([file]);
  expect(settled).toHaveBeenCalledOnce();
  autoConfirm = true;
  await act(async () => {
    required(state.recover)(file, `dock:${project}`, () => true, vi.fn());
  });
  expect(claims).toHaveLength(2);
  expect(
    view().projectTerminals[0].pane.files[0].canonicalTerminal?.tabKey,
  ).toBe(secondTerminal.tabKey);
  expect(state.close).not.toHaveBeenCalled();
});

it("creates a canonical terminal beside an editor without mixing its file strip", async () => {
  const file = newFileTab("/srv/app/file.txt", project);
  const pane = newEditorPane(file);
  const tab = { ...newTab(pane.id), editorPanes: [pane] };
  const resumed: ResumedWorkspace = {
    tabs: [tab],
    sessions: [],
    activeTabId: tab.id,
    projectCwd: project,
    projectTerminals: [],
  };
  await act(async () => root.render(<Host resumed={resumed} />));
  await act(async () =>
    required(required(state.pane).onAddTerminalToPane)(pane.id),
  );
  expect(claims).toHaveLength(1);
  expect(view().tabs[0].editorPanes[0].files).toEqual([file]);
  expect(view().tabs[0].terminalPanes[0].files[0].canonicalTerminal).toEqual({
    tabKey: terminal.tabKey,
    projectCwd: project,
  });
  expect(state.focus).toHaveBeenCalledOnce();
});
it("requests the protected canonical close and keeps the reference through a veto", async () => {
  await act(async () => root.render(<Host />));
  await act(async () => required(sidebar().onNewTerminal)());
  const file = dock().dock.pane.files[0];
  await act(async () => dock().onCloseTerminal(file.id));
  expect(state.close).toHaveBeenCalledExactlyOnceWith(42);
  expect(view().projectTerminals[0].pane.files[0]).toEqual(file);
  await act(async () => root.render(<Host tabs={[]} />));
  expect(view().projectTerminals).toEqual([]);
});
it("prunes the last canonical pane after external close without replacing or stopping a conversation", async () => {
  const file = {
    ...newTerminalFile(project),
    canonicalTerminal: { tabKey: terminal.tabKey, projectCwd: project },
  };
  const tab = newTerminalWorkspaceTab(file);
  const resumed: ResumedWorkspace = {
    tabs: [tab],
    sessions: [],
    activeTabId: tab.id,
    projectCwd: project,
    projectTerminals: [],
  };
  await act(async () => root.render(<Host resumed={resumed} />));
  await act(async () => root.render(<Host resumed={resumed} tabs={[]} />));
  expect(view().tabs).toEqual([]);
  expect(view().activeTabId).toBe("");
  expect(state.close).not.toHaveBeenCalled();
  expect(state.error).not.toHaveBeenCalled();
  expect(state.admit).not.toHaveBeenCalled();
  expect(state.stop).not.toHaveBeenCalled();
  expect(state.remove).not.toHaveBeenCalled();
});
it("prunes closed canonical files from every pane while preserving physical editors and live conversations", async () => {
  const editor = newEditorPane(newFileTab("/srv/app/file.txt", project));
  const first = newTerminalWorkspaceTab({
    ...newTerminalFile(project),
    canonicalTerminal: { tabKey: terminal.tabKey, projectCwd: project },
  });
  const second = newTerminalWorkspaceTab({
    ...newTerminalFile(project),
    canonicalTerminal: { tabKey: secondTerminal.tabKey, projectCwd: project },
  });
  const mixed = {
    ...first,
    layout: splitPane(first.layout, first.focusedId, "right", editor.id),
    editorPanes: [editor],
  };
  const conversation = newTab(
    required(
      (
        state.runtime as {
          engine: { sessions: ReturnType<typeof newSession>[] };
        }
      ).engine.sessions[0],
    ).id,
  );
  const resumed: ResumedWorkspace = {
    tabs: [mixed, second, conversation],
    sessions: [],
    activeTabId: second.id,
    projectCwd: project,
    projectTerminals: [],
  };
  const confirm = vi.fn();
  vi.stubGlobal("confirm", confirm);
  await act(async () =>
    root.render(<Host resumed={resumed} tabs={[terminal, secondTerminal]} />),
  );
  await act(async () => root.render(<Host resumed={resumed} tabs={[]} />));
  expect(view().tabs).toHaveLength(2);
  expect(view().tabs[0]).toMatchObject({
    layout: { type: "leaf", id: editor.id },
    focusedId: editor.id,
    editorPanes: [editor],
    terminalPanes: [],
  });
  expect(view().tabs[1]).toBe(conversation);
  expect(view().tabs.some((tab) => tab.id === view().activeTabId)).toBe(true);
  expect(state.close).not.toHaveBeenCalled();
  expect(confirm).not.toHaveBeenCalled();
  expect(state.admit).not.toHaveBeenCalled();
  expect(state.stop).not.toHaveBeenCalled();
  expect(state.remove).not.toHaveBeenCalled();
});
it("routes close-other through one exact batch and waits for canonical removal", async () => {
  const tabs = [terminal, secondTerminal, thirdTerminal];
  await act(async () => root.render(<Host tabs={tabs} />));
  for (let index = 0; index < 3; index++) {
    await act(async () => required(sidebar().onNewTerminal)());
  }
  const keep = dock().dock.pane.files[0];
  await act(async () => required(dock().onCloseOtherTerminals)(keep.id));
  expect(state.close).toHaveBeenCalledExactlyOnceWith(50, [50, 60]);
  expect(view().projectTerminals[0].pane.files).toHaveLength(3);
  await act(async () => root.render(<Host tabs={[terminal]} />));
  expect(view().projectTerminals[0].pane.files).toEqual([keep]);
});
it("retains an unseen reference and waits for fresh authority before pruning an observed disappearance", async () => {
  const file = {
    ...newTerminalFile(project),
    canonicalTerminal: { tabKey: terminal.tabKey, projectCwd: project },
  };
  const tab = newTerminalWorkspaceTab(file);
  const resumed: ResumedWorkspace = {
    tabs: [tab],
    sessions: [],
    activeTabId: tab.id,
    projectCwd: project,
    projectTerminals: [],
  };
  await act(async () => root.render(<Host resumed={resumed} tabs={[]} />));
  expect(view().tabs).toEqual([tab]);
  await act(async () => root.render(<Host resumed={resumed} />));
  const capture = state.capture;
  state.capture = () => undefined;
  await act(async () => root.render(<Host resumed={resumed} tabs={[]} />));
  expect(view().tabs).toEqual([tab]);
  state.capture = capture;
  await act(async () => root.render(<Host resumed={resumed} tabs={[]} />));
  expect(view().tabs).toEqual([]);
  expect(state.close).not.toHaveBeenCalled();
  expect(state.admit).not.toHaveBeenCalled();
});
it("routes the close shortcut from the canonical overlay to its dock terminal", async () => {
  await act(async () => root.render(<Host />));
  await act(async () => required(sidebar().onNewTerminal)());
  const surface = document.createElement("div");
  surface.dataset.terminalTab = "42";
  const input = document.createElement("button");
  surface.append(input);
  node.append(surface);
  await act(async () => dock().onFocus());
  input.focus();
  await act(async () =>
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "w",
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  expect(state.close).toHaveBeenCalledExactlyOnceWith(42);
  expect(view().projectTerminals[0].pane.files).toHaveLength(1);
});
it.each(["unmount", "project", "focus", "permit"])(
  "rejects a late dock creation after %s retirement",
  async (reason) => {
    autoConfirm = false;
    await act(async () => root.render(<Host />));
    await act(async () => required(sidebar().onNewTerminal)());
    expect(claims).toHaveLength(1);
    if (reason === "unmount") await act(async () => root.render(null));
    else if (reason === "project")
      await act(async () => root.render(<Host currentProject="/srv/other" />));
    else if (reason === "focus")
      await act(async () => root.render(<Host focused={false} />));
    else {
      admission.createOwner().capture()?.seal();
    }
    expect(claims[0].isCurrent()).toBe(false);
    if (reason !== "permit") expect(claims[0].signal.aborted).toBe(true);
    expect(() => claims[0].created({ tabKey: terminal.tabKey })).toThrow();
    expect(view().projectTerminals).toEqual([]);
    expect(state.focus).not.toHaveBeenCalled();
  },
);
it.each(["button", "shortcut"])(
  "cancels only pending creation when hiding a dock by %s and preserves its existing terminal",
  async (method) => {
    await act(async () => root.render(<Host />));
    await act(async () => required(sidebar().onNewTerminal)());
    const file = dock().dock.pane.files[0];
    autoConfirm = false;
    await act(async () => dock().onAddTerminal());
    expect(claims).toHaveLength(2);
    await act(async () => {
      if (method === "button") dock().onHide();
      else
        window.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "j",
            metaKey: true,
            bubbles: true,
            cancelable: true,
          }),
        );
    });
    expect(claims[1].signal.aborted).toBe(true);
    expect(claims[1].isCurrent()).toBe(false);
    expect(view().projectTerminals[0].open).toBe(false);
    expect(view().projectTerminals[0].pane.files).toEqual([file]);
    expect(state.close).not.toHaveBeenCalled();
  },
);
