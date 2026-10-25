// @vitest-environment happy-dom
import { act, StrictMode, useLayoutEffect, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, assert, expect, it, vi } from "vitest";
import {
  useAppCloseGuard,
  canOptOutOfAppClosePrompt,
} from "@/app/hooks/useAppCloseGuard";
import { CloseDialogs } from "@/app/components/CloseDialogs";
import { useHarnessWindowPersistence } from "@/modules/harness/hooks/useHarnessWindowPersistence";
import {
  createPersistenceAdmission,
  type PersistenceOwner,
} from "@/modules/harness/lib/persistenceAdmission";
import { newSession } from "@/modules/harness/lib/session";
import { newTab } from "@/modules/harness/lib/layout";
import type { HarnessQuitCapture } from "@/modules/harness/lib/appLifecycle";
import { createTabIdentity } from "@/modules/tabs/lib/tabIdentity";
import type { Tab } from "@/modules/tabs/lib/useTabs";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { windowCloseParticipants } from "@/modules/lifecycle/windowCloseParticipants";
import { loadLocale } from "@/modules/i18n";

const native = vi.hoisted(() => ({
  invoke: vi.fn(),
  register: vi.fn(),
  foreground: vi.fn(),
  ask: vi.fn(),
  toast: vi.fn(),
  tray: false,
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: native.ask }));
vi.mock("sonner", () => ({ toast: { error: native.toast } }));
vi.mock("@/modules/terminal", async () => ({
  leafIds: (await import("@/modules/terminal/lib/panes")).leafIds,
  leafHasForegroundProcess: native.foreground,
}));
vi.mock("@/modules/harness/lib/settings", async (original) => ({
  ...(await original<typeof import("@/modules/harness/lib/settings")>()),
  loadCloseToTray: () => native.tray,
}));
let closeListeners: Array<(event: { preventDefault: () => void }) => void> = [];
let requestExit: () => void;
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name, listener) => {
    if (name === "voktty:request-app-close") requestExit = listener;
    return () => {};
  }),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onCloseRequested: native.register,
    close: async () =>
      closeListeners[closeListeners.length - 1]?.({ preventDefault: vi.fn() }),
  }),
}));
let root: Root;
let node: HTMLDivElement;
let owner: PersistenceOwner;
let workspace: HarnessQuitCapture;
let guard: ReturnType<typeof useAppCloseGuard>;
const promote = vi.fn();
const getOwner = () => owner;
const no = () => {};
function Harness() {
  useHarnessWindowPersistence({
    getOwner,
    revision: 0,
    workspace,
    read: () => workspace,
    flush: no,
    skipSnapshot: true,
  });
  return null;
}
function Desktop({
  tabs = [],
  showHarness = true,
  dialog = false,
}: {
  tabs?: Tab[];
  showHarness?: boolean;
  dialog?: boolean;
}) {
  const current = useRef(tabs);
  useLayoutEffect(() => {
    current.current = tabs;
  });
  guard = useAppCloseGuard(current, promote);
  return (
    <>
      {showHarness ? <Harness /> : null}
      {dialog ? (
        <CloseDialogs
          tabs={tabs}
          pendingCloseTab={null}
          onCancelClose={no}
          onConfirmClose={no}
          pendingTerminalCloseTab={null}
          onCancelTerminalClose={no}
          onConfirmTerminalClose={no}
          pendingDeleteTabs={null}
          onCancelDeleteClose={no}
          onConfirmDeleteClose={no}
          pendingCloseMany={null}
          closeManyConfirming={false}
          onCancelCloseMany={no}
          onConfirmCloseMany={no}
          pendingAppClose={guard.pendingAppClose}
          onCancelAppClose={guard.cancelAppClose}
          onConfirmAppClose={guard.confirmAppClose}
        />
      ) : null}
    </>
  );
}
const editor: Tab = {
  id: 1,
  ...createTabIdentity("main", () => "editor"),
  kind: "editor",
  spaceId: "main",
  title: "file",
  path: "/work/project/file",
  dirty: true,
  preview: false,
};
const terminal: Tab = {
  id: 2,
  ...createTabIdentity("main", () => "terminal"),
  kind: "terminal",
  spaceId: "main",
  title: "shell",
  paneTree: { kind: "leaf", id: 3 },
  activeLeafId: 3,
};
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  owner = createPersistenceAdmission().createOwner();
  const session = newSession("cursor", "/work/project");
  session.busy = true;
  session.blocks = [{ id: "user", role: "user", text: "continue" }];
  const tab = newTab(session.id);
  workspace = {
    sessions: [session],
    tabs: [tab],
    activeTabId: tab.id,
    projectCwd: session.cwd,
    projectReturnMemory: new Map(),
    projectTerminals: [],
  };
  closeListeners = [];
  requestExit = no;
  native.invoke.mockReset().mockResolvedValue([]);
  native.register.mockReset().mockImplementation(async (listener) => {
    closeListeners.push(listener);
    return no;
  });
  native.foreground.mockReset().mockResolvedValue(false);
  native.ask.mockReset();
  native.toast.mockReset();
  native.tray = false;
  promote.mockReset().mockResolvedValue(undefined);
  usePreferencesStore.setState({
    confirmCloseRunningTerminal: true,
    language: "en",
  });
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(async () => {
  await act(async () => root.unmount());
  owner.retire();
  node.remove();
  vi.unstubAllGlobals();
  expect(windowCloseParticipants.capture().busy).toBe(false);
});
async function requestClose() {
  await act(async () => {
    closeListeners[closeListeners.length - 1]?.({ preventDefault: vi.fn() });
  });
}
const commands = () => native.invoke.mock.calls.map(([name]) => name);

