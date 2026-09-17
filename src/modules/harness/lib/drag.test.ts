import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  emitExplorerFilePointerDrag,
  EXPLORER_FILE_POINTER_DRAG_EVENT,
  type ExplorerFilePointerDragDetail,
} from "./drag";

class MockCustomEvent<T = any> extends Event {
  detail: T;
  constructor(type: string, init?: { detail?: T }) {
    super(type);
    this.detail = init?.detail as T;
  }
}

describe("drag events", () => {
  const target = new EventTarget();

  beforeEach(() => {
    vi.stubGlobal("window", target);
    vi.stubGlobal("CustomEvent", MockCustomEvent);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("emits EXPLORER_FILE_POINTER_DRAG_EVENT with provided detail", () => {
    const received: ExplorerFilePointerDragDetail[] = [];
    const listener = (event: Event) => {
      received.push((event as MockCustomEvent<ExplorerFilePointerDragDetail>).detail);
    };
    target.addEventListener(EXPLORER_FILE_POINTER_DRAG_EVENT, listener);

    emitExplorerFilePointerDrag({
      type: "move",
      path: "/repo/file.ts",
      x: 100,
      y: 200,
    });
    emitExplorerFilePointerDrag({
      type: "drop",
      path: "/repo/file.ts",
      x: 150,
      y: 250,
    });
    emitExplorerFilePointerDrag({
      type: "end",
      path: "/repo/file.ts",
    });

    expect(received).toEqual([
      { type: "move", path: "/repo/file.ts", x: 100, y: 200 },
      { type: "drop", path: "/repo/file.ts", x: 150, y: 250 },
      { type: "end", path: "/repo/file.ts" },
    ]);

    target.removeEventListener(EXPLORER_FILE_POINTER_DRAG_EVENT, listener);
  });
});
