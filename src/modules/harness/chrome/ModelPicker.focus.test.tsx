// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@/modules/i18n", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("../lib/harness/availability", () => ({
  getHarnessAvailabilitySnapshot: () => 1,
  harnessUnavailableHint: () => "Harness unavailable",
  hasProbedHarnessAvailability: () => true,
  isHarnessAvailable: (id: string) => id === "cursor",
  probeHarnessAvailability: () => Promise.resolve(),
  subscribeHarnessAvailability: () => () => {},
}));

vi.mock("../lib/harness/registry", () => ({
  refreshHarnessCatalogs: () => Promise.resolve(),
}));

import { ModelPicker } from "./ModelPicker";

let container: HTMLDivElement;
let root: Root;
let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;
const scrollIntoViewDescriptor = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "scrollIntoView",
);

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  frames = new Map();
  nextFrame = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    const handle = ++nextFrame;
    frames.set(handle, callback);
    return handle;
  });
  vi.stubGlobal("cancelAnimationFrame", (handle: number) => {
    frames.delete(handle);
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
  localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  localStorage.clear();
  vi.unstubAllGlobals();
  if (scrollIntoViewDescriptor) {
    Object.defineProperty(
      HTMLElement.prototype,
      "scrollIntoView",
      scrollIntoViewDescriptor,
    );
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
  }
});

it("focuses the model search after its flyout appears", async () => {
  await act(async () => {
    root.render(
      createElement(ModelPicker, {
        harness: "cursor",
        model: "cursor:composer-2.5",
        values: {},
        onChange: vi.fn(),
        onSettingsChange: vi.fn(),
      }),
    );
  });

  const trigger = container.querySelector<HTMLButtonElement>(
    'button[aria-haspopup="menu"]',
  );
  expect(trigger).not.toBeNull();
  await act(async () => trigger?.click());

  const modelRow = document.body.querySelector<HTMLButtonElement>(
    'button[data-model-control-index="0"]',
  );
  expect(modelRow).not.toBeNull();
  await act(async () => {
    modelRow?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  });

  const search = document.body.querySelector<HTMLInputElement>(
    'input[placeholder="harness.modelPicker.searchModels"]',
  );
  expect(search).not.toBeNull();
  expect(document.activeElement).not.toBe(search);
  expect(frames.size).toBe(1);
  act(() => {
    const frame = frames.entries().next().value;
    if (!frame) throw new Error("model search focus frame was not scheduled");
    const [handle, callback] = frame;
    frames.delete(handle);
    callback(0);
  });
  expect(document.activeElement).toBe(search);
});
