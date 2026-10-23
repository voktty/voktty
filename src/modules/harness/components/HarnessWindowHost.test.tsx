// @vitest-environment happy-dom
import { act, StrictMode, useLayoutEffect, type ReactNode } from "react";
import { useInboxUnseen } from "@/modules/harness/hooks/useInboxUnseen";
import { useHarnessSummaryUpdates } from "@/modules/harness/hooks/useHarnessSummaryUpdates";
import type { HarnessSummarySource } from "@/modules/harness/lib/harnessSummaryUpdates";
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
import {
  newAutomationDraft,
  type Automation,
  type AutomationRun,
} from "@/modules/harness/lib/automations";

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
  recover: vi.fn(),
  listAutomations: vi.fn(),
  updateRun: vi.fn(),
  claim: vi.fn(),
  pending: vi.fn(),
  inboxList: vi.fn(),
}));
vi.mock("@/modules/harness/lib/githubTasks", async (original) => ({
  ...(await original<typeof import("@/modules/harness/lib/githubTasks")>()),
  listInboxItems: native.inboxList,
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
vi.mock("@/modules/harness/lib/sounds", () => ({
  playCue: vi.fn(),
  noteInboxUnseen: vi.fn(),
}));
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
  localStorage.clear();
  native.inboxList.mockReset().mockResolvedValue({ items: [], errors: {} });
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
  closeListeners = [];
  sends = [];
  native.invoke
    .mockReset()
    .mockImplementation(async (command: string, args) => {
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

async function render(
  sessions: Session[],
  views: ViewProps[],
  strict = false,
  extra?: ReactNode,
) {
  const children = (
    <HarnessWindowHost initialSessions={() => sessions}>
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
