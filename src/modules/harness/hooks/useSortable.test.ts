// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSortable } from "@/modules/harness/hooks/useSortable";

let cleanup: (() => void) | undefined;
beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function setup(pointerType = "mouse") {
  const onReorder = vi.fn();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  function Harness() {
    const sortable = useSortable(["a", "b"], onReorder);
    return createElement(
      "div",
      null,
      ...["a", "b"].map((id) =>
        createElement(
          "button",
          {
            key: id,
            type: "button",
            ref: (el: HTMLButtonElement | null) => sortable.setItemRef(id, el),
            "data-dragging": sortable.draggingId === id ? "true" : undefined,
            onPointerDown: (event: React.PointerEvent) =>
              sortable.onItemPointerDown(id, event),
          },
          id,
        ),
      ),
    );
  }
  act(() => root.render(createElement(Harness)));
  const tabs = [...container.querySelectorAll("button")];
  const capture = vi.fn();
  const release = vi.fn();
  for (const [index, tab] of tabs.entries()) {
    tab.setPointerCapture = capture;
    tab.releasePointerCapture = release;
    vi.spyOn(tab, "getBoundingClientRect").mockReturnValue(
      new DOMRect(index * 100, 0, 100, 40),
    );
  }
  function pointer(type: string, x: number, buttons = 1, pointerId = 1) {
    const target = type === "pointerdown" ? tabs[0] : window;
    act(() =>
      target.dispatchEvent(
        new PointerEvent(type, {
          pointerId,
          pointerType,
          buttons,
          button: 0,
          clientX: x,
          clientY: 20,
          bubbles: true,
        }),
      ),
    );
  }
  cleanup = () => {
    act(() =>
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })),
    );
    act(() => root.unmount());
    container.remove();
  };
  pointer("pointerdown", 20);
  return { tabs, onReorder, pointer, release };
}

describe("sortable pointer lifetime", () => {
  it.each([false, true])(
    "cancels a missed mouse release (active: %s)",
    (active) => {
      const { tabs, pointer, onReorder, release } = setup();
      if (active) {
        pointer("pointermove", 180);
        expect(tabs[0].dataset.dragging).toBe("true");
      }
      pointer("pointermove", 190, 0);
      expect(tabs[0].dataset.dragging).toBeUndefined();
      expect(document.body.style.cursor).toBe("");
      expect(document.documentElement.classList.contains("is-reordering")).toBe(
        false,
      );
      expect(release).toHaveBeenCalledWith(1);
      pointer("pointermove", 200);
      pointer("pointerup", 200, 0);
      expect(onReorder).not.toHaveBeenCalled();
    },
  );

  it("keeps touch drags active even when buttons is zero", () => {
    const { tabs, pointer, onReorder } = setup("touch");
    pointer("pointermove", 180, 0);
    expect(tabs[0].dataset.dragging).toBe("true");
    pointer("pointerup", 180, 0);
    expect(onReorder).toHaveBeenCalledWith(["b", "a"], "a");
  });

  it("ignores movement from a different pointer", () => {
    const { tabs, pointer, onReorder } = setup();
    pointer("pointermove", 180);
    pointer("pointermove", 20, 0, 2);
    expect(tabs[0].dataset.dragging).toBe("true");
    pointer("pointerup", 180, 0);
    expect(onReorder).toHaveBeenCalledWith(["b", "a"], "a");
  });

  it("commits a normal mouse release", () => {
    const { tabs, pointer, onReorder } = setup();
    pointer("pointermove", 180);
    pointer("pointerup", 180, 0);
    expect(tabs[0].dataset.dragging).toBeUndefined();
    expect(onReorder).toHaveBeenCalledWith(["b", "a"], "a");
  });
});
