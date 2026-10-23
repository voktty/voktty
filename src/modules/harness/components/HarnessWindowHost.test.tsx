// @vitest-environment happy-dom
import { act, StrictMode, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  HarnessWindowHost,
  useHarnessWindow,
} from "@/modules/harness/components/HarnessWindowHost";
import { abortQuit } from "@/modules/harness/lib/appLifecycle";
import type { HarnessEvent } from "@/modules/harness/lib/harness";
import type {
  HarnessWindowViewCohort,
  HarnessWindowViewInput,
} from "@/modules/harness/lib/harnessWindowViews";
import { newTab } from "@/modules/harness/lib/layout";
import { newSession, type Session } from "@/modules/harness/lib/session";
import { publishActiveSurface } from "@/modules/surfaces";

const native = vi.hoisted(() => ({
  invoke: vi.fn(),
  register: vi.fn(),
  ask: vi.fn(),
  send: vi.fn(),
  approval: vi.fn(),
  bridge: vi.fn(),
  stopBridge: vi.fn(),
  focus: vi.fn(),
  badge: vi.fn(),
  notify: vi.fn().mockResolvedValue(false),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onCloseRequested: native.register,
    onFocusChanged: native.focus,
  }),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: native.ask }));
vi.mock("@/modules/harness/lib/settings", async (original) => ({
  ...(await original<typeof import("@/modules/harness/lib/settings")>()),
  loadCloseToTray: () => false,
}));
vi.mock("@/modules/harness/lib/harness", async () => ({
  ...(await import("@/modules/harness/lib/harness/apply")),
  isLiveHarness: () => true,
  canSteerHarness: () => true,
  sendHarnessTurn: native.send,
  cancelHarnessTurn: vi.fn().mockResolvedValue(undefined),
  generateHarnessTitle: vi.fn().mockResolvedValue(undefined),
  forgetHarnessSession: vi.fn().mockResolvedValue(undefined),
  canRewindHarnessLastTurn: () => false,
  respondHarnessApproval: native.approval,
  registerBuiltinHarnesses: vi.fn(),
  startHarnessBridge: native.bridge,
}));
vi.mock("@/modules/harness/lib/checkpoint", () => ({
  beginSessionTurn: vi.fn().mockResolvedValue(undefined),
  syncSessionCheckpoint: vi.fn().mockResolvedValue(undefined),
  notifyReviewChanged: vi.fn(),
  prepareSessionCheckpoint: vi.fn().mockResolvedValue(undefined),
  captureSessionCheckpoint: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/modules/harness/lib/attachments", () => ({
  displayAttachments: (files: unknown) => files,
  prepareAttachments: async (files: unknown) => files,
}));
vi.mock("@/modules/harness/lib/promptPreparation", () => ({
  preparePrompt: async (text: string) => text,
}));
vi.mock("@/modules/harness/lib/providerAccounts", () => ({
  supportsProviderAccounts: () => false,
}));
vi.mock("@/modules/harness/lib/dockBadge", () => ({
  syncDockBadge: native.badge,
}));
vi.mock("@/modules/harness/lib/notifications", async (original) => ({
  ...(await original<typeof import("@/modules/harness/lib/notifications")>()),
  notifySession: native.notify,
}));
vi.mock("@/modules/harness/lib/sounds", () => ({ playCue: vi.fn() }));
vi.mock("@/modules/harness/lib/fileWatch", () => ({
  nudgeWatchedFiles: vi.fn(),
}));
vi.mock("@/modules/harness/lib/fileIndex", () => ({
  invalidateProjectFiles: vi.fn(),
}));
vi.mock("@/modules/harness/lib/fileTree", () => ({
  notifyDirsChanged: vi.fn(),
}));
vi.mock("@/modules/harness/lib/fs", () => ({ notifyGitChanged: vi.fn() }));

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

type Runtime = ReturnType<typeof useHarnessWindow>;
type ViewProps = {
  ownerId: number;
  input: HarnessWindowViewInput;
  restore?: HarnessWindowViewCohort;
};
let runtime: Runtime | null;
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
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers({
    toFake: [
      "setTimeout",
      "clearTimeout",
      "requestAnimationFrame",
      "cancelAnimationFrame",
    ],
  });
  runtime = null;
  closeListeners = [];
  sends = [];
  native.invoke
    .mockReset()
    .mockImplementation(async (command: string, args) => {
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
  native.register.mockReset().mockImplementation((listener) => {
    closeListeners.push(listener);
    return Promise.resolve(() => undefined);
  });
  native.approval.mockReset();
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
  vi.unstubAllGlobals();
});

async function render(sessions: Session[], views: ViewProps[], strict = false) {
  const children = (
    <HarnessWindowHost initialSessions={() => sessions}>
      <Observe />
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
    expect(native.register).toHaveBeenCalledOnce();
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
    const preventDefault = vi.fn();
    await act(async () => closeListeners[0]({ preventDefault }));
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(native.ask).toHaveBeenCalledOnce();
    const saves = native.invoke.mock.calls.filter(
      ([command]) => command === "workspace_set_snapshot",
    );
    expect(saves).toHaveLength(1);
    expect(saves[0][1].snapshot.tabs).toHaveLength(2);
    expect(
      saves[0][1].snapshot.sessions.map((session: Session) => session.id),
    ).toEqual(["one", "two"]);
    expect(native.invoke).toHaveBeenCalledWith("destroy_window");
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
    expect(native.register).toHaveBeenCalledTimes(2);
    expect(native.bridge).toHaveBeenCalledTimes(2);
    expect(native.stopBridge).toHaveBeenCalledOnce();
  });
});