it("uses one native listener and one prompt for Harness work, dirty buffers and a foreground terminal", async () => {
  native.foreground.mockResolvedValue(true);
  await act(async () => root.render(<Desktop tabs={[editor, terminal]} />));
  expect(native.register).toHaveBeenCalledOnce();
  await requestClose();
  expect(guard.pendingAppClose).toEqual({
    dirtyEditors: 1,
    busyTerminal: true,
    busyHarness: true,
  });
  assert(guard.pendingAppClose);
  expect(canOptOutOfAppClosePrompt(guard.pendingAppClose)).toBe(false);
  expect(native.ask).not.toHaveBeenCalled();
  expect(promote).not.toHaveBeenCalled();
  await act(async () => guard.cancelAppClose());
  expect(commands()).not.toContain("destroy_window");
  expect(commands()).not.toContain("app_exit_after_flush");
  expect(owner.capture()).not.toBeNull();
});

it.each([
  ["en", false, false, "Harness has unfinished work. Quitting will interrupt it."],
  ["en", true, false, "Harness has unfinished work and a terminal process is still running. Quitting will stop both."],
  ["en", false, true, "Harness has unfinished work and 1 file has unsaved changes. Quitting will interrupt the work and discard the changes."],
  ["en", true, true, "Harness has unfinished work, a terminal process is still running and 1 file has unsaved changes. Quitting will stop the work and discard the changes."],
  ["es", false, false, "Harness tiene trabajo pendiente. Salir lo interrumpirá."],
  ["es", true, false, "Harness tiene trabajo pendiente y un proceso sigue en ejecución en una terminal. Salir detendrá ambos."],
  ["es", false, true, "Harness tiene trabajo pendiente y 1 archivo tiene cambios sin guardar. Salir interrumpirá el trabajo y descartará los cambios."],
  ["es", true, true, "Harness tiene trabajo pendiente, un proceso sigue en ejecución en una terminal y 1 archivo tiene cambios sin guardar. Salir detendrá el trabajo y descartará los cambios."],
] as const)("describes Harness close hazards in %s (terminal=%s, dirty=%s)", async (language, busyTerminal, dirty, message) => {
  await loadLocale(language);
  usePreferencesStore.setState({ language });
  native.foreground.mockResolvedValue(busyTerminal);
  const tabs = [...(busyTerminal ? [terminal] : []), ...(dirty ? [editor] : [])];
  await act(async () => root.render(<Desktop dialog tabs={tabs} />));
  await requestClose();
  expect(document.querySelector('[data-slot="alert-dialog-description"]')?.textContent).toBe(message);
  expect(document.querySelector('[role="checkbox"]')).toBeNull();
  expect(promote).not.toHaveBeenCalled();
});

