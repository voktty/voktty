import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HarnessQuitCapture } from "@/modules/harness/lib/appLifecycle";
import { newTab } from "@/modules/harness/lib/layout";
import { newSession } from "@/modules/harness/lib/session";

const native = vi.hoisted(() => ({ invoke: vi.fn(), ask: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: native.ask }));

function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("Missing window writer fixture");
  return value;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function workspace(cwd = "/work/first", busy = false): HarnessQuitCapture {
  const session = {
    ...newSession("cursor", cwd),
    busy,
    blocks: [{ id: "user", role: "user" as const, text: "continue" }],
  };
  const tab = newTab(session.id);
  return {
    sessions: [session],
    tabs: [tab],
    activeTabId: tab.id,
    projectCwd: cwd,
    projectReturnMemory: new Map([[cwd, session.id]]),
    projectTerminals: [],
  };
}

const releases: (() => void)[] = [];
beforeEach(() => {
  vi.resetModules();
  native.invoke
    .mockReset()
    .mockImplementation(async (command: string) =>
      command === "session_upsert_batch" ? [] : undefined,
    );
  native.ask.mockReset().mockResolvedValue(true);
});
afterEach(() => {
  for (const release of releases.splice(0).reverse()) release();
});

async function fixture(
  initial = workspace(),
  registration?: Promise<() => void>,
) {
  const { windowPersistenceAdmission: authority } = await import(
    "@/modules/harness/lib/persistenceAdmission"
  );
  const { ownHarnessWindowPersistence } = await import(
    "@/modules/harness/lib/harnessWindowPersistence"
  );
  const lifecycle = await import("@/modules/harness/lib/appLifecycle");
  let state = initial;
  let transfer = false;
  let tray = false;
  const close = { listener: (_event: { preventDefault: () => void }) => {} };
  const target = new EventTarget();
  const timers: { callback: () => void; cancel: ReturnType<typeof vi.fn> }[] =
    [];
  const flush = vi.fn();
  const read = vi.fn(() => state);
  const unlisten = vi.fn();
  const owner = authority.createOwner();
  const controller = ownHarnessWindowPersistence({
    owner,
    read,
    flush,
    target,
    skipSnapshot: () => transfer,
    closeToTray: () => tray,
    registerClose: (listener) => {
      close.listener = listener;
      return registration ?? Promise.resolve(unlisten);
    },
    schedule: (callback, delay) => {
      expect(delay).toBe(250);
      const cancel = vi.fn();
      timers.push({ callback, cancel });
      return cancel;
    },
  });
  if (!registration) await controller.ready;
  releases.push(() => {
    controller.release();
    owner.retire();
    lifecycle.abortQuit();
  });
  const calls = (command: string) =>
    native.invoke.mock.calls.filter(([name]) => name === command);
  return {
    owner,
    authority,
    controller,
    target,
    timers,
    flush,
    read,
    lifecycle,
    calls,
    unlisten,
    state: () => state,
    setState: (next: HarnessQuitCapture) => {
      state = next;
    },
    transfer: () => {
      transfer = true;
    },
    tray: () => {
      tray = true;
    },
    close: () => {
      const preventDefault = vi.fn();
      close.listener({ preventDefault });
      expect(preventDefault).toHaveBeenCalledOnce();
    },
    fire: () => required(timers[timers.length - 1]).callback(),
  };
}

