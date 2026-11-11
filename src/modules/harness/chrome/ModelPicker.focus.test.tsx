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
  vi.restoreAllMocks();
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

it("opens recent models through its active hotkey without accepting the retired menu event", async () => {
  vi.spyOn(performance, "now").mockReturnValue(1000);
  const props = {
    harness: "cursor" as const,
    model: "cursor:composer-2.5",
    values: {},
    hotkeys: true,
    onChange: vi.fn(),
    onSettingsChange: vi.fn(),
  };
  await act(async () => root.render(createElement(ModelPicker, props)));
  const trigger = container.querySelector<HTMLButtonElement>(
    'button[aria-haspopup="menu"]',
  );
  expect(trigger).not.toBeNull();
  await act(async () => window.dispatchEvent(new Event("open_model_picker")));
  expect(trigger?.getAttribute("aria-expanded")).toBe("false");
  await act(async () =>
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: ".", ctrlKey: true }),
    ),
  );
  expect(trigger?.getAttribute("aria-expanded")).toBe("true");
  expect(
    document.querySelector('[aria-label="harness.modelPicker.recentlyUsed"]'),
  ).not.toBeNull();
});

it("opens the model list straight away when the model has nothing to tune", async () => {
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

  // No intermediate one-row menu: the search is already there.
  expect(
    document.body.querySelector('button[data-model-control-index="0"]'),
  ).toBeNull();
  const search = document.body.querySelector<HTMLInputElement>(
    'input[placeholder="harness.modelPicker.searchModels"]',
  );
  expect(search).not.toBeNull();
  const pending = [...frames.entries()];
  act(() => {
    for (const [handle, callback] of pending) {
      frames.delete(handle);
      callback(0);
    }
  });
  expect(document.activeElement).toBe(search);
});

it("shows the effort on the trigger and picks it on a track, low to high", async () => {
  const onSettingsChange = vi.fn();
  await act(async () => {
    root.render(
      createElement(ModelPicker, {
        harness: "grok",
        model: "grok:grok-4.6",
        values: { effort: "low" },
        onChange: vi.fn(),
        onSettingsChange,
      }),
    );
  });
  const trigger = container.querySelector<HTMLButtonElement>(
    'button[aria-haspopup="menu"]',
  );
  expect(trigger?.textContent).toContain("Grok 4.6");
  expect(trigger?.textContent).toContain("harness.modelSettings.low");
  await act(async () => trigger?.click());

  const stops = [
    ...document.body.querySelectorAll<HTMLButtonElement>(
      '[data-effort-slider] [role="radio"]',
    ),
  ];
  // The catalog lists Extra High first; the track always starts low.
  expect(stops.map((stop) => stop.getAttribute("aria-label"))).toEqual([
    "harness.modelSettings.low",
    "harness.modelSettings.medium",
    "harness.modelSettings.high",
    "harness.modelSettings.extraHigh",
  ]);
  expect(stops[0]?.getAttribute("aria-checked")).toBe("true");
  await act(async () => stops[2]?.click());
  expect(onSettingsChange).toHaveBeenCalledWith({ effort: "high" });
  // The menu stays open: the model row is still one click away.
  expect(
    document.body.querySelector('button[data-model-control-index="0"]'),
  ).not.toBeNull();
});

it("swaps the card for the model list in place and comes back", async () => {
  await act(async () => {
    root.render(
      createElement(ModelPicker, {
        harness: "grok",
        model: "grok:grok-4.6",
        values: { effort: "low" },
        onChange: vi.fn(),
        onSettingsChange: vi.fn(),
      }),
    );
  });
  const trigger = container.querySelector<HTMLButtonElement>(
    'button[aria-haspopup="menu"]',
  );
  await act(async () => trigger?.click());
  const surfaces = () => document.body.querySelectorAll("[data-model-picker]").length;
  expect(surfaces()).toBe(1);
  // Hovering the model row opens nothing beside the card.
  const modelRow = document.body.querySelector<HTMLButtonElement>(
    'button[data-model-control-index="0"]',
  );
  await act(async () => {
    modelRow?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  });
  expect(
    document.body.querySelector('input[placeholder="harness.modelPicker.searchModels"]'),
  ).toBeNull();

  await act(async () => modelRow?.click());
  expect(surfaces()).toBe(1);
  expect(
    document.body.querySelector('input[placeholder="harness.modelPicker.searchModels"]'),
  ).not.toBeNull();
  expect(document.body.querySelector("[data-effort-slider]")).toBeNull();

  const back = document.body.querySelector<HTMLButtonElement>(
    'button[aria-label="harness.modelPicker.back"]',
  );
  await act(async () => back?.click());
  expect(document.body.querySelector("[data-effort-slider]")).not.toBeNull();
});

it("drags the effort along the track", async () => {
  const onSettingsChange = vi.fn();
  await act(async () => {
    root.render(
      createElement(ModelPicker, {
        harness: "grok",
        model: "grok:grok-4.6",
        values: { effort: "low" },
        onChange: vi.fn(),
        onSettingsChange,
      }),
    );
  });
  const trigger = container.querySelector<HTMLButtonElement>(
    'button[aria-haspopup="menu"]',
  );
  await act(async () => trigger?.click());
  const track = document.body.querySelector<HTMLDivElement>(
    '[data-effort-slider] [role="radiogroup"]',
  );
  expect(track).not.toBeNull();
  if (!track) return;
  track.getBoundingClientRect = () =>
    ({ left: 0, width: 400, top: 0, height: 36, right: 400, bottom: 36 }) as DOMRect;
  const pointer = (type: string, clientX: number) =>
    new PointerEvent(type, { bubbles: true, button: 0, clientX, pointerId: 1 });
  await act(async () => {
    track.dispatchEvent(pointer("pointerdown", 10));
    track.dispatchEvent(pointer("pointermove", 150));
    track.dispatchEvent(pointer("pointermove", 390));
    track.dispatchEvent(pointer("pointerup", 390));
  });
  // Four stops over 400px: 150 is Medium, 390 is Extra High.
  expect(onSettingsChange).toHaveBeenCalledWith({ effort: "medium" });
  expect(onSettingsChange).toHaveBeenLastCalledWith({ effort: "xhigh" });
});