it("persists the Harness before promoting and exiting through the desktop route", async () => {
  const order: string[] = [];
  native.invoke.mockImplementation(async (name: string) => {
    order.push(name);
    return [];
  });
  promote.mockImplementation(async () => {
    order.push("promote");
  });
  await act(async () => root.render(<Desktop />));
  await requestClose();
  await act(async () => guard.confirmAppClose());
  expect(order.indexOf("session_upsert_batch")).toBeLessThan(
    order.indexOf("workspace_set_snapshot"),
  );
  expect(order.indexOf("session_set_in_flight")).toBeLessThan(
    order.indexOf("promote"),
  );
  expect(order.indexOf("promote")).toBeLessThan(
    order.indexOf("app_exit_after_flush"),
  );
  expect(commands()).not.toContain("destroy_window");
  expect(native.ask).not.toHaveBeenCalled();
});

it("prevents Radix from cancelling its own affirmative dialog action", async () => {
  await act(async () => root.render(<Desktop dialog tabs={[editor]} />));
  await requestClose();
  const button = [
    ...document.querySelectorAll<HTMLButtonElement>("button"),
  ].find((item) => item.textContent === "Discard & Quit");
  if (!button) throw new Error("Missing combined confirmation.");
  await act(async () => button.click());
  expect(commands()).toContain("app_exit_after_flush");
  expect(promote).toHaveBeenCalledOnce();
});

it("does not let the terminal preference silence busy Harness sessions", async () => {
  usePreferencesStore.setState({ confirmCloseRunningTerminal: false });
  await act(async () => root.render(<Desktop tabs={[terminal]} />));
  await requestClose();
  expect(guard.pendingAppClose?.busyHarness).toBe(true);
  expect(native.foreground).not.toHaveBeenCalled();
  expect(promote).not.toHaveBeenCalled();
});

it("cancels the exact Harness seal and permits retry when desktop promotion fails", async () => {
  promote.mockRejectedValueOnce(new Error("store unavailable"));
  await act(async () => root.render(<Desktop />));
  await requestClose();
  await act(async () => guard.confirmAppClose());
  expect(commands()).not.toContain("app_exit_after_flush");
  expect(owner.capture()).not.toBeNull();
  expect(native.toast).toHaveBeenCalledOnce();
  await requestClose();
  await act(async () => guard.confirmAppClose());
  expect(commands()).toContain("app_exit_after_flush");
});

it("keeps the window open if Harness persistence fails", async () => {
  native.invoke.mockImplementation(async (name: string) => {
    if (name === "workspace_set_snapshot") throw new Error("disk full");
    return [];
  });
  await act(async () => root.render(<Desktop />));
  await requestClose();
  await act(async () => guard.confirmAppClose());
  expect(promote).not.toHaveBeenCalled();
  expect(commands()).not.toContain("app_exit_after_flush");
  expect(owner.capture()).not.toBeNull();
  expect(native.toast).toHaveBeenCalledOnce();
});

it("rearms admission immediately when cancelled during an admitted Harness write", async () => {
  let resolve!: (value: unknown[]) => void;
  const pending = new Promise<unknown[]>((yes) => {
    resolve = yes;
  });
  native.invoke.mockImplementation(async (name: string) =>
    name === "session_upsert_batch" ? pending : [],
  );
  await act(async () => root.render(<Desktop />));
  await requestClose();
  let closing!: Promise<void>;
  await act(async () => {
    closing = guard.confirmAppClose();
  });
  expect(owner.capture()).toBeNull();
  await act(async () => guard.cancelAppClose());
  expect(owner.capture()).not.toBeNull();
  await act(async () => {
    resolve([]);
    await closing;
  });
  expect(promote).not.toHaveBeenCalled();
  expect(commands()).not.toContain("app_exit_after_flush");
});