describe("joint Harness window writer ownership", () => {
  it("publishes refs and layout from one capture and keeps the empty-boot policy", async () => {
    const f = await fixture();
    f.controller.publish();
    expect(f.read).toHaveBeenCalledTimes(2);
    expect(f.calls("session_set_in_flight")).toHaveLength(0);
    expect(f.calls("workspace_set_snapshot")).toHaveLength(0);
    f.fire();
    await vi.waitFor(() =>
      expect(f.calls("workspace_set_snapshot")).toHaveLength(1),
    );
    expect(f.calls("workspace_set_snapshot")[0][1].snapshot.projectCwd).toBe(
      "/work/first",
    );
  });

  it("does not postpone an unchanged pending layout on transcript updates", async () => {
    const f = await fixture();
    f.controller.publish();
    f.setState({
      ...f.state(),
      sessions: f.state().sessions.map((s) => ({
        ...s,
        blocks: [
          ...s.blocks,
          { id: "reply", role: "assistant", text: "reply" },
        ],
      })),
    });
    f.controller.publish();
    expect(f.timers).toHaveLength(1);
    f.fire();
    await vi.waitFor(() =>
      expect(f.calls("workspace_set_snapshot")).toHaveLength(1),
    );
  });

  it("retires superseded timer callbacks even while the permit remains current", async () => {
    const f = await fixture();
    f.controller.publish();
    const stale = required(f.timers[f.timers.length - 1]);
    f.setState(workspace("/work/second"));
    f.controller.publish();
    expect(stale.cancel).toHaveBeenCalledOnce();
    stale.callback();
    f.fire();
    await vi.waitFor(() =>
      expect(f.calls("workspace_set_snapshot")).toHaveLength(1),
    );
    expect(f.calls("workspace_set_snapshot")[0][1].snapshot.projectCwd).toBe(
      "/work/second",
    );
  });

  it("clears recovery refs after the last running session settles", async () => {
    const f = await fixture(workspace("/work/first", true));
    f.controller.publish();
    await vi.waitFor(() =>
      expect(f.calls("session_set_in_flight")).toHaveLength(1),
    );
    f.setState({
      ...f.state(),
      sessions: f.state().sessions.map((s) => ({ ...s, busy: false })),
    });
    f.controller.publish();
    await vi.waitFor(() =>
      expect(f.calls("session_set_in_flight")).toHaveLength(2),
    );
    expect(f.calls("session_set_in_flight")[1][1].sessions).toEqual([]);
  });

  it("suppresses transfer snapshots while preserving recovery refs", async () => {
    const f = await fixture(workspace("/work/first", true));
    f.transfer();
    f.controller.publish();
    await vi.waitFor(() =>
      expect(f.calls("session_set_in_flight")).toHaveLength(1),
    );
    expect(f.timers).toHaveLength(0);
  });

  it("recaptures the confirmed workspace and fences the old periodic timer", async () => {
    const f = await fixture(workspace("/work/first", true));
    const decision = deferred<boolean>();
    native.ask.mockReturnValueOnce(decision.promise);
    f.controller.publish();
    const stale = required(f.timers[f.timers.length - 1]);
    f.close();
    expect(native.ask).toHaveBeenCalledOnce();
    f.setState(workspace("/work/confirmed"));
    decision.resolve(true);
    await vi.waitFor(() => expect(f.calls("destroy_window")).toHaveLength(1));
    stale.callback();
    await Promise.resolve();
    expect(f.calls("workspace_set_snapshot")).toHaveLength(1);
    expect(f.calls("workspace_set_snapshot")[0][1].snapshot.projectCwd).toBe(
      "/work/confirmed",
    );
  });

  it("a released owner cannot finish a pending close or reuse its timer", async () => {
    const f = await fixture(workspace("/work/first", true));
    const decision = deferred<boolean>();
    native.ask.mockReturnValueOnce(decision.promise);
    f.controller.publish();
    const stale = required(f.timers[f.timers.length - 1]);
    f.close();
    f.controller.release();
    f.owner.retire();
    decision.resolve(true);
    stale.callback();
    await decision.promise;
    await Promise.resolve();
    expect(f.calls("destroy_window")).toHaveLength(0);
    expect(f.calls("workspace_set_snapshot")).toHaveLength(0);
    expect(f.unlisten).toHaveBeenCalledOnce();
  });

  it("cancelled sealing rearms current state without reviving old callbacks", async () => {
    const f = await fixture();
    f.controller.publish();
    const stale = required(f.timers[f.timers.length - 1]);
    const final = required(required(f.owner.capture()).seal());
    f.setState(workspace("/work/current"));
    final.cancel();
    f.controller.resume();
    stale.callback();
    f.fire();
    await vi.waitFor(() =>
      expect(f.calls("workspace_set_snapshot")).toHaveLength(1),
    );
    expect(f.calls("workspace_set_snapshot")[0][1].snapshot.projectCwd).toBe(
      "/work/current",
    );
  });

  it("quit polls and commits use the same post-flush capture", async () => {
    const f = await fixture();
    f.flush.mockImplementation(() => f.setState(workspace("/work/quit", true)));
    await f.lifecycle.reportQuitPoll(14);
    expect(native.invoke).toHaveBeenCalledWith("quit_poll_reply", {
      id: 14,
      inFlight: 1,
    });
    await f.lifecycle.commitQuit(14);
    expect(f.calls("workspace_set_snapshot")[0][1].snapshot.projectCwd).toBe(
      "/work/quit",
    );
  });

  it("close drains an already admitted periodic snapshot before final persistence", async () => {
    const f = await fixture();
    const saving = deferred<void>();
    native.invoke.mockImplementation(async (command: string) => {
      if (command === "workspace_set_snapshot") await saving.promise;
      return command === "session_upsert_batch" ? [] : undefined;
    });
    f.controller.publish();
    f.fire();
    await vi.waitFor(() =>
      expect(f.calls("workspace_set_snapshot")).toHaveLength(1),
    );
    f.setState(workspace("/work/final"));
    f.close();
    await Promise.resolve();
    expect(f.calls("session_upsert_batch")).toHaveLength(0);
    expect(f.calls("destroy_window")).toHaveLength(0);
    saving.resolve();
    await vi.waitFor(() => expect(f.calls("destroy_window")).toHaveLength(1));
    expect(
      f
        .calls("workspace_set_snapshot")
        .map(([, args]) => args.snapshot.projectCwd),
    ).toEqual(["/work/first", "/work/final"]);
  });

  it("tray close saves live transcripts without sealing or snapshotting", async () => {
    const f = await fixture();
    f.tray();
    f.close();
    await vi.waitFor(() =>
      expect(f.calls("session_upsert_batch")).toHaveLength(1),
    );
    expect(f.calls("hide_window")).toHaveLength(1);
    expect(f.calls("workspace_set_snapshot")).toHaveLength(0);
    expect(f.owner.capture()).not.toBeNull();
  });

  it("final close applies keepTab while periodic persistence keeps the live layout", async () => {
    const initial = workspace();
    initial.keepTab = () => false;
    const f = await fixture(initial);
    f.controller.publish();
    f.fire();
    await vi.waitFor(() =>
      expect(f.calls("workspace_set_snapshot")).toHaveLength(1),
    );
    f.close();
    await vi.waitFor(() => expect(f.calls("destroy_window")).toHaveLength(1));
    expect(
      f
        .calls("workspace_set_snapshot")
        .map(([, args]) => args.snapshot.tabs.length),
    ).toEqual([1, 0]);
  });

  it("failed native registration vetoes confirmation without disabling the publishers", async () => {
    const registration = deferred<() => void>();
    const f = await fixture(
      workspace("/work/project", true),
      registration.promise,
    );
    const decision = deferred<boolean>();
    native.ask.mockReturnValueOnce(decision.promise);
    f.close();
    registration.reject(new Error("listener unavailable"));
    await expect(f.controller.ready).rejects.toThrow("listener unavailable");
    decision.resolve(true);
    await decision.promise;
    await Promise.resolve();
    expect(f.calls("destroy_window")).toHaveLength(0);
    expect(f.calls("session_upsert_batch")).toHaveLength(0);
    f.controller.publish();
    f.fire();
    await vi.waitFor(() =>
      expect(f.calls("workspace_set_snapshot")).toHaveLength(1),
    );
  });

  it("denied unload writes cannot enter native reap", async () => {
    const f = await fixture();
    const permit = required(f.owner.capture());
    const gate = deferred<void>();
    const pending = Array.from({ length: 256 }, () =>
      permit.run(() => gate.promise),
    );
    try {
      f.target.dispatchEvent(new Event("beforeunload"));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(f.calls("session_upsert_batch")).toHaveLength(0);
      expect(f.calls("workspace_set_snapshot")).toHaveLength(0);
      expect(f.calls("harness_kill_all")).toHaveLength(0);
    } finally {
      gate.resolve();
      await Promise.all(pending);
    }
  });

  it("coalesces unload signals and preserves the unload worktree policy", async () => {
    const initial = workspace();
    initial.keepTab = () => false;
    const f = await fixture(initial);
    f.target.dispatchEvent(new Event("pagehide"));
    f.target.dispatchEvent(new Event("beforeunload"));
    await vi.waitFor(() => expect(f.calls("harness_kill_all")).toHaveLength(1));
    expect(f.calls("session_upsert_batch")).toHaveLength(1);
    expect(f.calls("workspace_set_snapshot")[0][1].snapshot.tabs).toHaveLength(
      1,
    );
    expect(f.calls("session_set_in_flight")).toHaveLength(0);
  });

  it("release during unload persistence vetoes later phases and reap", async () => {
    const f = await fixture();
    const saving = deferred<[]>();
    native.invoke.mockImplementation(async (command: string) =>
      command === "session_upsert_batch" ? saving.promise : undefined,
    );
    f.target.dispatchEvent(new Event("pagehide"));
    await vi.waitFor(() =>
      expect(f.calls("session_upsert_batch")).toHaveLength(1),
    );
    f.controller.release();
    saving.resolve([]);
    await saving.promise;
    await Promise.resolve();
    expect(f.calls("workspace_set_snapshot")).toHaveLength(0);
    expect(f.calls("harness_kill_all")).toHaveLength(0);
  });

  it("releasing the controller cancels only its own pending final seal", async () => {
    const f = await fixture();
    const saving = deferred<[]>();
    native.invoke.mockImplementation(async (command: string) =>
      command === "session_upsert_batch" ? saving.promise : undefined,
    );
    f.close();
    await vi.waitFor(() =>
      expect(f.calls("session_upsert_batch")).toHaveLength(1),
    );
    expect(f.owner.capture()).toBeNull();
    f.controller.release();
    expect(f.owner.capture()).not.toBeNull();
    const replacement = required(required(f.owner.capture()).seal());
    f.controller.release();
    expect(replacement.isCurrent()).toBe(true);
    saving.resolve([]);
    await saving.promise;
    await Promise.resolve();
    expect(f.calls("workspace_set_snapshot")).toHaveLength(0);
    expect(f.calls("destroy_window")).toHaveLength(0);
    replacement.cancel();
  });
});
