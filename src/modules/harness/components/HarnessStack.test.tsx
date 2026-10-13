// @vitest-environment happy-dom
import { act, createElement, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { HarnessTab } from "@/modules/tabs";
import { HarnessStack } from "./HarnessStack";

const mounts = vi.hoisted(() => ({
  harness: vi.fn(),
  native: vi.fn(),
  release: vi.fn(),
}));
vi.mock("@/modules/i18n", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("./HarnessApp", () => ({
  HarnessApp: () => {
    useEffect(() => {
      mounts.harness();
    }, []);
    return createElement("div", { "data-harness": true }, "Harness");
  },
}));
vi.mock("./HarnessNativeAiView", () => ({
  HarnessNativeAiView: () => {
    useEffect(() => {
      mounts.native();
      return mounts.release;
    }, []);
    return createElement("div", { "data-native": true }, "Native AI");
  },
}));
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const tabs = [{ id: 1, kind: "harness", cwd: "/project" }] as HarnessTab[];
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
it("keeps Harness sessions mounted and releases native chat when the tab loses focus", async () => {
  await act(async () => {
    root.render(createElement(HarnessStack, { tabs, activeId: 1 }));
  });
  expect(mounts.harness).toHaveBeenCalledTimes(1);
  const buttons = container.querySelectorAll<HTMLButtonElement>("button");
  await act(async () => {
    buttons[1].click();
  });
  expect(container.querySelector("[data-native]")).not.toBeNull();
  expect(container.querySelector("[data-harness]")).not.toBeNull();
  expect(mounts.harness).toHaveBeenCalledTimes(1);
  await act(async () => {
    root.render(createElement(HarnessStack, { tabs, activeId: 2 }));
  });
  expect(container.querySelector("[data-native]")).toBeNull();
  expect(mounts.release).toHaveBeenCalledTimes(1);
  await act(async () => {
    root.render(createElement(HarnessStack, { tabs, activeId: 1 }));
  });
  expect(mounts.native).toHaveBeenCalledTimes(2);
  await act(async () => {
    buttons[0].click();
  });
  expect(container.querySelector("[data-native]")).toBeNull();
  expect(mounts.harness).toHaveBeenCalledTimes(1);
});