it("hides on normal close-to-tray while an explicit exit still asks for approval", async () => {
  native.tray = true;
  await act(async () => root.render(<Desktop tabs={[editor]} />));
  await requestClose();
  expect(commands()).toContain("hide_window");
  expect(promote).not.toHaveBeenCalled();
  expect(guard.pendingAppClose).toBeNull();
  await act(async () => requestExit());
  expect(guard.pendingAppClose?.busyHarness).toBe(true);
});

it("retires StrictMode callbacks instead of reopening a discarded close", async () => {
  await act(async () =>
    root.render(
      <StrictMode>
        <Desktop />
      </StrictMode>,
    ),
  );
  expect(native.register).toHaveBeenCalledTimes(2);
  const prevented = vi.fn();
  await act(async () => closeListeners[0]({ preventDefault: prevented }));
  expect(prevented).toHaveBeenCalledOnce();
  expect(guard.pendingAppClose).toBeNull();
  await requestClose();
  expect(guard.pendingAppClose?.busyHarness).toBe(true);
});

it("coalesces repeated native close events and affirmative actions", async () => {
  let resolve!: (value: boolean) => void;
  const pending = new Promise<boolean>((yes) => {
    resolve = yes;
  });
  native.foreground.mockReturnValue(pending);
  await act(async () => root.render(<Desktop tabs={[terminal]} />));
  await requestClose();
  await requestClose();
  expect(native.foreground).toHaveBeenCalledOnce();
  await act(async () => resolve(true));
  expect(guard.pendingAppClose?.busyTerminal).toBe(true);
  await requestClose();
  expect(native.foreground).toHaveBeenCalledOnce();
  await act(async () => {
    await Promise.all([guard.confirmAppClose(), guard.confirmAppClose()]);
  });
  expect(promote).toHaveBeenCalledOnce();
  expect(
    commands().filter((name) => name === "workspace_set_snapshot"),
  ).toHaveLength(1);
});

it("vetoes new desktop work that appears while its promoted snapshot is settling", async () => {
  let resolve!: () => void;
  promote.mockReturnValue(
    new Promise<void>((yes) => {
      resolve = yes;
    }),
  );
  await act(async () => root.render(<Desktop />));
  await requestClose();
  let closing!: Promise<void>;
  await act(async () => {
    closing = guard.confirmAppClose();
  });
  expect(promote).toHaveBeenCalledOnce();
  await act(async () => root.render(<Desktop tabs={[editor]} />));
  await act(async () => {
    resolve();
    await closing;
  });
  expect(commands()).not.toContain("app_exit_after_flush");
  expect(owner.capture()).not.toBeNull();
});

it("does not promote or exit after its Harness participant retires during a write", async () => {
  let resolve!: (value: unknown[]) => void;
  const pending = new Promise<unknown[]>((yes) => {
    resolve = yes;
  });
  native.invoke.mockImplementation(async (name: string) =>
    name === "session_upsert_batch" ? pending : [],
  );
  await act(async () => root.render(<Desktop />));
  await requestClose();
  let closing!: Promise<void>;
  await act(async () => {
    closing = guard.confirmAppClose();
  });
  await act(async () => root.render(<Desktop showHarness={false} />));
  await act(async () => {
    resolve([]);
    await closing;
  });
  expect(promote).not.toHaveBeenCalled();
  expect(commands()).not.toContain("app_exit_after_flush");
  expect(owner.capture()).not.toBeNull();
});

it("rolls back the quit reader if participant registration rejects", async () => {
  const { ownHarnessWindowPersistence } = await import(
    "@/modules/harness/lib/harnessWindowPersistence"
  );
  const { reportQuitPoll } = await import("@/modules/harness/lib/appLifecycle");
  expect(() =>
    ownHarnessWindowPersistence({
      owner,
      read: () => workspace,
      flush: no,
      skipSnapshot: () => true,
      closeToTray: () => false,
      target: new EventTarget(),
      registerClose: async () => no,
      registerDesktopClose: () => {
        throw new Error("capacity");
      },
      schedule: () => no,
    }),
  ).toThrow("capacity");
  await reportQuitPoll(77);
  expect(native.invoke).toHaveBeenCalledWith("quit_poll_reply", {
    id: 77,
    inFlight: 0,
  });
});
