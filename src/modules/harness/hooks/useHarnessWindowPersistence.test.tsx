// @vitest-environment happy-dom
import { act, StrictMode, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useHarnessWindowPersistence } from "@/modules/harness/hooks/useHarnessWindowPersistence";
import { useWindowPersistenceAdmission } from "@/modules/harness/hooks/useWindowPersistenceAdmission";
import {
  abortQuit,
  type HarnessQuitCapture,
} from "@/modules/harness/lib/appLifecycle";
import { newTab } from "@/modules/harness/lib/layout";
import {
  windowPersistenceAdmission,
  type PersistenceOwner,
} from "@/modules/harness/lib/persistenceAdmission";
import { newSession } from "@/modules/harness/lib/session";
import { windowCloseParticipants } from "@/modules/lifecycle/windowCloseParticipants";

const native = vi.hoisted(() => ({ invoke: vi.fn(), register: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ onCloseRequested: native.register }),
}));
vi.mock("@/modules/harness/lib/settings", async (original) => ({
  ...(await original<typeof import("@/modules/harness/lib/settings")>()),
  loadCloseToTray: () => true,
}));

function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("Missing writer hook fixture");
  return value;
}

function workspace(cwd: string): HarnessQuitCapture {
  const session = newSession("cursor", cwd);
  const tab = newTab(session.id);
  return {
    sessions: [session],
    tabs: [tab],
    activeTabId: tab.id,
    projectCwd: cwd,
    projectReturnMemory: new Map(),
    projectTerminals: [],
  };
}

function Publisher({
  state,
  observe,
}: {
  state: HarnessQuitCapture;
  observe: (owner: PersistenceOwner | null) => void;
}) {
  const admission = useWindowPersistenceAdmission(() => undefined);
  useHarnessWindowPersistence({
    getOwner: admission.getOwner,
    revision: admission.revision,
    read: () => state,
    workspace: state,
    flush: () => undefined,
    skipSnapshot: false,
  });
  useEffect(() => {
    observe(admission.getOwner());
  });
  return null;
}

let root: Root;
let container: HTMLDivElement;
let owner: PersistenceOwner | null;
let listeners: ((event: { preventDefault: () => void }) => void)[];
let unlisten: ReturnType<typeof vi.fn>[];

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  native.invoke.mockReset().mockResolvedValue(undefined);
  native.register.mockReset().mockImplementation((listener) => {
    listeners.push(listener);
    const stop = vi.fn();
    unlisten.push(stop);
    return Promise.resolve(stop);
  });
  listeners = [];
  unlisten = [];
  owner = null;
  abortQuit();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  abortQuit();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function render(state: HarnessQuitCapture) {
  await act(async () =>
    root.render(
      <StrictMode>
        <Publisher
          state={state}
          observe={(current) => {
            owner = current;
          }}
        />
      </StrictMode>,
    ),
  );
}

function snapshots() {
  return native.invoke.mock.calls.filter(
    ([command]) => command === "workspace_set_snapshot",
  );
}

describe("Harness writer hook lifecycle", () => {
  it("StrictMode retires discarded contributions and timers without a second native listener", async () => {
    await render(workspace("/work/project"));
    expect(native.register).not.toHaveBeenCalled();
    const stale = windowCloseParticipants.capture();
    await act(async () => root.render(null));
    expect(stale.isCurrent()).toBe(false);
    await expect(stale.hide()).rejects.toThrow("retired");
    expect(native.invoke).not.toHaveBeenCalledWith("hide_window");
    await render(workspace("/work/project"));
    await act(async () => vi.advanceTimersByTimeAsync(250));
    expect(snapshots()).toHaveLength(1);
    await act(async () => windowCloseParticipants.capture().hide());
    expect(native.invoke).toHaveBeenCalledWith("hide_window");
  });

  it("publishes current props without reinstalling native listeners", async () => {
    await render(workspace("/work/old"));
    const original = owner;
    await render(workspace("/work/current"));
    expect(owner).toBe(original);
    expect(native.register).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(250));
    expect(snapshots()).toHaveLength(1);
    expect(snapshots()[0][1].snapshot.projectCwd).toBe("/work/current");
  });

  it("requeues current props on close cancellation without an old snapshot", async () => {
    await render(workspace("/work/old"));
    const final = required(required(required(owner).capture()).seal());
    await render(workspace("/work/current"));
    await act(async () => final.cancel());
    await act(async () => vi.advanceTimersByTimeAsync(250));
    expect(snapshots()).toHaveLength(1);
    expect(snapshots()[0][1].snapshot.projectCwd).toBe("/work/current");
  });

  it("retries unchanged state when write capacity becomes available", async () => {
    const blocker = windowPersistenceAdmission.createOwner();
    const permit = required(blocker.capture());
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pending = Array.from({ length: 256 }, () => permit.run(() => gate));
    try {
      await render(workspace("/work/project"));
      await act(async () => vi.advanceTimersByTimeAsync(250));
      expect(snapshots()).toHaveLength(0);
      await act(async () => {
        release();
        await Promise.all(pending);
      });
      await act(async () => vi.advanceTimersByTimeAsync(250));
      expect(snapshots()).toHaveLength(1);
    } finally {
      release();
      await Promise.all(pending);
      blocker.retire();
    }
  });
});
