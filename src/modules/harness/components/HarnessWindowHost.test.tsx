// @vitest-environment happy-dom
import {
  act,
  Component,
  StrictMode,
  useLayoutEffect,
  type ReactNode,
} from "react";
import { useInboxUnseen } from "@/modules/harness/hooks/useInboxUnseen";
import { useHarnessReminderWindow } from "@/modules/harness/hooks/useHarnessReminderWindow";
import { useSessionReminders } from "@/modules/harness/hooks/useSessionReminders";
import { useWindowPersistenceAdmission } from "@/modules/harness/hooks/useWindowPersistenceAdmission";
import { useHarnessSummaryUpdates } from "@/modules/harness/hooks/useHarnessSummaryUpdates";
import {
  useHarnessViewEngine,
  type HarnessViewEngine,
} from "@/modules/harness/hooks/useHarnessViewEngine";
import { useHarnessViewRegistration } from "@/modules/harness/hooks/useHarnessViewRegistration";
import { HarnessApp } from "@/modules/harness/components/HarnessApp";
import { HarnessStack } from "@/modules/harness/components/HarnessStack";
import "@/modules/harness/components/HarnessRuntimeBootstrap";
import type { HarnessTab } from "@/modules/tabs";
import type { HarnessSummarySource } from "@/modules/harness/lib/harnessSummaryUpdates";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  HarnessWindowHost,
  useHarnessWindow,
} from "@/modules/harness/components/HarnessWindowHost";
import { abortQuit } from "@/modules/harness/lib/appLifecycle";
import { rememberRemoteProject } from "@/modules/connections/model/remoteProjects";
import { windowCloseParticipants } from "@/modules/lifecycle/windowCloseParticipants";
import type { HarnessEvent } from "@/modules/harness/lib/harness";
import type {
  HarnessWindowViewCohort,
  HarnessWindowViewInput,
} from "@/modules/harness/lib/harnessWindowViews";
import type {
  CreateHarnessNavigationView,
  HarnessNavigationTarget,
  HarnessNavigationView,
} from "@/modules/harness/lib/harnessWindowNavigation";
import { leafIds, newTab } from "@/modules/harness/lib/layout";
import { newSession, type Session } from "@/modules/harness/lib/session";
import type { InboxItem } from "@/modules/harness/lib/githubTasks";
import { publishActiveSurface } from "@/modules/surfaces";
import {
  newAutomationDraft,
  type Automation,
  type AutomationRun,
} from "@/modules/harness/lib/automations";

