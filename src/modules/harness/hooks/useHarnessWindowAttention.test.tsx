// @vitest-environment happy-dom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useHarnessWindowAttention } from "@/modules/harness/hooks/useHarnessWindowAttention";
import { newSession, type Session } from "@/modules/harness/lib/session";

const native = vi.hoisted(() => ({
  register: vi.fn(),
  badge: vi.fn(),
  notify: vi.fn().mockResolvedValue(false),
  focused: vi.fn(),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ onFocusChanged: native.register }),
}));
vi.mock("@/modules/harness/lib/dockBadge", () => ({
  syncDockBadge: native.badge,
}));
vi.mock("@/modules/harness/lib/notifications", async (original) => ({
  ...(await original<typeof import("@/modules/harness/lib/notifications")>()),
  notifySession: native.notify,
  setWindowFocused: native.focused,
}));

type Inputs = Parameters<typeof useHarnessWindowAttention>[0];
type Focus = (event: { payload: boolean }) => void;
let root: Root;
let container: HTMLDivElement;
let mounted: boolean;
let registrations: {
  callback: Focus;
  resolve: (dispose: () => void) => void;
}[];

function Probe(inputs: Inputs) {
  useHarnessWindowAttention(inputs);
  return null;
}

function fixture(sessions: Session[] = []): Inputs {
  return {
    sessions,
    sessionsRef: { current: sessions },
    isForeground: () => false,
    flushHarnessEvents: vi.fn(),
    flushForegroundHarnessEvents: vi.fn(),
  };
}

function waiting(id: string, requestId: number): Session {
  return {
    ...newSession("claude", `/work/${id}`),
    id,
    blocks: [
      {
        id: `${id}-approval`,
        role: "tool",
        text: "Approval",
        approval: { requestId },
      },
    ],
  };
}

async function render(inputs: Inputs, strict = false) {
  await act(async () =>
    root.render(
      strict ? (
        <StrictMode>
          <Probe {...inputs} />
        </StrictMode>
      ) : (
        <Probe {...inputs} />
      ),
    ),
  );
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  native.badge.mockClear();
  native.notify.mockClear();
  native.focused.mockClear();
  registrations = [];
  native.register.mockReset().mockImplementation(
    (callback: Focus) =>
      new Promise<() => void>((resolve) => {
        registrations.push({ callback, resolve });
      }),
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  mounted = true;
});

afterEach(async () => {
  if (mounted) await act(async () => root.unmount());
  for (const registration of registrations) registration.resolve(vi.fn());
  await Promise.resolve();
  container.remove();
  vi.unstubAllGlobals();
});

describe("window Harness attention", () => {
  it("uses foreground reports for every session instead of one selected session", async () => {
    const one = waiting("one", 1);
    const two = waiting("two", 2);
    const hidden = waiting("hidden", 3);
    const inputs = fixture([one, two, hidden]);
    inputs.isForeground = (id) => id === "one" || id === "two";
    await render(inputs);
    expect(
      native.notify.mock.calls.map(([session, , visible]) => [
        session.id,
        visible,
      ]),
    ).toEqual([
      ["one", true],
      ["two", true],
      ["hidden", false],
    ]);
    await render({ ...inputs, sessions: [...inputs.sessions] });
    expect(native.notify).toHaveBeenCalledTimes(3);
    const next = waiting("hidden", 4);
    await render({ ...inputs, sessions: [one, two, next] });
    expect(native.notify).toHaveBeenLastCalledWith(
      next,
      { kind: "approval", requestId: 4 },
      false,
    );
  });

  it("flushes focus and visibility from current inputs without resubscribing", async () => {
    const original = fixture();
    await render(original);
    const dispose = vi.fn();
    await act(async () => registrations[0].resolve(dispose));
    const current = fixture([waiting("current", 9)]);
    await render(current);
    native.badge.mockClear();
    registrations[0].callback({ payload: false });
    expect(native.focused).toHaveBeenLastCalledWith(false);
    expect(current.flushForegroundHarnessEvents).not.toHaveBeenCalled();
    registrations[0].callback({ payload: true });
    expect(native.focused).toHaveBeenLastCalledWith(true);
    expect(current.flushForegroundHarnessEvents).toHaveBeenCalledOnce();
    expect(native.badge).toHaveBeenCalledExactlyOnceWith(
      current.sessionsRef.current,
    );
    document.dispatchEvent(new Event("visibilitychange"));
    expect(current.flushHarnessEvents).toHaveBeenCalledOnce();
    expect(original.flushHarnessEvents).not.toHaveBeenCalled();
    expect(original.flushForegroundHarnessEvents).not.toHaveBeenCalled();
    expect(native.register).toHaveBeenCalledOnce();
    await act(async () => root.unmount());
    mounted = false;
    expect(dispose).toHaveBeenCalledOnce();
    registrations[0].callback({ payload: true });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(current.flushForegroundHarnessEvents).toHaveBeenCalledOnce();
    expect(current.flushHarnessEvents).toHaveBeenCalledOnce();
  });

  it("retires a late registration and ignores its callback even before it resolves", async () => {
    const inputs = fixture();
    await render(inputs);
    await act(async () => root.unmount());
    mounted = false;
    native.badge.mockClear();
    native.focused.mockClear();
    registrations[0].callback({ payload: true });
    document.dispatchEvent(new Event("visibilitychange"));
    const dispose = vi.fn();
    await act(async () => registrations[0].resolve(dispose));
    expect(dispose).toHaveBeenCalledOnce();
    expect(inputs.flushForegroundHarnessEvents).not.toHaveBeenCalled();
    expect(inputs.flushHarnessEvents).not.toHaveBeenCalled();
    expect(native.badge).not.toHaveBeenCalled();
    expect(native.focused).not.toHaveBeenCalled();
  });

  it("keeps only the replacement StrictMode listener active", async () => {
    const inputs = fixture();
    await render(inputs, true);
    expect(registrations).toHaveLength(2);
    const oldDispose = vi.fn();
    const currentDispose = vi.fn();
    await act(async () => {
      registrations[0].resolve(oldDispose);
      registrations[1].resolve(currentDispose);
    });
    expect(oldDispose).toHaveBeenCalledOnce();
    expect(currentDispose).not.toHaveBeenCalled();
    registrations[0].callback({ payload: true });
    registrations[1].callback({ payload: true });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(inputs.flushForegroundHarnessEvents).toHaveBeenCalledOnce();
    expect(inputs.flushHarnessEvents).toHaveBeenCalledOnce();
    await act(async () => root.unmount());
    mounted = false;
    expect(currentDispose).toHaveBeenCalledOnce();
  });

  it("keeps visibility flushing available if native focus registration rejects", async () => {
    native.register.mockRejectedValue(new Error("Unavailable window"));
    const inputs = fixture();
    await render(inputs);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(inputs.flushHarnessEvents).toHaveBeenCalledOnce();
  });
});
