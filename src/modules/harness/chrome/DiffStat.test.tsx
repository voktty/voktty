// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DiffStat } from "./DiffStat";

class TestResizeObserver {
  static current: TestResizeObserver | null = null;

  constructor(private readonly callback: ResizeObserverCallback) {
    TestResizeObserver.current = this;
  }

  observe = vi.fn();
  disconnect = vi.fn();

  notify() {
    this.callback([], this as unknown as ResizeObserver);
  }
}

let container: HTMLDivElement;
let root: Root;
let availableWidth: number;
let naturalWidth: number;

function rect(width: number): DOMRect {
  return {
    x: 0,
    y: 0,
    top: 0,
    right: width,
    bottom: 20,
    left: 0,
    width,
    height: 20,
    toJSON: () => undefined,
  };
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  TestResizeObserver.current = null;
  vi.stubGlobal("ResizeObserver", TestResizeObserver);
  availableWidth = 36;
  naturalWidth = 84;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("DiffStat", () => {
  it("fits long counts and grows them again after the sidebar widens", async () => {
    await act(async () => {
      root.render(
        createElement(DiffStat, {
          additions: 123456,
          deletions: 98765,
        }),
      );
    });

    const stat = container.querySelector("span[title]") as HTMLSpanElement;
    const content = stat.firstElementChild as HTMLSpanElement;
    stat.getBoundingClientRect = () => rect(availableWidth);
    content.getBoundingClientRect = () =>
      rect(naturalWidth * (Number.parseFloat(content.style.fontSize) / 11));
    expect(TestResizeObserver.current).not.toBeNull();

    await act(async () => {
      TestResizeObserver.current?.notify();
    });

    const fittedSize = Number.parseFloat(content.style.fontSize);
    expect(fittedSize).toBeLessThan(11);
    expect(content.getBoundingClientRect().width).toBeLessThanOrEqual(
      availableWidth,
    );

    availableWidth = 100;
    await act(async () => {
      TestResizeObserver.current?.notify();
    });

    expect(content.style.fontSize).toBe("11px");
  });

  it("does not render a stat when both counts are empty", async () => {
    await act(async () => {
      root.render(createElement(DiffStat, { additions: 0, deletions: 0 }));
    });

    expect(container.textContent).toBe("");
    expect(TestResizeObserver.current).toBeNull();
  });
});
