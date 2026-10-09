// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Block } from "@/modules/harness/lib/session";
import {
  loadTranscriptZen,
  saveTranscriptZen,
} from "@/modules/harness/lib/appearance";
import { AgentTranscript } from "@/modules/harness/surfaces/AgentTranscript";

let container: HTMLDivElement;
let root: Root;
let observers: Array<{
  targets: Element[];
  resize: (entries?: unknown[]) => void;
}>;

beforeEach(() => {
  observers = [];
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      targets: Element[] = [];
      constructor(readonly resize: (entries?: unknown[]) => void) {
        observers.push(this);
      }
      observe(target: Element) {
        this.targets.push(target);
      }
      disconnect() {
        this.targets = [];
      }
    },
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("transcript scrolling", () => {
  it("holds the reader's place when a turn above the view lays out", () => {
    const blocks: Block[] = Array.from({ length: 3 }, (_, index) => [
      { id: `user-${index}`, role: "user" as const, text: `Question ${index}` },
      { id: `reply-${index}`, role: "assistant" as const, text: "Answer" },
    ]).flat();
    act(() => root.render(createElement(AgentTranscript, { blocks })));
    const scroller =
      container.querySelector<HTMLDivElement>(".agent-transcript")!;
    let height = 3000;
    let top = 0;
    Object.defineProperties(scroller, {
      scrollHeight: { get: () => height },
      clientHeight: { get: () => 400 },
      scrollTop: {
        get: () => top,
        set: (value: number) => {
          top = Math.max(0, Math.min(value, height - 400));
        },
      },
    });
    act(() => {
      scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: -100 }));
      top = 1000;
      scroller.dispatchEvent(new Event("scroll"));
    });
    const [above, reading] = scroller.querySelectorAll(".transcript-turn");
    const observer = observers.find((item) => item.targets.includes(above))!;
    expect(observer).toBeDefined();
    above.getBoundingClientRect = () => ({ top: -800 }) as DOMRect;
    let readingTop = -100;
    reading.getBoundingClientRect = () => ({ top: readingTop }) as DOMRect;
    const size = (target: Element, blockSize: number) => ({
      target,
      borderBoxSize: [{ blockSize }],
      contentRect: { height: blockSize },
    });
    // Off-screen turns report their placeholder size first.
    act(() => observer.resize([size(above, 240), size(reading, 240)]));
    expect(top).toBe(1000);

    // Scrolling up lays them out. Only the turn wholly above the view moves
    // the reader; the one on screen grows below where they are reading.
    height = 4420;
    readingTop += 900 - 240;
    act(() => observer.resize([size(above, 900), size(reading, 1000)]));
    expect(top).toBe(1660);
  });

  it.each(["paused", "following", "detached"])(
    "reconciles an out-of-order resize batch while %s",
    (mode) => {
      const blocks: Block[] = Array.from({ length: 3 }, (_, index) => [
        {
          id: `user-${index}`,
          role: "user" as const,
          text: `Question ${index}`,
        },
        { id: `reply-${index}`, role: "assistant" as const, text: "Answer" },
      ]).flat();
      act(() => root.render(createElement(AgentTranscript, { blocks })));
      const scroller =
        container.querySelector<HTMLDivElement>(".agent-transcript")!;
      let top = 1000;
      Object.defineProperties(scroller, {
        scrollHeight: { get: () => 4000 },
        clientHeight: { get: () => 400 },
        scrollTop: {
          get: () => top,
          set: (value: number) => {
            top = value;
          },
        },
      });
      if (mode !== "following")
        act(() => {
          scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: -100 }));
          scroller.dispatchEvent(new Event("scroll"));
        });
      const [first, second] = scroller.querySelectorAll(".transcript-turn");
      const observer = observers.find((item) => item.targets.includes(first))!;
      const size = (target: Element, blockSize: number) => ({
        target,
        borderBoxSize: [{ blockSize }],
        contentRect: { height: blockSize },
      });
      act(() => observer.resize([size(first, 240), size(second, 240)]));
      first.getBoundingClientRect = () => ({ top: -1000 }) as DOMRect;
      // Before layout this turn ended at -510. Growing the first turn by
      // 660 pushes its new top to -90, though it was wholly above the view.
      second.getBoundingClientRect = () => ({ top: -90 }) as DOMRect;
      // ResizeObserver entries need not be in DOM order.
      if (mode === "detached") container.remove();
      act(() => observer.resize([size(second, 500), size(first, 900)]));
      expect(top).toBe(mode === "paused" ? 1920 : 1000);
    },
  );
  it("preserves manual scroll intent inside a live activity phase", () => {
    const previousZen = loadTranscriptZen();
    saveTranscriptZen(true);
    try {
      const blocks: Block[] = [
        { id: "user", role: "user", text: "Explain auth" },
        { id: "intro", role: "assistant", text: "Checking authentication" },
        {
          id: "tool",
          role: "tool",
          text: "Inspect files",
          tool: { kind: "shell", status: "in_progress" },
        },
        {
          id: "tool-2",
          role: "tool",
          text: "Inspect config",
          tool: { kind: "shell", status: "in_progress" },
        },
      ];
      act(() =>
        root.render(createElement(AgentTranscript, { blocks, busy: true })),
      );
      const scroller =
        container.querySelector<HTMLDivElement>(".zen-phase-live");
      expect(scroller).not.toBeNull();
      const geometry = { height: 600, top: 0 };
      Object.defineProperties(scroller!, {
        scrollHeight: { get: () => geometry.height },
        clientHeight: { get: () => 280 },
        scrollTop: {
          get: () => geometry.top,
          set: (value: number) => {
            geometry.top = Math.max(0, Math.min(value, geometry.height - 280));
          },
        },
      });
      const observer = observers.find((item) =>
        item.targets.includes(scroller!.firstElementChild!),
      )!;
      act(() => observer.resize());
      expect(geometry.top).toBe(320);
      act(() => {
        scroller!.dispatchEvent(new WheelEvent("wheel", { deltaY: -4 }));
        scroller!.dispatchEvent(new Event("scroll"));
      });
      geometry.height = 640;
      act(() => observer.resize());
      expect(geometry.top).toBe(320);
      act(() => {
        geometry.top = 360;
        scroller!.dispatchEvent(new Event("scroll"));
      });
      geometry.height = 680;
      act(() => observer.resize());
      expect(geometry.top).toBe(400);
      // Resize can precede the browser's scroll event after a scrollbar move.
      geometry.top = 396;
      geometry.height = 720;
      act(() => observer.resize());
      expect(geometry.top).toBe(396);
    } finally {
      act(() => saveTranscriptZen(previousZen));
    }
  });
  it("holds a directionless wheel gesture until its release timer", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const { scroller, geometry, observer } = mountScroller();
    act(() => scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: 0 })));
    geometry.height = 1100;
    act(() => observer.resize());
    expect(geometry.top).toBe(600);
    act(() => vi.advanceTimersByTime(150));
    expect(geometry.top).toBe(700);
  });

  it("keeps the reader unpinned when a directionless gesture turns upward", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const { scroller, geometry, observer } = mountScroller();
    act(() => scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: 0 })));
    act(() => scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: -4 })));
    geometry.height = 1100;
    geometry.top = 596;
    act(() => observer.resize());
    act(() => vi.advanceTimersByTime(150));
    expect(geometry.top).toBe(596);
  });
  function mountScroller() {
    const blocks: Block[] = [
      { id: "user", role: "user", text: "Explain auth" },
      { id: "reply", role: "assistant", text: "One", streaming: true },
    ];
    act(() =>
      root.render(createElement(AgentTranscript, { blocks, busy: true })),
    );
    const scroller =
      container.querySelector<HTMLDivElement>(".agent-transcript")!;
    const geometry = { height: 1000, viewport: 400, top: 0 };
    Object.defineProperties(scroller, {
      scrollHeight: { get: () => geometry.height },
      clientHeight: { get: () => geometry.viewport },
      scrollTop: {
        get: () => geometry.top,
        set: (value: number) => {
          geometry.top = Math.max(
            0,
            Math.min(value, geometry.height - geometry.viewport),
          );
        },
      },
    });
    const observer = observers.find((item) => item.targets.includes(scroller))!;
    act(() => observer.resize());
    expect(geometry.top).toBe(600);
    return { scroller, geometry, observer, blocks };
  }

  it("keeps following when a queued scroll event lands after content grows", () => {
    const { scroller, geometry, observer } = mountScroller();
    // scrollTop was written by the previous pin, but its event can arrive
    // after Markdown has already grown the transcript again.
    geometry.height = 1100;
    act(() => scroller.dispatchEvent(new Event("scroll")));
    act(() => observer.resize());
    expect(geometry.top).toBe(700);
  });

  it("pauses following for a scrollbar move inside the bottom margin", () => {
    const { scroller, geometry, observer } = mountScroller();
    geometry.top = 596;
    act(() => scroller.dispatchEvent(new Event("scroll")));
    geometry.height = 1100;
    act(() => observer.resize());
    expect(geometry.top).toBe(596);
  });

  it.each(["resize", "stream update"])(
    "respects an upward move before its scroll event arrives during a %s",
    (change) => {
      const { scroller, geometry, observer, blocks } = mountScroller();
      // The browser moves first; a streaming commit or resize can run before
      // its asynchronous scroll event is dispatched.
      geometry.top = 560;
      geometry.height = 1100;
      act(() => {
        if (change === "resize") observer.resize();
        else
          root.render(
            createElement(AgentTranscript, {
              blocks: [blocks[0], { ...blocks[1], text: "One\n\nTwo" }],
              busy: true,
            }),
          );
      });
      expect(geometry.top).toBe(560);

      act(() => scroller.dispatchEvent(new Event("scroll")));
      geometry.height = 1200;
      act(() => observer.resize());
      expect(geometry.top).toBe(560);
    },
  );

  it("waits for the bottom before resuming after small downward movement", () => {
    const { scroller, geometry, observer } = mountScroller();
    act(() => {
      scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: -4 }));
      geometry.top = 596;
      scroller.dispatchEvent(new Event("scroll"));
      // A slight reversal inside the follow margin still leaves the reader
      // above the end. The next token must not pull them back down.
      geometry.top = 598;
      scroller.dispatchEvent(new Event("scroll"));
    });
    geometry.height = 1100;
    act(() => observer.resize());
    expect(geometry.top).toBe(598);

    act(() => {
      geometry.top = 700;
      scroller.dispatchEvent(new Event("scroll"));
    });
    geometry.height = 1200;
    act(() => observer.resize());
    expect(geometry.top).toBe(800);
  });

  it.each(["viewport grows", "content shrinks"])(
    "keeps following when the browser clamps to the bottom as %s",
    (change) => {
      const { scroller, geometry, observer } = mountScroller();
      if (change === "viewport grows") geometry.viewport = 440;
      else geometry.height = 960;
      // The browser adjusts the offset before ResizeObserver runs.
      geometry.top = 560;
      act(() => scroller.dispatchEvent(new Event("scroll")));
      act(() => observer.resize());
      geometry.viewport = 400;
      geometry.height = 1000;
      act(() => observer.resize());
      expect(geometry.top).toBe(600);
    },
  );

  it("keeps following paused when a resize clamps a reader to the bottom", () => {
    const { scroller, geometry, observer } = mountScroller();
    act(() => {
      scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: -4 }));
      geometry.top = 596;
      scroller.dispatchEvent(new Event("scroll"));
    });
    geometry.viewport = 440;
    geometry.top = 560;
    act(() => scroller.dispatchEvent(new Event("scroll")));
    act(() => observer.resize());
    geometry.viewport = 400;
    act(() => observer.resize());
    expect(geometry.top).toBe(560);
  });

  it("does not resume following when a paused wheel's queued pin event arrives", () => {
    const { scroller, geometry, observer } = mountScroller();
    act(() => {
      scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: -4 }));
      // The browser has not applied the wheel yet. This event belongs to
      // the earlier programmatic pin and still reports the bottom.
      scroller.dispatchEvent(new Event("scroll"));
    });
    geometry.height = 1100;
    act(() => observer.resize());
    expect(geometry.top).toBe(600);
  });

  it("keeps following when a wheel gesture is consumed by a code scroller", () => {
    const { scroller, geometry, observer } = mountScroller();
    const code = document.createElement("pre");
    code.style.overflowY = "auto";
    Object.defineProperties(code, {
      scrollHeight: { value: 900 },
      clientHeight: { value: 200 },
      scrollTop: { value: 400, writable: true },
    });
    scroller.append(code);
    act(() =>
      code.dispatchEvent(
        new WheelEvent("wheel", { deltaY: -100, bubbles: true }),
      ),
    );
    geometry.height = 1100;
    act(() => observer.resize());
    expect(geometry.top).toBe(700);

    // At the code's top the gesture reaches the transcript instead.
    code.scrollTop = 0;
    act(() =>
      code.dispatchEvent(
        new WheelEvent("wheel", { deltaY: -100, bubbles: true }),
      ),
    );
    geometry.height = 1200;
    act(() => observer.resize());
    expect(geometry.top).toBe(700);
  });

  it("lets a wheel up inside the bottom margin leave a streaming reply", () => {
    const blocks = (text: string): Block[] => [
      { id: "user", role: "user", text: "Explain auth" },
      { id: "reply", role: "assistant", text },
    ];
    act(() =>
      root.render(
        createElement(AgentTranscript, { blocks: blocks("One"), busy: true }),
      ),
    );
    const scroller =
      container.querySelector<HTMLDivElement>(".agent-transcript")!;
    let height = 1000;
    let top = 0;
    Object.defineProperties(scroller, {
      scrollHeight: { get: () => height },
      clientHeight: { get: () => 400 },
      scrollTop: {
        get: () => top,
        set: (value: number) => {
          top = Math.max(0, Math.min(value, height - 400));
        },
      },
    });
    const observer = observers.find((item) => item.targets.includes(scroller))!;
    act(() => observer.resize());
    expect(top).toBe(600);

    // A trackpad's first ticks move only a few pixels.
    act(() => {
      scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: -4 }));
      top = 596;
      scroller.dispatchEvent(new Event("scroll"));
    });
    height = 1040;
    act(() =>
      root.render(
        createElement(AgentTranscript, {
          blocks: blocks("One\n\nTwo"),
          busy: true,
        }),
      ),
    );
    act(() => observer.resize());
    expect(top).toBe(596);

    // Scrolling back down to the end follows the stream again.
    act(() => {
      top = 640;
      scroller.dispatchEvent(new Event("scroll"));
    });
    height = 1080;
    act(() => observer.resize());
    expect(top).toBe(680);
  });
});