const native = vi.hoisted(() => ({
  invoke: vi.fn(),
  register: vi.fn(),
  ask: vi.fn(),
  error: vi.fn(),
  send: vi.fn(),
  cancel: vi.fn(),
  forget: vi.fn(),
  bind: vi.fn(),
  builtins: vi.fn(),
  probe: vi.fn().mockResolvedValue(undefined),
  catalogs: vi.fn().mockResolvedValue(undefined),
  panes: new Map<
    string,
    Parameters<typeof import("@/modules/harness/surfaces/PaneTree").PaneTree>[0]
  >(),
  sidebars: [] as Parameters<
    typeof import("@/modules/harness/chrome/Sidebar").Sidebar
  >[0][],
  approval: vi.fn(),
  bridge: vi.fn(),
  stopBridge: vi.fn(),
  focus: vi.fn(),
  badge: vi.fn(),
  notify: vi.fn().mockResolvedValue(false),
  recover: vi.fn(),
  listAutomations: vi.fn(),
  updateRun: vi.fn(),
  claim: vi.fn(),
  pending: vi.fn(),
  inboxList: vi.fn(),
  details: vi.fn(),
  inboxes: [] as Parameters<
    typeof import("@/modules/harness/surfaces/InboxView").InboxView
  >[0][],
  reminderList: vi.fn(),
  takeReminder: vi.fn(),
  listen: vi.fn(),
  listeners: new Map<string, Set<() => void>>(),
}));
vi.mock("@/modules/harness/lib/githubTasks", async (original) => ({
  ...(await original<typeof import("@/modules/harness/lib/githubTasks")>()),
  listInboxItems: native.inboxList,
  githubWorkItemDetails: native.details,
  peekGithubWorkItemDetails: () => undefined,
}));
vi.mock("@/modules/harness/surfaces/InboxView", () => ({
  InboxDetailPane: () => null,
  InboxView: (
    props: Parameters<
      typeof import("@/modules/harness/surfaces/InboxView").InboxView
    >[0],
  ) => {
    native.inboxes.push(props);
    return null;
  },
}));
vi.mock("@/modules/harness/chrome/Sidebar", () => ({
  Sidebar: (
    props: Parameters<
      typeof import("@/modules/harness/chrome/Sidebar").Sidebar
    >[0],
  ) => {
    native.sidebars.push(props);
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
vi.mock("@/modules/harness/hooks/useProjectBranches", () => ({
  useProjectBranches: () => undefined,
}));
vi.mock("@/modules/harness/surfaces/PaneTree", () => ({
  PaneTree: (
    props: Parameters<
      typeof import("@/modules/harness/surfaces/PaneTree").PaneTree
    >[0],
  ) => {
    const ids = new Set(leafIds(props.layout));
    for (const session of props.sessions)
      if (ids.has(session.id)) native.panes.set(session.id, props);
    return null;
  },
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
vi.mock("@/modules/harness/lib/harness/registry", async (original) => ({
  ...(await original<
    typeof import("@/modules/harness/lib/harness/registry")
  >()),
  forgetHarnessSession: native.forget,
  bindHarnessSession: native.bind,
  isLiveHarness: () => true,
  pickTextHarness: () => "claude",
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: native.listen }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onCloseRequested: native.register,
    onFocusChanged: native.focus,
  }),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  ask: native.ask,
  message: native.error,
}));
vi.mock("@/modules/harness/lib/settings", async (original) => ({
  ...(await original<typeof import("@/modules/harness/lib/settings")>()),
  loadCloseToTray: () => false,
}));
vi.mock("@/modules/harness/lib/harness", async () => ({
  ...(await import("@/modules/harness/lib/harness/apply")),
  isLiveHarness: () => true,
  canSteerHarness: () => true,
  pickTextHarness: () => "claude",
  sendHarnessTurn: native.send,
  cancelHarnessTurn: native.cancel,
  generateHarnessTitle: vi.fn().mockResolvedValue(undefined),
  forgetHarnessSession: native.forget,
  canRewindHarnessLastTurn: () => false,
  respondHarnessApproval: native.approval,
  bindHarnessSession: native.bind,
  registerBuiltinHarnesses: native.builtins,
  probeHarnessAvailability: native.probe,
  refreshHarnessCatalogs: native.catalogs,
  startHarnessBridge: native.bridge,
}));
vi.mock("@/modules/harness/lib/checkpoint", () => ({
  beginSessionTurn: vi.fn().mockResolvedValue(undefined),
  syncSessionCheckpoint: vi.fn().mockResolvedValue(undefined),
  flushSessionCheckpoint: vi.fn().mockResolvedValue(undefined),
  notifyReviewChanged: vi.fn(),
  prepareSessionCheckpoint: vi.fn().mockResolvedValue(undefined),
  captureSessionCheckpoint: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/modules/harness/lib/attachments", async (original) => ({
  ...(await original<typeof import("@/modules/harness/lib/attachments")>()),
  displayAttachments: (files: unknown) => files,
  prepareAttachments: async (files: unknown) => files,
}));
vi.mock("@/modules/harness/lib/promptPreparation", () => ({
  preparePrompt: async (text: string) => text,
}));
vi.mock("@/modules/harness/lib/providerAccounts", async (original) => ({
  ...(await original<
    typeof import("@/modules/harness/lib/providerAccounts")
  >()),
  supportsProviderAccounts: () => false,
}));
vi.mock("@/modules/harness/lib/dockBadge", () => ({
  syncDockBadge: native.badge,
}));
vi.mock("@/modules/harness/lib/notifications", async (original) => ({
  ...(await original<typeof import("@/modules/harness/lib/notifications")>()),
  notifySession: native.notify,
}));
vi.mock("@/modules/harness/lib/sounds", () => ({
  playCue: vi.fn(),
  noteInboxUnseen: vi.fn(),
  loadSoundsEnabled: () => true,
  SOUNDS_CHANGE_EVENT: "sounds",
}));
vi.mock("@/modules/harness/lib/fileWatch", () => ({
  nudgeWatchedFiles: vi.fn(),
}));
vi.mock("@/modules/harness/lib/fileIndex", () => ({
  invalidateProjectFiles: vi.fn(),
  prefetchProjectFiles: vi.fn(),
  rememberOpenedFile: vi.fn(),
  resolveFileOpenRequest: async (_cwd: string, path: string) => path,
}));
vi.mock("@/modules/harness/lib/fileTree", () => ({
  notifyDirsChanged: vi.fn(),
}));
vi.mock("@/modules/harness/lib/fs", () => ({
  notifyGitChanged: vi.fn(),
  basename: (path: string) => path.split(/[\\/]/).pop() ?? path,
  invokeWorkspace: async (command: string) => {
    if (command === "read_text_file") throw new Error("path does not exist");
    if (command === "write_text_file") return;
    throw new Error(`Unexpected remote fixture command: ${command}`);
  },
}));

function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("Missing host fixture");
  return value;
}

function fixture(id: string, cwd: string) {
  const session: Session = {
    ...newSession("claude", cwd),
    id,
    title: "Named session",
    blocks: [{ id: `${id}-user`, role: "user", text: "previous turn" }],
  };
  const tab = newTab(session.id);
  const input: HarnessWindowViewInput = {
    tabs: [tab],
    activeTabId: tab.id,
    projectCwd: cwd,
    projectReturnMemory: new Map([[cwd, session.id]]),
    projectTerminals: [],
    report: {
      referencedSessionIds: [id],
      foregroundSessionIds: [id],
      activeSessionId: id,
    },
  };
  return { session, input };
}

function automationFixture(id: string, cwd = "/work/one") {
  const automation: Automation = {
    ...newAutomationDraft(cwd, "claude", "default"),
    id: `automation-${id}`,
    name: "Scheduled task",
    prompt: "Run the scheduled task",
    nextRunAt: 1,
    createdAt: 1,
    updatedAt: 1,
  };
  const run: AutomationRun = {
    id,
    automationId: automation.id,
    trigger: "scheduled",
    scheduledFor: 1,
    createdAt: 1,
    status: "pending",
  };
  return { automation, run };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

type Runtime = ReturnType<typeof useHarnessWindow>;
type ViewProps = {
  ownerId: number;
  input: HarnessWindowViewInput;
  restore?: HarnessWindowViewCohort;
};
let runtime: Runtime | null;
let viewEngines: HarnessViewEngine[];
let root: Root;
let container: HTMLDivElement;
let closeListeners: ((event: { preventDefault: () => void }) => void)[];
let sends: {
  id: string;
  sink: (event: HarnessEvent) => void;
  finish: () => void;
}[];

function View({ ownerId, input, restore }: ViewProps) {
  const { views } = useHarnessWindow();
  useLayoutEffect(() => {
    const handle = restore
      ? required(views.restore(ownerId, restore))
      : views.register(ownerId, input);
    return () => handle.release();
  }, [views, ownerId, input, restore]);
  return null;
}
function Observe() {
  runtime = useHarnessWindow();
  return null;
}
function EngineReader({ index = 0 }: { index?: number }) {
  const host = useHarnessWindow();
  const { getOwner } = useWindowPersistenceAdmission(() => undefined);
  viewEngines[index] = useHarnessViewEngine(host.engine, getOwner, host.holds);
  return null;
}
function RegisteredView({
  ownerId = 1,
  input,
  seeds = [],
  openSession = async () => true,
  activate = () => true,
  onRegistered,
  rejectRegistration = false,
}: {
  ownerId?: number;
  input: HarnessWindowViewInput;
  seeds?: Session[];
  openSession?: HarnessNavigationTarget["openSession"];
  activate?: HarnessNavigationTarget["activate"];
  onRegistered?: (view: HarnessNavigationView) => void;
  rejectRegistration?: boolean;
}) {
  const runtime = useHarnessWindow();
  const { getOwner } = useWindowPersistenceAdmission(() => undefined);
  useHarnessViewRegistration({
    runtime: rejectRegistration
      ? {
          ...runtime,
          navigation: {
            ...runtime.navigation,
            register: rejectViewRegistration,
          },
        }
      : runtime,
    ownerId,
    seeds,
    revision: input,
    read: () => input,
    getOwner,
    openSession,
    activate,
    onRegistered,
  });
  return null;
}
const rejectViewRegistration = () => null;
class RegistrationBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}
function NavigationView({
  ownerId,
  input,
  openSession,
  activate,
  onBound,
}: {
  ownerId: number;
  input: HarnessWindowViewInput;
  openSession: HarnessNavigationTarget["openSession"];
  activate: HarnessNavigationTarget["activate"];
  onBound?: (view: HarnessNavigationView) => void;
}) {
  const {
    views,
    navigation: { register },
  } = useHarnessWindow();
  const { getOwner } = useWindowPersistenceAdmission(() => undefined);
  useLayoutEffect(() => {
    const view = views.register(ownerId, input);
    const binding = required(
      register(ownerId, {
        isCurrent: view.isCurrent,
        capture: () => getOwner()?.capture() ?? null,
        openSession,
        activate,
      }),
    );
    onBound?.(binding);
    return () => {
      binding.release();
      view.release();
    };
  }, [
    views,
    register,
    ownerId,
    input,
    getOwner,
    openSession,
    activate,
    onBound,
  ]);
  return null;
}
beforeEach(() => {
  localStorage.clear();
  native.reminderList.mockReset().mockResolvedValue([]);
  native.takeReminder.mockReset().mockResolvedValue(null);
  native.listeners.clear();
  native.listen
    .mockReset()
    .mockImplementation(async (event: string, handler: () => void) => {
      const handlers = native.listeners.get(event) ?? new Set();
      handlers.add(handler);
      native.listeners.set(event, handlers);
      return () => {
        handlers.delete(handler);
      };
    });
  native.inboxList.mockReset().mockResolvedValue({ items: [], errors: {} });
  native.details.mockReset().mockResolvedValue({ body: "Inbox details" });
  native.inboxes.length = 0;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers({
    toFake: [
      "setTimeout",
      "clearTimeout",
      "setInterval",
      "clearInterval",
      "requestAnimationFrame",
      "cancelAnimationFrame",
    ],
  });
  runtime = null;
  viewEngines = [];
  closeListeners = [];
  sends = [];
  native.invoke
    .mockReset()
    .mockImplementation(async (command: string, args) => {
      if (command === "reminder_list") return native.reminderList();
      if (command === "reminder_take_pending_open")
        return native.takeReminder();
      if (command === "automation_runs_recover") return native.recover(args);
      if (command === "automation_runs_pending") return native.pending(args);
      if (command === "automations_list") return native.listAutomations();
      if (command === "automation_run_update") return native.updateRun(args);
      if (command === "automation_run_start")
        return native.updateRun({ ...args, status: "running" });
      if (command === "automations_claim_due") return native.claim(args);
      if (command === "session_upsert_batch")
        return args.sessions.map((session: Session) => ({
          ...session,
          createdAt: 1,
          updatedAt: 1,
        }));
      if (command === "session_upsert")
        return { ...args.session, createdAt: 1, updatedAt: 1 };
      return undefined;
    });
  native.ask.mockReset().mockResolvedValue(true);
  native.error.mockReset().mockResolvedValue(undefined);
  native.recover.mockReset().mockResolvedValue([]);
  native.pending.mockReset().mockResolvedValue({ runs: [], nextAfter: null });
  native.listAutomations.mockReset().mockResolvedValue([]);
  native.claim.mockReset().mockResolvedValue(null);
  native.updateRun.mockReset().mockImplementation(async (args) => ({
    id: args.runId,
    status: args.status,
  }));
  native.register.mockReset().mockImplementation((listener) => {
    closeListeners.push(listener);
    return Promise.resolve(() => undefined);
  });
  native.approval.mockReset();
  native.cancel.mockReset().mockResolvedValue(undefined);
  native.forget.mockReset().mockResolvedValue(undefined);
  native.bind.mockReset();
  native.builtins.mockReset();
  native.panes.clear();
  native.sidebars.length = 0;
  native.probe.mockReset().mockResolvedValue(undefined);
  native.catalogs.mockReset().mockResolvedValue(undefined);
  native.focus.mockReset().mockResolvedValue(() => undefined);
  native.badge.mockClear();
  native.notify.mockClear();
  native.stopBridge.mockReset();
  native.bridge.mockReset().mockReturnValue(native.stopBridge);
  native.send.mockReset().mockImplementation(
    (input) =>
      new Promise<void>((finish) => {
        sends.push({ id: input.sessionId, sink: input.onEvent, finish });
      }),
  );
  abortQuit();
  publishActiveSurface(null);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  for (const send of sends) send.finish();
  container.remove();
  abortQuit();
  publishActiveSurface(null);
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function render(
  sessions: Session[],
  views: ViewProps[],
  strict = false,
  extra?: ReactNode,
  onOpenReminder?: Parameters<typeof HarnessWindowHost>[0]["onOpenReminder"],
  createNavigationView?: CreateHarnessNavigationView,
) {
  const children = (
    <HarnessWindowHost
      initialSessions={() => sessions}
      onOpenReminder={onOpenReminder}
      createNavigationView={createNavigationView}
    >
      <Observe />
      {extra}
      {views.map((view) => (
        <View key={view.ownerId} {...view} />
      ))}
    </HarnessWindowHost>
  );
  await act(async () =>
    root.render(strict ? <StrictMode>{children}</StrictMode> : children),
  );
}

describe("window-owned Harness execution host", () => {
  async function projectViews(id: string) {
    const one = fixture(id, `/work/${id}`);
    await render(
      [one.session],
      [],
      true,
      <>
        <HarnessApp surfaceOwnerId={1} initialCwd={one.session.cwd} focused />
        <HarnessApp
          surfaceOwnerId={2}
          initialCwd={one.session.cwd}
          focused={false}
        />
      </>,
    );
    return {
      one,
      host: required(runtime),
      remove: required(required(native.sidebars[0]).onRemoveProject),
    };
  }

  it.each([false, true])(
    "removes a shared project with purge=%s after all views commit while preserving physical panes",
    async (purgeData) => {
      const f = await projectViews(`project-shared-${purgeData}`);
      const physical = [
        {
          ...newTab("project-editor"),
          filePanes: [
            {
              id: "project-editor",
              activeFileId: "file",
              files: [
                {
                  id: "file",
                  path: `${f.one.session.cwd}/file.txt`,
                  cwd: f.one.session.cwd,
                },
              ],
            },
          ],
        },
        {
          ...newTab("project-terminal"),
          filePanes: [
            {
              id: "project-terminal",
              activeFileId: "pty",
              files: [
                {
                  id: "pty",
                  path: "terminal",
                  cwd: f.one.session.cwd,
                  terminal: true,
                },
              ],
            },
          ],
        },
      ];
      f.host.views
        .register(3, {
          ...f.one.input,
          tabs: [...f.one.input.tabs, ...physical],
        })
        .release();
      f.host.views
        .register(4, {
          ...f.one.input,
          tabs: [],
          activeTabId: "",
          report: {
            referencedSessionIds: [],
            foregroundSessionIds: [],
            activeSessionId: null,
          },
        })
        .release();
      const forget = deferred<void>();
      native.forget.mockImplementation(async () => {
        expect(f.host.projects.has(f.one.session.cwd)).toBe(true);
        expect(
          f.host.views
            .getSnapshot()
            .cohorts.every(
              (cohort) =>
                !cohort.state.report.referencedSessionIds.includes(
                  f.one.session.id,
                ),
            ),
        ).toBe(true);
        expect(
          f.host.views
            .getSnapshot()
            .cohorts.every((cohort) => cohort.state.layout.projectCwd === "~"),
        ).toBe(true);
        await forget.promise;
      });
      let pending!: Promise<void>;
      await act(async () => {
        pending = Promise.resolve(f.remove(f.one.session.cwd, { purgeData }));
      });
      expect(native.forget).toHaveBeenCalledOnce();
      expect(f.host.engine.readSession(f.one.session.id)).toBeDefined();
      expect(() =>
        f.host.engine.admitSession(
          fixture("forbidden-new", f.one.session.cwd).session,
          "immediate",
        ),
      ).toThrow("reserved");
      expect(() => f.host.views.register(5, f.one.input)).toThrow("reserved");
      await act(async () => {
        forget.resolve();
        await pending;
      });
      expect(f.host.engine.readSession(f.one.session.id)).toBeUndefined();
      expect(f.host.projects.has(f.one.session.cwd)).toBe(false);
      expect(f.host.holds.hasAny(f.one.session.id)).toBe(false);
      const retained = required(
        f.host.views
          .getSnapshot()
          .cohorts.find((cohort) => cohort.ownerId === 3),
      );
      expect(retained.state.layout.tabs).toEqual(physical);
      expect(localStorage.getItem("monocode.recentProjects")).not.toContain(
        f.one.session.cwd,
      );
      expect(native.error).not.toHaveBeenCalled();
      if (purgeData)
        expect(native.invoke).toHaveBeenCalledWith("session_delete", {
          sessionId: f.one.session.id,
        });
    },
  );

  it("archives a busy shared project without stopping its background execution", async () => {
    const f = await projectViews("project-busy-archive");
    await act(async () =>
      f.host.engine.onSubmit(f.one.session.id, "keep running"),
    );
    await act(async () => {
      await f.remove(f.one.session.cwd, { purgeData: false });
    });
    expect(f.host.engine.readSession(f.one.session.id)?.busy).toBe(true);
    expect(native.cancel).not.toHaveBeenCalled();
    expect(native.forget).not.toHaveBeenCalled();
    await act(async () => {
      sends[0].sink({ type: "message.delta", text: "after project archive" });
      f.host.engine.flushHarnessEvents();
    });
    expect(
      f.host.engine
        .readSession(f.one.session.id)
        ?.blocks.some((block) => block.text === "after project archive"),
    ).toBe(true);
  });

  it("preserves an active metadata-only view's dirty editor and terminal dock during project removal", async () => {
    const errors = vi.spyOn(console, "error");
    const one = fixture(
      "project-active-physical",
      "/work/project-active-physical",
    );
    await render(
      [one.session],
      [],
      true,
      <>
        <HarnessApp surfaceOwnerId={1} initialCwd={one.session.cwd} focused />
      </>,
    );
    const file = {
      id: "dirty-file",
      path: `${one.session.cwd}/file.txt`,
      cwd: one.session.cwd,
    };
    const tab = {
      ...newTab("physical-editor"),
      filePanes: [
        { id: "physical-editor", files: [file], activeFileId: file.id },
      ],
    };
    const dock = {
      projectPath: one.session.cwd,
      open: true,
      size: 200,
      side: "bottom" as const,
      pane: {
        id: "physical-dock",
        files: [
          {
            id: "dock-pty",
            path: "terminal",
            cwd: one.session.cwd,
            terminal: true,
          },
        ],
        activeFileId: "dock-pty",
      },
    };
    await render(
      [one.session],
      [],
      true,
      <>
        <HarnessApp surfaceOwnerId={1} initialCwd={one.session.cwd} focused />
        <HarnessApp
          surfaceOwnerId={2}
          initialCwd={one.session.cwd}
          focused={false}
          windowTransfer={{
            tabs: [tab],
            sessions: [],
            activeTabId: tab.id,
            projectCwd: one.session.cwd,
            dirtyFileIds: [file.id],
            projectTerminals: [dock],
          }}
        />
      </>,
    );
    const host = required(runtime);
    await act(async () => {
      await required(required(native.sidebars[0]).onRemoveProject)(
        one.session.cwd,
        { purgeData: false },
      );
    });
    const view = required(
      host.views.getSnapshot().cohorts.find((cohort) => cohort.ownerId === 2),
    );
    expect(view.state.layout.tabs[0].filePanes[0].files).toEqual([file]);
    expect(view.state.layout.projectTerminals).toEqual([dock]);
    expect(view.state.layout.projectCwd).toBe("~");
    expect(host.engine.readSession(one.session.id)).toBeUndefined();
    expect(native.error).not.toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();
  });

  it("retains project and session reservations until a pending purge stop settles after unmount", async () => {
    const f = await projectViews("project-pending-stop");
    await act(async () => f.host.engine.onSubmit(f.one.session.id, "running"));
    const stop = deferred<void>();
    native.cancel.mockReturnValue(stop.promise);
    let pending!: Promise<void>;
    await act(async () => {
      pending = Promise.resolve(
        f.remove(f.one.session.cwd, { purgeData: true }),
      );
    });
    expect(native.cancel).toHaveBeenCalledOnce();
    await act(async () => root.render(null));
    expect(f.host.projects.has(f.one.session.cwd)).toBe(true);
    expect(f.host.holds.has("removing", f.one.session.id)).toBe(true);
    await act(async () => {
      stop.resolve();
      await pending;
    });
    expect(f.host.projects.has(f.one.session.cwd)).toBe(false);
    expect(f.host.holds.hasAny(f.one.session.id)).toBe(false);
    expect(
      native.invoke.mock.calls.some(
        ([command]) => command === "session_delete",
      ),
    ).toBe(false);
  });

  it("does not delete a project after its original metadata read survives close cancellation", async () => {
    const f = await projectViews("project-cancel-read");
    const gate = deferred<unknown>();
    const original = native.invoke.getMockImplementation();
    native.invoke.mockImplementation((command, args) =>
      command === "session_list_by_project"
        ? gate.promise
        : original?.(command, args),
    );
    let pending!: Promise<void>;
    await act(async () => {
      pending = Promise.resolve(
        f.remove(f.one.session.cwd, { purgeData: true }),
      );
    });
    expect(f.host.projects.has(f.one.session.cwd)).toBe(true);
    const final = required(
      required(required(f.host.persistence.getOwner()).capture()).seal(),
    );
    await act(async () => {
      final.cancel();
      gate.resolve([]);
      await pending;
    });
    expect(f.host.engine.readSession(f.one.session.id)).toBeDefined();
    expect(
      native.invoke.mock.calls.some(
        ([command]) => command === "session_delete",
      ),
    ).toBe(false);
    expect(f.host.projects.has(f.one.session.cwd)).toBe(false);
  });

  it("keeps canonical data after provider cleanup failure and supports an explicit retry", async () => {
    const f = await projectViews("project-cleanup-failure");
    native.forget.mockRejectedValueOnce(new Error("Provider cleanup failed"));
    await act(async () => {
      await f.remove(f.one.session.cwd, { purgeData: true });
    });
    expect(f.host.engine.readSession(f.one.session.id)).toBeDefined();
    expect(f.host.projects.has(f.one.session.cwd)).toBe(false);
    expect(native.error).toHaveBeenCalledOnce();
    expect(
      native.invoke.mock.calls.some(
        ([command]) => command === "session_delete",
      ),
    ).toBe(false);
    await act(async () => {
      await f.remove(f.one.session.cwd, { purgeData: true });
    });
    expect(f.host.engine.readSession(f.one.session.id)).toBeUndefined();
  });

  it("removes retained project navigation even when the project has no canonical sessions", async () => {
    const f = await projectViews("project-origin-other");
    f.host.views
      .register(3, {
        tabs: [],
        activeTabId: "",
        projectCwd: "/work/project-empty",
        projectTerminals: [],
        projectReturnMemory: new Map(),
        report: {
          referencedSessionIds: [],
          foregroundSessionIds: [],
          activeSessionId: null,
        },
      })
      .release();
    await act(async () => {
      await f.remove("/work/project-empty", { purgeData: false });
    });
    expect(
      f.host.views.getSnapshot().cohorts.find((cohort) => cohort.ownerId === 3)
        ?.state.layout.projectCwd,
    ).toBe("~");
    expect(f.host.engine.readSession(f.one.session.id)).toBeDefined();
    expect(f.host.projects.has("/work/project-empty")).toBe(false);
  });

  async function inboxViews(strict = false) {
    const one = fixture("inbox-one", "/work/inbox-one");
    const two = fixture("inbox-two", "/work/inbox-two");
    await render(
      [one.session, two.session],
      [],
      strict,
      <>
        <HarnessApp surfaceOwnerId={1} initialCwd={one.session.cwd} focused />
        <HarnessApp
          surfaceOwnerId={2}
          initialCwd={two.session.cwd}
          focused={false}
        />
      </>,
    );
    const sidebars = [...native.sidebars];
    await act(async () => {
      for (const sidebar of sidebars) sidebar.onOpenInbox?.();
    });
    const first = required(
      native.inboxes.find((props) => props.cwd === one.session.cwd),
    );
    const second = required(
      native.inboxes.find((props) => props.cwd === two.session.cwd),
    );
    const item: InboxItem = {
      provider: "github",
      kind: "issue",
      number: 42,
      title: "Shared Inbox item",
      url: "https://github.com/acme/app/issues/42",
      projectPath: one.session.cwd,
      state: "OPEN",
      updatedAt: "2026-10-23",
      labels: [],
      assignees: [],
      draft: false,
      repo: "acme/app",
    };
    return { first, second, item, host: required(runtime) };
  }

  it("coalesces Inbox creation across real App views and rejects restart while metadata is pending", async () => {
    const f = await inboxViews(true);
    const gate = deferred<{ body: string }>();
    native.details.mockReturnValue(gate.promise);
    const pending: Promise<string>[] = [];
    await act(async () => {
      pending.push(
        required(f.first.onAsk)(f.item),
        required(f.second.onAsk)(f.item),
      );
    });
    expect(native.details).toHaveBeenCalledOnce();
    await expect(required(f.first.onAskRestart)(f.item)).rejects.toThrow(
      "unavailable",
    );
    let ids: string[] = [];
    await act(async () => {
      gate.resolve({ body: "Ready" });
      ids = await Promise.all(pending);
    });
    expect(ids[0]).toBe(ids[1]);
    expect(
      f.host.engine.sessionsRef.current.filter((session) => session.inboxAsk),
    ).toHaveLength(1);
  });

  it("restarts a shared Inbox conversation only after every view detaches and native cleanup settles", async () => {
    const f = await inboxViews(true);
    const id = await act(async () => required(f.first.onAsk)(f.item));
    await act(async () => {
      expect(await required(f.second.onAsk)(f.item)).toBe(id);
      const portal = document.createElement("div");
      required(f.first.onAskMount)({ sessionId: id, host: portal });
      required(f.second.onAskMount)({
        sessionId: id,
        host: document.createElement("div"),
      });
    });
    const cleanup = deferred<void>();
    const physical = [
      {
        ...newTab("inbox-editor"),
        filePanes: [
          {
            id: "inbox-editor",
            activeFileId: "file",
            files: [{ id: "file", path: "/work/file", cwd: "/work" }],
          },
        ],
      },
      {
        ...newTab("inbox-terminal"),
        filePanes: [
          {
            id: "inbox-terminal",
            activeFileId: "pty",
            files: [
              { id: "pty", path: "terminal", cwd: "/work", terminal: true },
            ],
          },
        ],
      },
    ];
    const retained = f.host.views.register(3, {
      tabs: [newTab(id), ...physical],
      activeTabId: physical[0].id,
      projectCwd: "/work",
      projectTerminals: [],
      projectReturnMemory: new Map(),
      report: {
        referencedSessionIds: [id],
        foregroundSessionIds: [],
        activeSessionId: null,
      },
    });
    retained.release();
    native.forget.mockImplementation(async () => {
      expect(
        f.host.views
          .getSnapshot()
          .cohorts.every(
            (entry) => !entry.state.report.referencedSessionIds.includes(id),
          ),
      ).toBe(true);
      expect(f.host.holds.has("removing", id)).toBe(true);
      await cleanup.promise;
    });
    let pending!: Promise<string>;
    await act(async () => {
      pending = required(f.first.onAskRestart)(f.item);
    });
    expect(native.forget).toHaveBeenCalledOnce();
    expect(f.host.engine.readSession(id)).toBeDefined();
    await expect(required(f.second.onAsk)(f.item)).rejects.toThrow(
      "unavailable",
    );
    await expect(required(f.second.onAskRestart)(f.item)).rejects.toThrow(
      "unavailable",
    );
    const next = await act(async () => {
      cleanup.resolve();
      return pending;
    });
    expect(next).not.toBe(id);
    expect(f.host.engine.readSession(id)).toBeUndefined();
    expect(f.host.engine.readSession(next)?.inboxAsk).toBeDefined();
    expect(
      f.host.engine.sessionsRef.current.filter((session) => session.inboxAsk),
    ).toHaveLength(1);
    expect(f.host.holds.hasAny(id)).toBe(false);
    const saved = required(
      f.host.views.getSnapshot().cohorts.find((entry) => entry.ownerId === 3),
    );
    expect(saved.state.layout.tabs.map((tab) => tab.id)).toEqual(
      physical.map((tab) => tab.id),
    );
    expect(saved.state.layout.tabs[0].filePanes[0].files[0].id).toBe("file");
    expect(saved.state.layout.tabs[1].filePanes[0].files[0].id).toBe("pty");
  });

  it("keeps the old Inbox session and original error when cleanup fails, then allows an explicit retry", async () => {
    const f = await inboxViews();
    const id = await act(async () => required(f.first.onAsk)(f.item));
    const error = new Error("Cleanup failed");
    native.forget.mockRejectedValueOnce(error);
    await act(async () => {
      await expect(required(f.first.onAskRestart)(f.item)).rejects.toBe(error);
    });
    expect(f.host.engine.readSession(id)).toBeDefined();
    expect(
      f.host.engine.sessionsRef.current.filter((session) => session.inboxAsk),
    ).toHaveLength(1);
    expect(f.host.holds.hasAny(id)).toBe(false);
    const next = await act(async () => required(f.first.onAskRestart)(f.item));
    expect(next).not.toBe(id);
    expect(f.host.engine.readSession(id)).toBeUndefined();
  });

  it("does not admit a late Inbox metadata result after close cancellation", async () => {
    const f = await inboxViews();
    const gate = deferred<{ body: string }>();
    native.details.mockReturnValue(gate.promise);
    let pending!: Promise<string>;
    await act(async () => {
      pending = required(f.first.onAsk)(f.item);
    });
    const rejected = expect(pending).rejects.toThrow("unavailable");
    const final = required(
      required(required(f.host.persistence.getOwner()).capture()).seal(),
    );
    await act(async () => {
      final.cancel();
      gate.resolve({ body: "Late" });
      await rejected;
    });
    expect(
      f.host.engine.sessionsRef.current.some((session) => session.inboxAsk),
    ).toBe(false);
  });

  it("does not create the replacement Inbox conversation after close cancellation during cleanup", async () => {
    const f = await inboxViews();
    const id = await act(async () => required(f.first.onAsk)(f.item));
    const cleanup = deferred<void>();
    native.forget.mockReturnValue(cleanup.promise);
    let pending!: Promise<string>;
    await act(async () => {
      pending = required(f.first.onAskRestart)(f.item);
    });
    const rejected = expect(pending).rejects.toThrow("unavailable");
    expect(native.forget).toHaveBeenCalledOnce();
    const owner = required(f.host.persistence.getOwner());
    const final = required(required(owner.capture()).seal());
    await act(async () => final.cancel());
    expect(f.host.holds.hasAny(id)).toBe(true);
    await act(async () => {
      cleanup.resolve();
      await rejected;
    });
    expect(f.host.holds.hasAny(id)).toBe(false);
    expect(f.host.engine.readSession(id)).toBeDefined();
    expect(
      f.host.engine.sessionsRef.current.filter((session) => session.inboxAsk),
    ).toHaveLength(1);
    expect(native.details).toHaveBeenCalledOnce();
  });

  it("keeps the removal reservation until a pending stop settles after Host unmount", async () => {
    const one = fixture("pending-stop", "/work/pending-stop");
    await render(
      [one.session],
      [],
      false,
      <HarnessApp surfaceOwnerId={1} initialCwd={one.session.cwd} focused />,
    );
    const host = required(runtime);
    await act(async () => host.engine.onSubmit(one.session.id, "running work"));
    const stop = deferred<void>();
    native.cancel.mockReturnValue(stop.promise);
    const sidebar = required(native.sidebars[0]);
    let pending!: Promise<void>;
    await act(async () => {
      pending = Promise.resolve(
        required(sidebar.onArchiveSession)(one.session.id, true),
      );
    });
    expect(native.cancel).toHaveBeenCalledOnce();
    expect(host.holds.has("removing", one.session.id)).toBe(true);
    await act(async () => root.render(null));
    expect(host.holds.has("removing", one.session.id)).toBe(true);
    expect(
      native.invoke.mock.calls.some(
        ([command]) => command === "session_set_archived",
      ),
    ).toBe(false);
    await act(async () => {
      stop.resolve();
      await pending;
    });
    expect(host.holds.hasAny(one.session.id)).toBe(false);
    expect(
      native.invoke.mock.calls.some(
        ([command]) => command === "session_set_archived",
      ),
    ).toBe(false);
  });

  it.each(["archive", "delete"] as const)(
    "%s through the real App detaches sibling and retained views under StrictMode",
    async (mode) => {
      vi.stubGlobal(
        "confirm",
        vi.fn(() => true),
      );
      const one = fixture("shared", "/work/shared");
      await render(
        [one.session],
        [],
        true,
        <>
          <HarnessApp surfaceOwnerId={1} initialCwd={one.session.cwd} focused />
          <HarnessApp
            surfaceOwnerId={2}
            initialCwd={one.session.cwd}
            focused={false}
          />
        </>,
      );
      const host = required(runtime);
      const retained = host.views.register(3, one.input);
      retained.release();
      const originalInvoke = native.invoke.getMockImplementation();
      native.invoke.mockImplementation(async (command, args) => {
        if (
          command === "session_set_archived" ||
          command === "session_delete"
        ) {
          expect(
            host.views
              .getSnapshot()
              .cohorts.filter((entry) => entry.ownerId !== 1)
              .every(
                (entry) =>
                  !entry.state.report.referencedSessionIds.includes("shared"),
              ),
          ).toBe(true);
          expect(host.holds.has("removing", "shared")).toBe(true);
        }
        return originalInvoke?.(command, args);
      });
      await act(async () => {
        const sidebar = required(native.sidebars[0]);
        if (mode === "archive")
          await required(sidebar.onArchiveSession)("shared", true);
        else await required(sidebar.onDeleteSession)("shared");
      });
      expect(native.invoke).toHaveBeenCalledWith(
        mode === "archive" ? "session_set_archived" : "session_delete",
        {
          sessionId: "shared",
          ...(mode === "archive" ? { archived: true } : {}),
        },
      );
      expect(host.engine.readSession("shared")).toBeUndefined();
      expect(
        host.views.getSnapshot().cohorts.find((entry) => entry.ownerId === 2)
          ?.state.layout.tabs,
      ).toEqual([]);
      expect(host.holds.hasAny("shared")).toBe(false);
    },
  );

  it("keeps sibling references when the origin declines deletion", async () => {
    const one = fixture("declined", "/work/declined");
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    await render(
      [one.session],
      [],
      false,
      <>
        <HarnessApp surfaceOwnerId={1} initialCwd={one.session.cwd} focused />
        <HarnessApp
          surfaceOwnerId={2}
          initialCwd={one.session.cwd}
          focused={false}
        />
      </>,
    );
    const host = required(runtime);
    const before = host.views.getSnapshot();
    await act(async () => {
      await required(required(native.sidebars[0]).onDeleteSession)("declined");
    });
    expect(confirm).toHaveBeenCalledOnce();
    expect(host.views.getSnapshot()).toBe(before);
    expect(host.engine.readSession("declined")).toBe(one.session);
    expect(host.holds.hasAny("declined")).toBe(false);
    expect(
      native.invoke.mock.calls.some(
        ([command]) => command === "session_delete",
      ),
    ).toBe(false);
  });

  it("disposes the removal coordinator after final Host unmount", async () => {
    await render([], [], true);
    const host = required(runtime);
    const permit = required(required(host.persistence.getOwner()).capture());
    const operation = await act(async () =>
      host.removals.prepare(null, ["absent"], permit),
    );
    expect(required(operation).isCurrent()).toBe(true);
    await act(async () => root.render(null));
    expect(required(operation).isCurrent()).toBe(false);
    expect(host.holds.hasAny("absent")).toBe(false);
    expect(await host.removals.prepare(null, ["absent"], permit)).toBeNull();
  });

  it("rejects retired navigation while waiting for physical activation confirmation", async () => {
    const one = fixture("one", "/work/one");
    const gate = deferred<boolean>();
    const activate = vi.fn(() => gate.promise);
    await render(
      [one.session],
      [],
      false,
      <NavigationView
        ownerId={1}
        input={one.input}
        openSession={async () => true}
        activate={activate}
      />,
    );
    let pending!: Promise<boolean>;
    await act(async () => {
      pending = required(runtime).navigation.openSession("one");
    });
    expect(activate).toHaveBeenCalledOnce();
    await render([one.session], []);
    await act(async () => gate.resolve(true));
    expect(await pending).toBe(false);
  });

  it("reserves view admissions synchronously and rejects overflow without corrupting the window", async () => {
    const sessions = Array.from(
      { length: 255 },
      (_, i) => fixture(`capacity-${i}`, "/work").session,
    );
    await render(sessions, [], false, <EngineReader />);
    const added = fixture("last-slot", "/work").session;
    const overflow = fixture("overflow", "/work").session;
    await act(async () => {
      viewEngines[0].admitSession(added);
      expect(() => viewEngines[0].admitSession(overflow)).toThrow(RangeError);
    });
    expect(required(runtime).engine.sessions).toHaveLength(256);
    await act(async () => {
      expect(() =>
        viewEngines[0].applySessionDeltas([
          { kind: "admit", session: overflow },
        ]),
      ).toThrow(RangeError);
      viewEngines[0].applySessionDeltas([
        { kind: "remove", id: added.id, expected: added },
        { kind: "admit", session: overflow },
      ]);
    });
    expect(required(runtime).engine.sessions).toHaveLength(256);
    expect(required(runtime).engine.readSession(added.id)).toBeUndefined();
    expect(required(runtime).engine.readSession(overflow.id)).toBe(overflow);
  });

  it("activates the real Stack and App with one Host, survives zero views and closes from their union", async () => {
    rememberRemoteProject("machine", { id: "two", name: "two", cwd: "/srv/two" });
    const tabs = [
      { id: 1, kind: "harness", cwd: "/work/one" },
      { id: 2, kind: "harness", cwd: "remote://machine/srv/two" },
    ] as HarnessTab[];
    await act(async () =>
      root.render(<HarnessStack tabs={tabs} activeId={1} />),
    );
    expect(native.bridge).toHaveBeenCalledOnce();
    expect(native.register).not.toHaveBeenCalled();
    expect(native.panes.size).toBe(2);
    const ids = [...native.panes.keys()];
    await act(async () => {
      for (const id of ids)
        required(native.panes.get(id)).onSubmit(id, "background work", []);
    });
    expect(sends).toHaveLength(2);
    await act(async () => root.render(<HarnessStack tabs={[]} activeId={0} />));
    expect(native.stopBridge).not.toHaveBeenCalled();
    await act(async () => {
      for (const send of sends)
        send.sink({ type: "message.delta", text: "live after last view" });
      await vi.advanceTimersByTimeAsync(100);
    });
    native.panes.clear();
    await act(async () =>
      root.render(<HarnessStack tabs={[{ ...tabs[0], id: 3 }]} activeId={3} />),
    );
    expect(native.panes.size).toBe(1);
    const reopened = required(native.panes.values().next().value);
    expect(
      reopened.sessions
        .filter((session) => session.busy)
        .map((session) => session.id)
        .sort(),
    ).toEqual([...ids].sort());
    expect(
      reopened.sessions.every((session) =>
        session.blocks.some((block) => block.text === "live after last view"),
      ),
    ).toBe(true);
    expect(sends).toHaveLength(2);
    expect(native.bridge).toHaveBeenCalledOnce();
    expect(native.register).not.toHaveBeenCalled();
    const close = windowCloseParticipants.capture();
    expect(close.busy).toBe(true);
    await act(async () => close.prepare());
    const snapshots = native.invoke.mock.calls.filter(
      ([command]) => command === "workspace_set_snapshot",
    );
    expect(
      snapshots[snapshots.length - 1][1].snapshot.sessions
        .map((session: Session) => session.id)
        .sort(),
    ).toEqual([...ids].sort());
    expect(native.invoke).not.toHaveBeenCalledWith("destroy_window");
    await act(async () => close.cancel());
  });

  it("routes keyboard and native actions only to the focused real App and retires cached listeners", async () => {
    const now = vi.spyOn(performance, "now").mockReturnValue(1000);
    const one = fixture("one", "/work/one");
    const two = fixture("two", "/work/two");
    await render(
      [one.session, two.session],
      [],
      false,
      <>
        <HarnessApp
          key="one"
          surfaceOwnerId={1}
          initialCwd={one.session.cwd}
          focused={false}
        />
        <HarnessApp
          key="two"
          surfaceOwnerId={2}
          initialCwd={two.session.cwd}
          focused
        />
      </>,
    );
    await act(async () =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "t",
          ctrlKey: true,
          bubbles: true,
        }),
      ),
    );
    expect(required(runtime).engine.sessions).toHaveLength(3);
    expect(required(runtime).engine.sessions[2].cwd).toBe("/work/two");
    const listeners = [...(native.listeners.get("new_tab") ?? [])];
    expect(listeners).toHaveLength(2);
    now.mockReturnValue(1200);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
      for (const listener of listeners) listener();
    });
    expect(required(runtime).engine.sessions).toHaveLength(4);
    expect(required(runtime).engine.sessions[3].cwd).toBe("/work/two");
    await render([], []);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
      for (const listener of listeners) listener();
    });
    expect(required(runtime).engine.sessions).toHaveLength(4);
    expect(sends).toHaveLength(0);
  });

  it("does not publish catalog completion after its original window permit retires", async () => {
    const one = fixture("one", "/work/one");
    one.session.model = "no-longer-catalogued";
    const gate = deferred<void>();
    native.catalogs.mockReturnValueOnce(gate.promise);
    await render([one.session], []);
    const owner = required(required(runtime).persistence.getOwner());
    const final = required(required(owner.capture()).seal());
    await act(async () => final.cancel());
    const current = required(runtime).engine.readSession("one");
    await act(async () => gate.resolve());
    expect(required(runtime).engine.readSession("one")).toBe(current);
    expect(
      native.probe.mock.calls.every(([options]) =>
        options.ids.every((id: string) => id === "claude"),
      ),
    ).toBe(true);
  });

  it("runs two real App views on one Host and preserves their busy sessions through zero views and reopening", async () => {
    const one = fixture("one", "/work/one");
    const two = fixture("two", "remote://machine/srv/two");
    const sessions = [one.session, two.session];
    await render(
      sessions,
      [],
      false,
      <>
        <HarnessApp
          key="one"
          surfaceOwnerId={1}
          initialCwd={one.session.cwd}
          focused
        />
        <HarnessApp
          key="two"
          surfaceOwnerId={2}
          initialCwd={two.session.cwd}
          focused={false}
        />
      </>,
    );
    expect(native.register).not.toHaveBeenCalled();
    expect(native.bridge).toHaveBeenCalledOnce();
    await act(async () => {
      required(native.panes.get("one")).onSubmit("one", "local work", []);
      required(native.panes.get("two")).onSubmit("two", "remote work", []);
    });
    expect(sends.map((send) => send.id)).toEqual(["one", "two"]);
    await render(
      sessions,
      [],
      false,
      <HarnessApp
        key="two"
        surfaceOwnerId={2}
        initialCwd={two.session.cwd}
        focused
      />,
    );
    expect(
      required(runtime).engine.sessions.every((session) => session.busy),
    ).toBe(true);
    await render(sessions, []);
    expect(native.stopBridge).not.toHaveBeenCalled();
    await act(async () => {
      sends[0].sink({ type: "message.delta", text: "headless local" });
      sends[1].sink({ type: "message.delta", text: "headless remote" });
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(
      required(runtime).engine.sessions.every((session) =>
        session.blocks.some((block) => block.text?.startsWith("headless")),
      ),
    ).toBe(true);
    await render(
      sessions,
      [],
      false,
      <HarnessApp surfaceOwnerId={3} initialCwd={one.session.cwd} focused />,
    );
    expect(
      required(native.panes.get("one")).sessions.find(
        (session) => session.id === "one",
      )?.busy,
    ).toBe(true);
    expect(native.bridge).toHaveBeenCalledOnce();
    expect(native.register).not.toHaveBeenCalled();
    expect(sends).toHaveLength(2);
  });

  it("cleans failed navigation registration before admitting any seed", async () => {
    const one = fixture("one", "/work/one");
    one.session.providerSessionId = "must-not-bind";
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await render(
        [],
        [],
        false,
        <RegistrationBoundary>
          <RegisteredView
            input={one.input}
            seeds={[one.session]}
            rejectRegistration
          />
        </RegistrationBoundary>,
      );
      expect(required(runtime).views.getSnapshot().cohorts).toEqual([]);
      expect(required(runtime).engine.sessions).toEqual([]);
      expect(native.bind).not.toHaveBeenCalled();
      expect(required(runtime).navigation.available).toBe(false);
    } finally {
      error.mockRestore();
    }
  });

  it("admits and binds a registered seed once across StrictMode while preserving canonical data", async () => {
    const one = fixture("one", "/work/one");
    one.session.providerSessionId = "original-thread";
    const onRegistered = vi.fn();
    await render(
      [],
      [],
      true,
      <RegisteredView
        input={one.input}
        seeds={[one.session]}
        onRegistered={onRegistered}
      />,
    );
    expect(required(runtime).engine.sessions).toEqual([one.session]);
    expect(native.bind).toHaveBeenCalledExactlyOnceWith(
      "claude",
      "one",
      "original-thread",
      "/work/one",
      undefined,
      one.session.blocks,
    );
    expect(native.builtins.mock.invocationCallOrder[0]).toBeLessThan(
      native.bind.mock.invocationCallOrder[0],
    );
    expect(onRegistered).toHaveBeenCalledTimes(2);
    expect(required(runtime).views.getSnapshot().cohorts).toHaveLength(1);
    const stale = {
      ...one.session,
      title: "stale",
      providerSessionId: "stale-thread",
    };
    act(() =>
      expect(required(runtime).admitSeeds([stale], () => true)).toBe(true),
    );
    expect(required(runtime).engine.readSession("one")).toBe(one.session);
    expect(native.bind).toHaveBeenCalledOnce();
  });

  it("validates seed capacity before any admission and rejects retired requests", async () => {
    await render([], []);
    const host = required(runtime);
    const seeds = Array.from(
      { length: 257 },
      (_, i) => fixture(`seed-${i}`, "/work").session,
    );
    expect(() => host.admitSeeds(seeds, () => true)).toThrow();
    expect(host.admitSeeds([seeds[0]], () => false)).toBe(false);
    expect(host.engine.sessions).toEqual([]);
    expect(native.bind).not.toHaveBeenCalled();
    const full = Array.from(
      { length: 256 },
      (_, i) => fixture(`existing-${i}`, "/work").session,
    );
    act(() => expect(host.admitSeeds(full, () => true)).toBe(true));
    expect(() => host.admitSeeds([seeds[0]], () => true)).toThrow(RangeError);
    expect(required(runtime).engine.sessions).toEqual(full);
  });

  it("retires pending navigation when its registered view departs", async () => {
    const one = fixture("one", "/work/one");
    const gate = deferred<boolean>();
    const open = vi
      .fn<HarnessNavigationTarget["openSession"]>()
      .mockReturnValue(gate.promise);
    const activate = vi.fn(() => true);
    await render(
      [one.session],
      [],
      false,
      <RegisteredView
        input={one.input}
        openSession={open}
        activate={activate}
      />,
    );
    let pending!: Promise<boolean>;
    await act(async () => {
      pending = required(runtime).navigation.openSession("one");
    });
    expect(open).toHaveBeenCalledOnce();
    await render([one.session], []);
    await act(async () => gate.resolve(true));
    expect(await pending).toBe(false);
    expect(activate).not.toHaveBeenCalled();
    expect(required(runtime).views.getSnapshot().cohorts[0].active).toBe(false);
    expect(required(runtime).engine.sessions).toEqual([one.session]);
  });

  it("updates registered view callbacks and layout without replacing its navigation receipt", async () => {
    const one = fixture("one", "/work/one");
    const oldOpen = vi.fn(async () => true);
    const newOpen = vi.fn(async () => true);
    const onRegistered = vi.fn();
    await render(
      [one.session],
      [],
      false,
      <RegisteredView
        input={one.input}
        openSession={oldOpen}
        onRegistered={onRegistered}
      />,
    );
    const changed = { ...one.input, projectCwd: "/work/changed" };
    await render(
      [one.session],
      [],
      false,
      <RegisteredView
        input={changed}
        openSession={newOpen}
        onRegistered={onRegistered}
      />,
    );
    expect(onRegistered).toHaveBeenCalledOnce();
    expect(
      required(runtime).views.getSnapshot().cohorts[0].state.layout.projectCwd,
    ).toBe("/work/changed");
    await act(async () =>
      expect(await required(runtime).navigation.openSession("one")).toBe(true),
    );
    expect(oldOpen).not.toHaveBeenCalled();
    expect(newOpen).toHaveBeenCalledOnce();
  });

  it("keeps a replacement registration when the previous view with the same owner unmounts", async () => {
    const one = fixture("one", "/work/one");
    const open = vi.fn(async () => true);
    const readers = (old: boolean) => [
      old && <RegisteredView key="old" input={one.input} />,
      <RegisteredView key="replacement" input={one.input} openSession={open} />,
    ];
    await render([one.session], [], false, readers(true));
    await render([one.session], [], false, readers(false));
    expect(required(runtime).views.getSnapshot().cohorts[0].active).toBe(true);
    await act(async () =>
      expect(await required(runtime).navigation.openSession("one")).toBe(true),
    );
    expect(open).toHaveBeenCalledOnce();
  });

  it("replaces registration when a mounted component changes its owner ID", async () => {
    const one = fixture("one", "/work/one");
    const bound = vi.fn();
    await render(
      [one.session],
      [],
      false,
      <RegisteredView ownerId={1} input={one.input} onRegistered={bound} />,
    );
    await render(
      [one.session],
      [],
      false,
      <RegisteredView ownerId={2} input={one.input} onRegistered={bound} />,
    );
    expect(bound.mock.calls.map(([view]) => view.ownerId)).toEqual([1, 2]);
    expect(
      required(runtime)
        .views.getSnapshot()
        .cohorts.map((cohort) => [cohort.ownerId, cohort.active]),
    ).toEqual([
      [1, false],
      [2, true],
    ]);
  });

  it("does not expose global cancellation and denies every departed view action", async () => {
    const one = fixture("one", "/work/one");
    await render([one.session], [], false, <EngineReader />);
    const view = required(viewEngines[0]);
    expect("cancelScheduledHarnessEvents" in view).toBe(false);
    const host = required(runtime);
    const spies = Object.entries(host.engine).flatMap(([name, value]) =>
      typeof value === "function"
        ? [
            vi.spyOn(
              host.engine,
              name as Exclude<
                keyof typeof host.engine,
                "sessions" | "sessionsRef"
              >,
            ),
          ]
        : [],
    );
    await render([one.session], []);
    for (const spy of spies) spy.mockClear();
    for (const [name, action] of Object.entries(view)) {
      if (
        typeof action !== "function" ||
        ["readSession", "captureSessionLifetime"].includes(name)
      )
        continue;
      await Reflect.apply(action, undefined, []);
    }
    expect(spies.every((spy) => spy.mock.calls.length === 0)).toBe(true);
    expect(view.onCompactContext("one")).toBe(false);
    expect(await view.stopSessionForRemoval("one")).toBeUndefined();
    expect(required(runtime).engine.sessions).toEqual([one.session]);
  });

  it("keeps accepted work alive when a view retires while denying its cached actions", async () => {
    const one = fixture("one", "/work/one");
    await render([one.session], [], false, <EngineReader />);
    const view = required(viewEngines[0]);
    const viewCurrent = view.captureSessionLifetime("one");
    const hostCurrent = required(runtime).engine.captureSessionLifetime("one");
    await act(async () => view.onSubmit("one", "continue in background"));
    expect(sends).toHaveLength(1);
    await render([one.session], []);
    expect(viewCurrent()).toBe(false);
    expect(hostCurrent()).toBe(true);
    await act(async () => {
      view.onStop("one");
      view.onSubmit("one", "must not queue");
      sends[0].sink({ type: "message.delta", text: "still running" });
      sends[0].finish();
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(sends).toHaveLength(1);
    expect(
      required(runtime)
        .engine.readSession("one")
        ?.blocks.some((block) => block.text === "still running"),
    ).toBe(true);
  });

  it("keeps a captured view lifetime retired after close cancellation while accepting fresh actions", async () => {
    const one = fixture("one", "/work/one");
    await render([one.session], [], false, <EngineReader />);
    const view = required(viewEngines[0]);
    const current = view.captureSessionLifetime("one");
    expect(current()).toBe(true);
    const owner = required(required(runtime).persistence.getOwner());
    const final = required(required(owner.capture()).seal());
    await act(async () => view.onSubmit("one", "sealed"));
    expect(sends).toHaveLength(0);
    expect(current()).toBe(false);
    await act(async () => final.cancel());
    expect(current()).toBe(false);
    await act(async () => view.onSubmit("one", "fresh action"));
    expect(sends).toHaveLength(1);
  });

  it.each(["removeSession", "applySessionDeltas"] as const)(
    "%s invalidates a matching opening without freeing physical reservation or its sibling",
    async (method) => {
      const one = fixture("one", "/work/one");
      const two = fixture("two", "remote://machine/srv/two");
      await render([one.session, two.session], [], false, <EngineReader />);
      const host = required(runtime);
      const opening = required(
        host.holds.acquire("opening", ["one"], () => true),
      );
      const sibling = required(
        host.holds.acquire("opening", ["two"], () => true),
      );
      await act(async () => {
        if (method === "removeSession")
          viewEngines[0].removeSession("one", "immediate");
        else
          viewEngines[0].applySessionDeltas(
            [{ kind: "remove", id: "one" }],
            "immediate",
          );
      });
      expect(opening.isCurrent()).toBe(false);
      expect(host.holds.has("opening", "one")).toBe(true);
      expect(sibling.isCurrent()).toBe(true);
      expect(required(runtime).engine.sessions).toEqual([two.session]);
      opening.release();
      sibling.release();
    },
  );

  it("does not retire openings when conditional removal is rejected", async () => {
    const one = fixture("one", "/work/one");
    await render([one.session], [], false, <EngineReader />);
    const host = required(runtime);
    const opening = required(
      host.holds.acquire("opening", ["one"], () => true),
    );
    await act(async () => {
      viewEngines[0].applySessionDeltas(
        [
          { kind: "remove", id: "one", expected: { ...one.session } },
          { kind: "remove", id: "one", shouldRemove: () => false },
        ],
        "immediate",
      );
    });
    expect(opening.isCurrent()).toBe(true);
    expect(host.engine.readSession("one")).toBe(one.session);
    opening.release();
  });

  it("retires only the departed view while its sibling keeps submitting", async () => {
    const one = fixture("one", "/work/one");
    await render(
      [one.session],
      [],
      false,
      <>
        <EngineReader key="one" index={0} />
        <EngineReader key="two" index={1} />
      </>,
    );
    const departed = viewEngines[0];
    const sibling = viewEngines[1];
    await render(
      [one.session],
      [],
      false,
      <>
        <EngineReader key="two" index={1} />
      </>,
    );
    await act(async () => {
      departed.onSubmit("one", "departed");
      sibling.onSubmit("one", "current sibling");
    });
    expect(sends).toHaveLength(1);
    expect(native.send).toHaveBeenCalledWith(
      expect.objectContaining({ text: "current sibling" }),
    );
  });

  it("preserves boot imports and retained cohorts through zero views, then detaches retired references", async () => {
    const one = fixture("one", "/work/one");
    const two = fixture("two", "remote://machine/srv/two");
    const sessions = [one.session, two.session];
    await render(sessions, []);
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(required(runtime).engine.sessions).toEqual(sessions);
    expect(native.forget).not.toHaveBeenCalled();
    await render(sessions, [
      { ownerId: 1, input: one.input },
      { ownerId: 2, input: two.input },
    ]);
    await render(sessions, []);
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(required(runtime).engine.sessions).toEqual(sessions);
    expect(native.forget).not.toHaveBeenCalled();
    act(() => {
      const cohort = required(
        required(runtime)
          .views.getSnapshot()
          .cohorts.find((entry) => entry.ownerId === 1),
      );
      expect(required(runtime).views.retire(cohort)).toBe(true);
    });
    await act(async () => vi.advanceTimersByTimeAsync(250));
    expect(required(runtime).engine.sessions).toEqual([two.session]);
    expect(native.forget).toHaveBeenCalledExactlyOnceWith("claude", "one");
  });

  it.each(["opening", "removing", "switching", "transfer"] as const)(
    "retains a physically pending %s operation after its last cohort retires",
    async (kind) => {
      const one = fixture("one", "/work/one");
      await render([one.session], [{ ownerId: 1, input: one.input }]);
      const host = required(runtime);
      let active = true;
      const hold = required(host.holds.acquire(kind, ["one"], () => active));
      await render([one.session], []);
      act(() => {
        expect(host.views.retire(host.views.getSnapshot().cohorts[0])).toBe(
          true,
        );
      });
      active = false;
      host.holds.invalidateOpening("one");
      await act(async () => vi.advanceTimersByTimeAsync(1000));
      expect(hold.isCurrent()).toBe(false);
      expect(required(runtime).engine.sessions).toEqual([one.session]);
      expect(native.forget).not.toHaveBeenCalled();
      act(() => hold.release());
      await act(async () => vi.advanceTimersByTimeAsync(250));
      expect(required(runtime).engine.sessions).toEqual([]);
      expect(native.forget).toHaveBeenCalledExactlyOnceWith("claude", "one");
    },
  );

  it("tracks every foreground completion and preserves an unseen headless result", async () => {
    const one = fixture("one", "/work/one");
    const two = fixture("two", "remote://machine/srv/two");
    await render(
      [one.session, two.session],
      [
        { ownerId: 1, input: one.input },
        { ownerId: 2, input: two.input },
      ],
    );
    await act(async () => {
      required(runtime).engine.onSubmit("one", "first");
      required(runtime).engine.onSubmit("two", "second");
    });
    await act(async () => {
      for (const send of sends) send.finish();
    });
    expect(required(runtime).unseenFinishedIds).toEqual(new Set());
    await act(async () => required(runtime).engine.onSubmit("one", "headless"));
    await render([], []);
    act(() => {
      for (const cohort of required(runtime).views.getSnapshot().cohorts)
        expect(required(runtime).views.retire(cohort)).toBe(true);
    });
    await act(async () => sends[sends.length - 1].finish());
    await act(async () => vi.advanceTimersByTimeAsync(250));
    expect(required(runtime).unseenFinishedIds).toEqual(new Set(["one"]));
    expect(
      required(runtime).engine.sessions.map((session) => session.id),
    ).toEqual(["one"]);
    expect(native.forget).toHaveBeenCalledExactlyOnceWith("claude", "two");
    await render([], [{ ownerId: 3, input: one.input }]);
    expect(required(runtime).unseenFinishedIds).toEqual(new Set());
  });

  it.each(["opening", "removing", "switching", "transfer"] as const)(
    "blocks submission synchronously during %s without stopping a sibling",
    async (kind) => {
      const one = fixture("one", "/work/one");
      const two = fixture("two", "remote://machine/srv/two");
      await render([one.session, two.session], []);
      const host = required(runtime);
      const receipt = required(host.holds.acquire(kind, ["one"], () => true));
      await act(async () => {
        host.engine.onSubmit("one", "must wait");
        host.engine.onSubmit("two", "sibling continues");
      });
      expect(sends.map((send) => send.id)).toEqual(["two"]);
      expect(host.engine.readSession("one")).toBe(one.session);
      await render([one.session, two.session], []);
      expect(required(runtime).holds).toBe(host.holds);
      if (kind === "opening") {
        host.holds.invalidateOpening("one");
        expect(receipt.isCurrent()).toBe(false);
        await act(async () => host.engine.onSubmit("one", "still reserved"));
        expect(sends.map((send) => send.id)).toEqual(["two"]);
      }
      receipt.release();
      await act(async () => host.engine.onSubmit("one", "now admitted"));
      expect(sends.map((send) => send.id)).toEqual(["two", "one"]);
    },
  );

  it("routes a reminder into its registered view and retires that view's permission before confirmation", async () => {
    const one = fixture("one", "/work/one");
    const gate = deferred<boolean>();
    const open = vi
      .fn<HarnessNavigationTarget["openSession"]>()
      .mockReturnValue(gate.promise);
    const activate = vi.fn(() => true);
    await render(
      [one.session],
      [],
      false,
      <NavigationView
        ownerId={1}
        input={one.input}
        openSession={open}
        activate={activate}
      />,
    );
    native.takeReminder.mockResolvedValueOnce({ sessionId: "one", dueAt: 1 });
    await act(async () => {
      for (const handler of native.listeners.get("voktty:reminder-open") ?? [])
        handler();
    });
    expect(open).toHaveBeenCalledOnce();
    const permit = required(open.mock.calls[0])[1];
    expect(permit.isCurrent()).toBe(true);
    await render([one.session], []);
    expect(permit.isCurrent()).toBe(false);
    await act(async () => gate.resolve(true));
    expect(activate).not.toHaveBeenCalled();
    expect(
      native.invoke.mock.calls.filter(
        ([command]) => command === "reminder_clear",
      ),
    ).toEqual([]);
  });

  it("waits for a new view's registration before opening and confirming a headless reminder", async () => {
    const one = fixture("one", "remote://machine/srv/one");
    const gate = deferred<HarnessNavigationView | null>();
    const create = vi
      .fn<CreateHarnessNavigationView>()
      .mockReturnValue(gate.promise);
    const open = vi
      .fn<HarnessNavigationTarget["openSession"]>()
      .mockResolvedValue(true);
    const activate = vi.fn(() => true);
    let binding: HarnessNavigationView | undefined;
    const onBound = (view: HarnessNavigationView) => {
      binding = view;
    };
    await render([one.session], [], false, undefined, undefined, create);
    native.takeReminder.mockResolvedValueOnce({ sessionId: "one", dueAt: 1 });
    await act(async () => {
      for (const handler of native.listeners.get("voktty:reminder-open") ?? [])
        handler();
    });
    expect(create).toHaveBeenCalledOnce();
    expect(open).not.toHaveBeenCalled();
    await render(
      [one.session],
      [],
      false,
      <NavigationView
        ownerId={1}
        input={one.input}
        openSession={open}
        activate={activate}
        onBound={onBound}
      />,
      undefined,
      create,
    );
    expect(open).not.toHaveBeenCalled();
    await act(async () => gate.resolve(required(binding)));
    expect(open).toHaveBeenCalledOnce();
    expect(activate).toHaveBeenCalledOnce();
    expect(native.invoke).toHaveBeenCalledWith("reminder_clear", {
      sessionIds: ["one"],
      expectedDueAt: 1,
    });
  });

  it("shares one reminder service with views and keeps polling after they leave", async () => {
    const readers: ReturnType<typeof useSessionReminders>[] = [];
    const open = vi.fn(async () => {});
    const save = vi.fn(async () => {});
    function Reader({ index }: { index: number }) {
      readers[index] = useSessionReminders(open, save, []);
      return null;
    }
    await render(
      [],
      [],
      false,
      <>
        <Reader index={0} />
        <Reader index={1} />
      </>,
    );
    expect(native.reminderList).toHaveBeenCalledOnce();
    expect(native.listeners.get("voktty:reminders-changed")?.size).toBe(1);
    expect(native.listeners.get("voktty:reminder-open")?.size).toBe(1);
    expect(native.takeReminder).not.toHaveBeenCalled();
    expect(
      native.invoke.mock.calls.filter(
        ([command]) => command === "reminder_configure",
      ),
    ).toHaveLength(1);
    await act(async () => {
      for (const handler of native.listeners.get("voktty:reminder-open") ?? [])
        handler();
    });
    expect(native.takeReminder).not.toHaveBeenCalled();
    expect(readers[0].reminders).toBe(readers[1].reminders);
    await render([], []);
    native.reminderList.mockResolvedValue([{ sessionId: "due", dueAt: 1 }]);
    await act(async () => vi.advanceTimersByTimeAsync(30000));
    expect(
      required(runtime).reminders.due.map((reminder) => reminder.sessionId),
    ).toEqual(["due"]);
    expect(native.reminderList).toHaveBeenCalledTimes(2);
    expect(open).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it("opens reminders with zero views and clears only a confirmed navigation", async () => {
    const gate = deferred<boolean>();
    const open = vi
      .fn<
        NonNullable<Parameters<typeof HarnessWindowHost>[0]["onOpenReminder"]>
      >()
      .mockReturnValueOnce(gate.promise)
      .mockResolvedValue(true);
    await render([], [], false, undefined, open);
    const request = { sessionId: "due", dueAt: 1 };
    native.takeReminder.mockResolvedValueOnce(request);
    const notify = () => {
      for (const handler of native.listeners.get("voktty:reminder-open") ?? [])
        handler();
    };
    const clears = () =>
      native.invoke.mock.calls.filter(
        ([command]) => command === "reminder_clear",
      );
    await act(async () => notify());
    expect(open).toHaveBeenCalledExactlyOnceWith(
      "due",
      expect.objectContaining({ isCurrent: expect.any(Function) }),
    );
    expect(clears()).toEqual([]);
    await act(async () => gate.resolve(false));
    expect(clears()).toEqual([]);
    native.takeReminder.mockResolvedValueOnce(request);
    await act(async () => notify());
    expect(clears()).toEqual([
      ["reminder_clear", { sessionIds: ["due"], expectedDueAt: 1 }],
    ]);
  });

  it("retires view scheduling while the shared reminder service remains alive", async () => {
    const gate = deferred<void>();
    let actions: ReturnType<typeof useSessionReminders> | undefined;
    const open = async () => {};
    const save = () => gate.promise;
    function Reader() {
      const owner = useWindowPersistenceAdmission(() => undefined);
      actions = useSessionReminders(open, save, [], owner.getOwner);
      return null;
    }
    await render([], [], false, <Reader />);
    const pending = required(actions).schedule(["due"], 1);
    await render([], []);
    await act(async () => {
      gate.resolve();
      await pending;
    });
    expect(
      native.invoke.mock.calls.filter(
        ([command]) => command === "reminder_set",
      ),
    ).toEqual([]);
    expect(native.listeners.get("voktty:reminders-changed")?.size).toBe(1);
    await act(async () => vi.advanceTimersByTimeAsync(30000));
    expect(native.reminderList).toHaveBeenCalledTimes(2);
  });

  it("drains reminder navigation without clearing it after seal and cancellation", async () => {
    const gate = deferred<boolean>();
    const open = vi.fn(async () => gate.promise);
    await render([], [], false, undefined, open);
    native.takeReminder.mockResolvedValueOnce({ sessionId: "due", dueAt: 1 });
    await act(async () => {
      for (const handler of native.listeners.get("voktty:reminder-open") ?? [])
        handler();
    });
    const owner = required(required(runtime).persistence.getOwner());
    const final = required(required(owner.capture()).seal());
    expect(final.pending).not.toBeNull();
    await act(async () => final.cancel());
    await act(async () => {
      gate.resolve(true);
      await final.pending;
    });
    expect(
      native.invoke.mock.calls.filter(
        ([command]) => command === "reminder_clear",
      ),
    ).toEqual([]);
  });

  it("registers the union of open sessions and keeps it through zero views", async () => {
    const one = fixture("one", "/work/one");
    const two = fixture("two", "remote://machine/srv/two");
    function Reader() {
      useHarnessReminderWindow(["view-must-not-overwrite"]);
      return null;
    }
    const registrations = () =>
      native.invoke.mock.calls.filter(
        ([command]) => command === "reminder_register_window",
      );
    await render(
      [one.session, two.session],
      [
        { ownerId: 1, input: one.input },
        { ownerId: 2, input: two.input },
      ],
      false,
      <Reader />,
    );
    expect(registrations()[registrations().length - 1]?.[1]).toEqual({
      sessionIds: ["one", "two"],
    });
    expect(
      registrations().some(([, args]) =>
        args.sessionIds.includes("view-must-not-overwrite"),
      ),
    ).toBe(false);
    const count = registrations().length;
    await render([one.session, two.session], [], false, <Reader />);
    act(() =>
      required(runtime).engine.updateSession(
        "one",
        (session) => ({ ...session, title: "Renamed" }),
        "immediate",
      ),
    );
    expect(registrations()).toHaveLength(count);
    const retired = required(
      required(runtime)
        .views.getSnapshot()
        .cohorts.find((cohort) => cohort.ownerId === 1),
    );
    act(() => {
      expect(required(runtime).views.retire(retired)).toBe(true);
    });
    await act(async () => {});
    expect(registrations()[registrations().length - 1]?.[1]).toEqual({
      sessionIds: ["two"],
    });
  });

  it("keeps one Inbox source through view release and transcript changes", async () => {
    const one = fixture("one", "/work/one");
    const consumerAppeared = vi.fn();
    function Reader() {
      useInboxUnseen([], "/work/reader", { onAppeared: consumerAppeared });
      return null;
    }
    await render(
      [one.session],
      [{ ownerId: 1, input: one.input }],
      false,
      <Reader />,
    );
    expect(native.inboxList).toHaveBeenCalledOnce();
    expect(
      native.inboxList.mock.calls[0][0].map(
        (project: { path: string }) => project.path,
      ),
    ).toEqual(["/work/one"]);
    await render([one.session], [], false, <Reader />);
    await act(async () =>
      required(runtime).engine.updateSession(
        "one",
        (session) => ({ ...session, title: "Changed" }),
        "immediate",
      ),
    );
    expect(native.inboxList).toHaveBeenCalledOnce();
    expect(consumerAppeared).not.toHaveBeenCalled();
  });

  it("publishes transcript metadata to live summary readers and retires their deferred guards", async () => {
    const one = fixture("one", "/work/one");
    const received: string[] = [];
    let guard = () => false;
    const listener: Parameters<HarnessSummarySource["subscribe"]>[0] = (
      summary,
      isCurrent,
    ) => {
      received.push(summary.id);
      guard = isCurrent;
    };
    function Reader() {
      useHarnessSummaryUpdates(useHarnessWindow().summaries, listener);
      return null;
    }
    await render([one.session], [], false, <Reader />);
    await act(async () =>
      required(runtime).transcripts.persistSession(one.session),
    );
    expect(received).toEqual(["one"]);
    expect(guard()).toBe(true);
    await render([one.session], []);
    expect(guard()).toBe(false);
    await act(async () =>
      required(runtime).transcripts.persistSession(one.session),
    );
    expect(received).toEqual(["one"]);
  });
  it("runs recovered local and remote automations with zero views and records their results", async () => {
    const one = automationFixture("run-one");
    const two = automationFixture("run-two", "remote://machine/srv/two");
    native.pending.mockResolvedValueOnce({ runs: [one, two], nextAfter: null });
    await render([], []);
    expect(sends.map((send) => send.id)).toEqual(["run-one", "run-two"]);
    expect(native.recover).toHaveBeenCalledOnce();
    await act(async () => {
      sends[0].finish();
      sends[1].sink({ type: "session.error", message: "Provider failed" });
      sends[1].finish();
    });
    expect(
      native.updateRun.mock.calls.map(([args]) => [args.runId, args.status]),
    ).toEqual([
      ["run-one", "running"],
      ["run-two", "running"],
      ["run-one", "succeeded"],
      ["run-two", "failed"],
    ]);
    await render([], []);
    expect(native.recover).toHaveBeenCalledOnce();
    expect(required(runtime).engine.sessions).toHaveLength(2);
  });

  it("waits for the running acknowledgement and deduplicates concurrent launches", async () => {
    await render([], []);
    const claim = automationFixture("run-one");
    const ack = deferred<unknown>();
    native.updateRun.mockReturnValueOnce(ack.promise);
    let first: ReturnType<Runtime["automations"]["launch"]> | undefined;
    let second: ReturnType<Runtime["automations"]["launch"]> | undefined;
    await act(async () => {
      first = required(runtime).automations.launch(claim.automation, claim.run);
      second = required(runtime).automations.launch(
        claim.automation,
        claim.run,
      );
    });
    expect(sends).toHaveLength(0);
    expect(native.updateRun).toHaveBeenCalledOnce();
    await act(async () => {
      ack.resolve({ id: claim.run.id, status: "running" });
      await first;
      await second;
    });
    expect(sends).toHaveLength(1);
    expect(required(runtime).engine.sessions).toHaveLength(1);
  });

  it("does not submit when recording the running state fails", async () => {
    await render([], []);
    const claim = automationFixture("run-one");
    native.updateRun.mockRejectedValueOnce(new Error("Storage unavailable"));
    let result: Awaited<ReturnType<Runtime["automations"]["launch"]>>;
    await act(async () => {
      result = await required(runtime).automations.launch(
        claim.automation,
        claim.run,
      );
    });
    expect(result).toBeUndefined();
    expect(sends).toHaveLength(0);
    expect(required(runtime).engine.sessions).toHaveLength(0);
  });

  it("does not submit when native admission has already consumed the pending run", async () => {
    await render([], []);
    native.updateRun.mockResolvedValueOnce(null);
    const claim = automationFixture("run-one");
    await act(async () => {
      expect(
        await required(runtime).automations.launch(claim.automation, claim.run),
      ).toBeUndefined();
    });
    expect(native.invoke).toHaveBeenCalledWith(
      "automation_run_start",
      expect.objectContaining({ runId: "run-one", sessionId: "run-one" }),
    );
    expect(sends).toHaveLength(0);
    expect(required(runtime).engine.sessions).toHaveLength(0);
  });

  it("invalidates session and launch lifetimes when the host leaves the window", async () => {
    await render([], []);
    const claim = automationFixture("run-one");
    let launched: Awaited<ReturnType<Runtime["automations"]["launch"]>>;
    await act(async () => {
      launched = await required(runtime).automations.launch(
        claim.automation,
        claim.run,
      );
    });
    const sessionCurrent =
      required(runtime).engine.captureSessionLifetime("run-one");
    expect(sessionCurrent()).toBe(true);
    expect(required(launched).isCurrent()).toBe(true);
    await act(async () => root.render(null));
    expect(sessionCurrent()).toBe(false);
    expect(required(launched).isCurrent()).toBe(false);
    const calls = native.updateRun.mock.calls.length;
    expect(
      await required(runtime).automations.launch(claim.automation, claim.run),
    ).toBeUndefined();
    expect(native.updateRun).toHaveBeenCalledTimes(calls);
  });

  it("drains an admitted running write without reviving its launch after close cancellation", async () => {
    await render([], []);
    const claim = automationFixture("run-one");
    const ack = deferred<unknown>();
    native.updateRun.mockReturnValueOnce(ack.promise);
    let launch: ReturnType<Runtime["automations"]["launch"]> | undefined;
    await act(async () => {
      launch = required(runtime).automations.launch(
        claim.automation,
        claim.run,
      );
    });
    const owner = required(required(runtime).persistence.getOwner());
    const final = required(required(owner.capture()).seal());
    let drained = false;
    void required(final.pending).then(() => {
      drained = true;
    });
    await act(async () => final.cancel());
    expect(drained).toBe(false);
    await act(async () => {
      ack.resolve({ id: claim.run.id, status: "running" });
      await launch;
    });
    expect(drained).toBe(true);
    expect(sends).toHaveLength(0);
    expect(required(runtime).engine.sessions).toHaveLength(0);
  });

  it("finishes a live automation under fresh admission after close cancellation", async () => {
    await render([], []);
    const claim = automationFixture("run-one");
    await act(async () => {
      await required(runtime).automations.launch(claim.automation, claim.run);
    });
    const owner = required(required(runtime).persistence.getOwner());
    const final = required(required(owner.capture()).seal());
    await act(async () => sends[0].finish());
    expect(native.updateRun).toHaveBeenCalledOnce();
    await act(async () => final.cancel());
    expect(native.updateRun).toHaveBeenLastCalledWith(
      expect.objectContaining({ runId: claim.run.id, status: "succeeded" }),
    );
  });

  it("cannot finalize a replacement session with the previous run's outcome", async () => {
    await render([], []);
    const claim = automationFixture("run-one");
    await act(async () => {
      await required(runtime).automations.launch(claim.automation, claim.run);
    });
    const before = required(runtime).engine.captureSessionLifetime("run-one");
    const replacement = { ...fixture("run-one", "/other").session, busy: true };
    act(() => {
      required(runtime).engine.applySessionDeltas(
        [
          { kind: "remove", id: "run-one" },
          { kind: "admit", session: replacement },
        ],
        "immediate",
      );
    });
    expect(before()).toBe(false);
    await act(async () => sends[0].finish());
    expect(required(runtime).engine.readSession("run-one")).toBe(replacement);
    expect(native.updateRun).toHaveBeenLastCalledWith(
      expect.objectContaining({ runId: claim.run.id, status: "cancelled" }),
    );
  });

  it("StrictMode retires the first recovery without repeating its destructive native call", async () => {
    const first = deferred<unknown>();
    native.recover.mockReturnValueOnce(first.promise);
    const claim = automationFixture("run-one");
    native.pending.mockResolvedValue({ runs: [claim], nextAfter: null });
    await render([], [], true);
    expect(native.recover).toHaveBeenCalledOnce();
    await act(async () => {
      first.resolve([]);
    });
    expect(native.recover).toHaveBeenCalledOnce();
    expect(native.recover).toHaveBeenCalledWith(
      expect.objectContaining({ includePending: false }),
    );
    expect(sends).toHaveLength(1);
  });

  it("reconciles a durable pending run after engine capacity becomes available", async () => {
    const sessions = Array.from(
      { length: 256 },
      (_, index) => fixture(`imported-${index}`, "/work/one").session,
    );
    const claim = automationFixture("waiting-run");
    native.pending.mockResolvedValue({ runs: [claim], nextAfter: null });
    await render(sessions, []);
    expect(sends).toHaveLength(0);
    expect(native.updateRun).not.toHaveBeenCalled();
    act(() =>
      required(runtime).engine.applySessionDeltas(
        [{ kind: "remove", id: "imported-0" }],
        "immediate",
      ),
    );
    await act(async () => vi.advanceTimersByTimeAsync(15000));
    expect(sends.map((send) => send.id)).toEqual(["waiting-run"]);
    expect(native.recover).toHaveBeenCalledOnce();
    expect(required(runtime).engine.sessions).toHaveLength(256);
  });

  it("reserves capacity for starts whose native acknowledgement has not settled", async () => {
    const sessions = Array.from(
      { length: 255 },
      (_, index) => fixture(`imported-${index}`, "/work/one").session,
    );
    await render(sessions, []);
    const ack = deferred<unknown>();
    native.updateRun.mockReturnValueOnce(ack.promise);
    const one = automationFixture("reserved-one");
    const two = automationFixture("reserved-two");
    let first: ReturnType<Runtime["automations"]["launch"]> | undefined;
    await act(async () => {
      first = required(runtime).automations.launch(one.automation, one.run);
      expect(
        await required(runtime).automations.launch(two.automation, two.run),
      ).toBeUndefined();
    });
    expect(native.updateRun).toHaveBeenCalledOnce();
    await act(async () => {
      ack.resolve({ id: one.run.id, status: "running" });
      await first;
    });
    expect(sends).toHaveLength(1);
    expect(required(runtime).engine.sessions).toHaveLength(256);
  });

  it("reconciles pending work after a recovery failure without retrying destructive recovery", async () => {
    native.recover.mockRejectedValueOnce(new Error("Recovery response failed"));
    const claim = automationFixture("pending-run");
    native.pending.mockResolvedValue({ runs: [claim], nextAfter: null });
    await render([], []);
    expect(sends).toHaveLength(0);
    await act(async () => vi.advanceTimersByTimeAsync(15000));
    expect(sends.map((send) => send.id)).toEqual([claim.run.id]);
    expect(native.recover).toHaveBeenCalledOnce();
  });

  it("advances empty pages, preserves the event prompt and wraps its cursor", async () => {
    const claim = automationFixture("event-run");
    claim.run.trigger = "event";
    claim.run.prompt = "Original Inbox event prompt";
    native.pending
      .mockResolvedValueOnce({ runs: [], nextAfter: "history-016" })
      .mockResolvedValueOnce({ runs: [claim], nextAfter: null });
    await render([], []);
    expect(native.pending).toHaveBeenLastCalledWith({ after: null });
    await act(async () => vi.advanceTimersByTimeAsync(15000));
    expect(native.pending).toHaveBeenLastCalledWith({ after: "history-016" });
    expect(native.send).toHaveBeenLastCalledWith(
      expect.objectContaining({ text: "Original Inbox event prompt" }),
    );
    await act(async () => vi.advanceTimersByTimeAsync(15000));
    expect(native.pending).toHaveBeenLastCalledWith({ after: null });
    expect(sends).toHaveLength(1);
    expect(native.recover).toHaveBeenCalledOnce();
  });

  it("retires a pending-page response across seal and cancellation without advancing its cursor", async () => {
    const page = deferred<unknown>();
    native.pending.mockReturnValueOnce(page.promise);
    await render([], []);
    const owner = required(required(runtime).persistence.getOwner());
    const final = required(required(owner.capture()).seal());
    expect(final.pending).toBeNull();
    await act(async () => final.cancel());
    const claim = automationFixture("pending-run");
    await act(async () =>
      page.resolve({ runs: [claim], nextAfter: "run-next" }),
    );
    expect(sends).toHaveLength(0);
    native.pending.mockResolvedValue({ runs: [claim], nextAfter: null });
    await act(async () => vi.advanceTimersByTimeAsync(15000));
    expect(native.pending).toHaveBeenLastCalledWith({ after: null });
    expect(sends).toHaveLength(1);
    expect(native.recover).toHaveBeenCalledOnce();
  });

  it("does not re-run destructive recovery after cancellation during the recovered batch", async () => {
    const one = automationFixture("pending-one");
    const two = automationFixture("pending-two");
    native.pending.mockResolvedValueOnce({ runs: [one, two], nextAfter: null });
    const ack = deferred<unknown>();
    native.updateRun.mockReturnValueOnce(ack.promise);
    await render([], []);
    const owner = required(required(runtime).persistence.getOwner());
    const final = required(required(owner.capture()).seal());
    await act(async () => final.cancel());
    await act(async () => ack.resolve({ id: one.run.id, status: "running" }));
    expect(sends).toHaveLength(0);
    native.pending.mockResolvedValue({ runs: [two], nextAfter: null });
    await act(async () => vi.advanceTimersByTimeAsync(15000));
    expect(sends.map((send) => send.id)).toEqual([two.run.id]);
    expect(native.recover).toHaveBeenCalledOnce();
  });

  it("keeps a pending run eligible after a failed running write and refuses an event without its prompt", async () => {
    const claim = automationFixture("pending-run");
    native.pending.mockResolvedValue({ runs: [claim], nextAfter: null });
    native.updateRun.mockRejectedValueOnce(new Error("Write failed"));
    await render([], []);
    expect(sends).toHaveLength(0);
    await act(async () => vi.advanceTimersByTimeAsync(15000));
    expect(sends).toHaveLength(1);
    const missing = automationFixture("missing-event");
    missing.run.trigger = "event";
    native.pending.mockResolvedValue({ runs: [missing], nextAfter: null });
    await act(async () => vi.advanceTimersByTimeAsync(15000));
    expect(sends).toHaveLength(1);
  });

  it("bounds scheduled polling to one pending request across interval ticks", async () => {
    await render([], []);
    const listing = deferred<unknown>();
    native.listAutomations.mockReturnValueOnce(listing.promise);
    await act(async () => vi.advanceTimersByTimeAsync(15000));
    const count = native.listAutomations.mock.calls.length;
    await act(async () => vi.advanceTimersByTimeAsync(45000));
    expect(native.listAutomations).toHaveBeenCalledTimes(count);
    await act(async () => listing.resolve([]));
  });

  it("flushes foreground output on focus and all output before visibility suspension", async () => {
    const one = fixture("one", "/work/one");
    const two = fixture("two", "remote://machine/srv/two");
    two.input.report = {
      referencedSessionIds: ["two"],
      foregroundSessionIds: [],
      activeSessionId: null,
    };
    let focus: ((event: { payload: boolean }) => void) | undefined;
    native.focus.mockImplementation((callback) => {
      focus = callback;
      return Promise.resolve(() => undefined);
    });
    await render(
      [one.session, two.session],
      [
        { ownerId: 1, input: one.input },
        { ownerId: 2, input: two.input },
      ],
    );
    await act(async () => {
      required(runtime).engine.onSubmit("one", "first");
      required(runtime).engine.onSubmit("two", "second");
    });
    const hasOutput = (id: string) =>
      required(runtime)
        .engine.readSession(id)
        ?.blocks.some((block) => block.text === "buffered");
    act(() => {
      sends[0].sink({ type: "message.delta", text: "buffered" });
      sends[1].sink({ type: "message.delta", text: "buffered" });
    });
    expect(hasOutput("one")).toBe(false);
    expect(hasOutput("two")).toBe(false);
    act(() => required(focus)({ payload: true }));
    expect(hasOutput("one")).toBe(true);
    expect(hasOutput("two")).toBe(false);
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(hasOutput("two")).toBe(true);
    expect(native.focus).toHaveBeenCalledOnce();
  });

  it("continues events, queued turns and approvals with zero views and reclaims the live cohort", async () => {
    const one = fixture("one", "/work/one");
    const two = fixture("two", "remote://machine/srv/two");
    const sessions = [one.session, two.session];
    await render(sessions, [
      { ownerId: 1, input: one.input },
      { ownerId: 2, input: two.input },
    ]);
    await act(async () => {
      required(runtime).engine.onSubmit("one", "first");
      required(runtime).engine.onSubmit("two", "second");
    });
    expect(sends.map((send) => send.id)).toEqual(["one", "two"]);
    await act(async () =>
      required(runtime).engine.onSubmit("one", "queued", [], {
        followUpBehavior: "queue",
      }),
    );
    await render(sessions, []);
    expect(
      required(runtime)
        .views.getSnapshot()
        .cohorts.every((cohort) => !cohort.active),
    ).toBe(true);
    await act(async () => {
      sends[0].sink({ type: "message.delta", text: "headless output" });
      sends[1].sink({
        type: "approval.requested",
        requestId: 9,
        title: "Continue?",
      });
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(
      required(runtime)
        .engine.readSession("one")
        ?.blocks.some((block) => block.text === "headless output"),
    ).toBe(true);
    expect(native.notify).toHaveBeenCalledWith(
      expect.objectContaining({ id: "two" }),
      { kind: "approval", requestId: 9 },
      false,
    );
    expect(native.badge).toHaveBeenLastCalledWith(
      required(runtime).engine.sessions,
    );
    expect(native.focus).toHaveBeenCalledOnce();
    act(() => required(runtime).engine.onApproval("two", 9, "allow"));
    expect(native.approval).toHaveBeenCalledWith("claude", "two", 9, "allow");
    await act(async () => vi.advanceTimersByTimeAsync(650));
    const batches = native.invoke.mock.calls.filter(
      ([command]) => command === "session_upsert_batch",
    );
    expect(
      batches.some(([, args]) =>
        args.sessions.some(
          (session: Session) =>
            session.id === "one" &&
            session.blocks.some((block) => block.text === "headless output"),
        ),
      ),
    ).toBe(true);
    await act(async () => sends[0].finish());
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(sends.map((send) => send.id)).toEqual(["one", "two", "one"]);
    expect(native.stopBridge).not.toHaveBeenCalled();
    const retired = required(
      required(runtime)
        .views.getSnapshot()
        .cohorts.find((cohort) => cohort.ownerId === 1),
    );
    await render(sessions, [
      { ownerId: 3, input: one.input, restore: retired },
    ]);
    const capture = required(runtime).views.capture(
      required(runtime).engine.sessions,
    );
    expect(capture.sessions).toHaveLength(2);
    expect(capture.tabs.map((tab) => tab.id)).toContain(one.input.tabs[0].id);
    expect(native.register).not.toHaveBeenCalled();
    expect(native.bridge).toHaveBeenCalledOnce();
  });

  it("one close owner persists all projects after the last view closes", async () => {
    const one = fixture("one", "/work/one");
    const two = fixture("two", "/work/two");
    const sessions = [one.session, two.session];
    await render(sessions, [
      { ownerId: 1, input: one.input },
      { ownerId: 2, input: two.input },
    ]);
    await act(async () => {
      required(runtime).engine.onSubmit("one", "first");
      required(runtime).engine.onSubmit("two", "second");
    });
    await render(sessions, []);
    await act(async () => vi.advanceTimersByTimeAsync(250));
    native.invoke.mockClear();
    const close = windowCloseParticipants.capture();
    expect(close.busy).toBe(true);
    await act(async () => close.prepare());
    expect(native.ask).not.toHaveBeenCalled();
    const saves = native.invoke.mock.calls.filter(
      ([command]) => command === "workspace_set_snapshot",
    );
    expect(saves).toHaveLength(1);
    expect(saves[0][1].snapshot.tabs).toHaveLength(2);
    expect(
      saves[0][1].snapshot.sessions.map((session: Session) => session.id),
    ).toEqual(["one", "two"]);
    expect(native.invoke).not.toHaveBeenCalledWith("destroy_window");
    await act(async () => close.cancel());
  });

  it("StrictMode leaves one owner and boot without a view preserves the saved layout", async () => {
    const one = fixture("one", "/work/one");
    await render([one.session], [], true);
    await act(async () => vi.advanceTimersByTimeAsync(250));
    expect(
      native.invoke.mock.calls.filter(
        ([command]) => command === "workspace_set_snapshot",
      ),
    ).toHaveLength(0);
    expect(native.register).not.toHaveBeenCalled();
    const close = windowCloseParticipants.capture();
    expect(close.isCurrent()).toBe(true);
    expect(native.bridge).toHaveBeenCalledTimes(2);
    expect(native.stopBridge).toHaveBeenCalledOnce();
    await act(async () => root.render(null));
    expect(close.isCurrent()).toBe(false);
  });
});
