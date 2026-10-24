// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useEditorGroupPlacements } from "@/modules/editor/lib/useEditorGroupPlacements";
import type { EditorGroupNode } from "@/modules/editor/lib/editorGroupLayout";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function setup(initial: EditorGroupNode) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const observers: TestObserver[] = [];
  class TestObserver {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
    constructor(private callback: ResizeObserverCallback) {
      observers.push(this);
    }
    notify() {
      this.callback([], this);
    }
  }
  vi.stubGlobal("ResizeObserver", TestObserver);
  const frames = new Map<number, FrameRequestCallback>();
  let id = 0;
  const request = vi.fn((callback: FrameRequestCallback) => {
    frames.set(++id, callback);
    return id;
  });
  vi.stubGlobal("requestAnimationFrame", request);
  const cancel = vi.fn((value: number) => frames.delete(value));
  vi.stubGlobal("cancelAnimationFrame", cancel);
  let width = 1000;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const group = this.dataset.group;
      return group
        ? new DOMRect(group === "1" ? 100 : 100 + width / 2, 50, width / 2, 500)
        : new DOMRect(100, 50, width, 500);
    },
  );
  const root = createRoot(document.createElement("div"));
  let tree = initial;
  let enabled = true;
  let snapshot!: ReturnType<typeof useEditorGroupPlacements>;
  function Host() {
    snapshot = useEditorGroupPlacements(tree, enabled);
    return (
      <div ref={snapshot.rootRef}>
        {[1, 2, 3].map((groupId) => (
          <div
            key={groupId}
            data-group={groupId}
            ref={(node) => {
              if (node) snapshot.groupRefs.current.set(groupId, node);
              else snapshot.groupRefs.current.delete(groupId);
            }}
          />
        ))}
      </div>
    );
  }
  const render = () => act(async () => root.render(<Host />));
  await render();
  return {
    observers,
    request,
    cancel,
    frames,
    render,
    snapshot: () => snapshot,
    width: (value: number) => {
      width = value;
    },
    tree: (value: EditorGroupNode) => {
      tree = value;
    },
    enabled: (value: boolean) => {
      enabled = value;
    },
    flush: () =>
      act(async () => {
        for (const [key, callback] of frames) {
          frames.delete(key);
          callback(0);
        }
      }),
    close: () => act(async () => root.unmount()),
  };
}
const split: EditorGroupNode = {
  kind: "split",
  direction: "row",
  children: [
    { kind: "leaf", groupId: 1, tabId: 1 },
    { kind: "leaf", groupId: 2, tabId: null },
  ],
};

it("measures only the owning layer and current slots, coalescing resize notifications", async () => {
  const fixture = await setup(split);
  try {
    expect(fixture.observers).toHaveLength(1);
    expect(fixture.observers[0].observe).toHaveBeenCalledTimes(3);
    expect(fixture.snapshot().rects.get(2)).toEqual({
      x: 0.5,
      y: 0,
      width: 0.5,
      height: 1,
    });
    const before = fixture.snapshot().rects;
    fixture.width(800);
    fixture.observers[0].notify();
    fixture.observers[0].notify();
    expect(fixture.request).toHaveBeenCalledOnce();
    await fixture.flush();
    expect(fixture.snapshot().rects).toBe(before);
  } finally {
    await fixture.close();
  }
});

it("retires stale observer frames on topology changes and disabled geometry", async () => {
  const fixture = await setup(split);
  try {
    const old = fixture.observers[0];
    old.notify();
    const staleFrame = [...fixture.frames.values()][0];
    fixture.tree({
      ...split,
      children: [split.children[0], { kind: "leaf", groupId: 3, tabId: 3 }],
    });
    await fixture.render();
    expect(old.disconnect).toHaveBeenCalledOnce();
    expect(fixture.cancel).toHaveBeenCalledOnce();
    expect(fixture.snapshot().rects.has(2)).toBe(false);
    expect(fixture.snapshot().rects.has(3)).toBe(true);
    const before = fixture.snapshot().rects;
    await act(async () => {
      staleFrame(0);
      old.notify();
    });
    expect(fixture.snapshot().rects).toBe(before);
    fixture.enabled(false);
    await fixture.render();
    expect(fixture.snapshot().rects.size).toBe(0);
    expect(fixture.observers[1].disconnect).toHaveBeenCalledOnce();
  } finally {
    await fixture.close();
  }
});

it("uses no observers or frames for one standalone group", async () => {
  const fixture = await setup({ kind: "leaf", groupId: 1, tabId: 1 });
  try {
    expect(fixture.observers).toHaveLength(0);
    expect(fixture.frames.size).toBe(0);
    expect(fixture.snapshot().rects.get(1)).toEqual({
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    });
  } finally {
    await fixture.close();
  }
});

it("cancels pending frames and ignores late resize delivery after unmount", async () => {
  const fixture = await setup(split);
  const observer = fixture.observers[0];
  observer.notify();
  const staleFrame = [...fixture.frames.values()][0];
  await fixture.close();
  expect(observer.disconnect).toHaveBeenCalledOnce();
  expect(fixture.frames.size).toBe(0);
  const count = fixture.request.mock.calls.length;
  await act(async () => {
    observer.notify();
    staleFrame(0);
  });
  expect(fixture.request).toHaveBeenCalledTimes(count);
});
