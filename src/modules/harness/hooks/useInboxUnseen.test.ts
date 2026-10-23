// @vitest-environment happy-dom
import { invoke } from "@tauri-apps/api/core";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useInboxUnseen } from "./useInboxUnseen";
import { HarnessInboxContext } from "@/modules/harness/hooks/harnessInboxContext";
import { createPersistenceAdmission } from "@/modules/harness/lib/persistenceAdmission";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const itemCalls = () =>
  vi
    .mocked(invoke)
    .mock.calls.filter(([command]) => command === "git_github_work_items");

function Harness() {
  useInboxUnseen([{ path: "/tmp/web", openedAt: 1 }], "/tmp/web");
  return null;
}

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  localStorage.clear();
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === "git_github_repo") return "acme/web";
    if (command === "git_github_work_items") return [];
    if (command === "linear_status") return { connected: false };
    throw new Error(`Unexpected command: ${command}`);
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  localStorage.clear();
  delete (document as { hidden?: boolean }).hidden;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("spaces tray polling and coalesces repeated visibility changes", async () => {
  await act(async () => root.render(createElement(Harness)));
  expect(itemCalls()).toHaveLength(2);

  await act(async () => vi.advanceTimersByTimeAsync(119_999));
  expect(itemCalls()).toHaveLength(2);
  await act(async () => vi.advanceTimersByTimeAsync(1));
  expect(itemCalls()).toHaveLength(4);

  Object.defineProperty(document, "hidden", {
    configurable: true,
    value: true,
  });
  await act(async () => vi.advanceTimersByTimeAsync(299_999));
  expect(itemCalls()).toHaveLength(4);
  await act(async () => vi.advanceTimersByTimeAsync(1));
  expect(itemCalls()).toHaveLength(6);

  Object.defineProperty(document, "hidden", {
    configurable: true,
    value: false,
  });
  await act(async () => {
    for (let i = 0; i < 10; i++) {
      document.dispatchEvent(new Event("visibilitychange"));
    }
  });
  expect(itemCalls()).toHaveLength(6);
});

it("does not overlap a background refresh while the previous one is pending", async () => {
  const pending = new Promise<never>(() => {});
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === "git_github_repo") return "acme/web";
    if (command === "git_github_work_items") return pending;
    if (command === "linear_status") return { connected: false };
    throw new Error(`Unexpected command: ${command}`);
  });

  await act(async () => root.render(createElement(Harness)));
  await act(async () => vi.advanceTimersByTimeAsync(10 * 60_000));
  expect(itemCalls()).toHaveLength(2);
});

it("reads the host badge without starting another poller or dispatching consumer callbacks", async () => {
  const onAppeared = vi.fn();
  let observed: boolean | undefined;
  function Reader() {
    observed = useInboxUnseen(
      [{ path: "/tmp/shared", openedAt: 1 }],
      "/tmp/shared",
      { onAppeared },
    );
    return null;
  }
  await act(async () =>
    root.render(
      createElement(
        HarnessInboxContext.Provider,
        { value: true },
        createElement(Reader),
      ),
    ),
  );
  expect(observed).toBe(true);
  await act(async () => vi.advanceTimersByTimeAsync(600_000));
  expect(itemCalls()).toHaveLength(0);
  expect(onAppeared).not.toHaveBeenCalled();
});

it("does not borrow recovered admission for an Inbox read started before seal and cancellation", async () => {
  let resolve!: (items: unknown[]) => void;
  const pending = new Promise<unknown[]>((done) => {
    resolve = done;
  });
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === "git_github_repo") return "acme/guard";
    if (command === "git_github_work_items") return pending;
    if (command === "linear_status") return { connected: false };
    throw new Error(`Unexpected command: ${command}`);
  });
  const owner = createPersistenceAdmission().createOwner();
  const onAppeared = vi.fn();
  function Guarded() {
    useInboxUnseen([{ path: "/tmp/guard", openedAt: 1 }], "/tmp/guard", {
      getOwner: () => owner,
      onAppeared,
    });
    return null;
  }
  await act(async () => root.render(createElement(Guarded)));
  const final = owner.capture()?.seal();
  expect(final?.pending).toBeNull();
  final?.cancel();
  await act(async () => resolve([]));
  expect(onAppeared).not.toHaveBeenCalled();
});
