// @vitest-environment happy-dom
import { invoke } from "@tauri-apps/api/core";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useInboxUnseen } from "./useInboxUnseen";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const itemCalls = () =>
  vi.mocked(invoke).mock.calls.filter(
    ([command]) => command === "git_github_work_items",
  );

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
