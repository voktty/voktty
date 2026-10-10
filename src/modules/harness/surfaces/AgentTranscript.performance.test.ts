// @vitest-environment happy-dom

import type { Block } from "@/modules/harness/lib/session";
import { AgentTranscript } from "@/modules/harness/surfaces/AgentTranscript";
import { groupTurnItems } from "@/modules/harness/surfaces/transcriptActivity";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock(
  "@/modules/harness/surfaces/transcriptActivity",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/modules/harness/surfaces/transcriptActivity")
      >();
    return { ...actual, groupTurnItems: vi.fn(actual.groupTurnItems) };
  },
);

let container: HTMLDivElement;
let root: Root;
let observers: { callback: () => void; target?: Element }[];

beforeEach(() => {
  vi.clearAllMocks();
  observers = [];
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      record: { callback: () => void; target?: Element };
      constructor(callback: () => void) {
        this.record = { callback };
        observers.push(this.record);
      }
      observe(target: Element) {
        this.record.target = target;
      }
      disconnect() {
        this.record.target = undefined;
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
});

it("measures skipped prompts only when visible and removes hidden observers", () => {
  let skipped = false;
  vi.spyOn(Element.prototype, "checkVisibility").mockImplementation(
    () => !skipped,
  );
  const blocks: Block[] = [{ id: "prompt", role: "user", text: "Long prompt" }];
  const render = (visible = true) =>
    act(() => root.render(createElement(AgentTranscript, { blocks, visible })));
  render();
  const pre = container.querySelector(".user-message-row pre") as HTMLElement;
  const height = vi.fn(() => 120);
  Object.defineProperty(pre, "scrollHeight", { get: height });
  Object.defineProperty(pre, "clientHeight", { get: () => 40 });
  const observer = observers.find((record) => record.target === pre);
  if (!observer) throw new Error("Prompt observer did not mount");
  skipped = true;
  act(() => observer.callback());
  expect(height).not.toHaveBeenCalled();
  skipped = false;
  const turn = pre.closest(".transcript-turn");
  if (!turn) throw new Error("Prompt turn did not mount");
  const event = new Event("contentvisibilityautostatechange");
  Object.defineProperty(event, "skipped", { value: false });
  act(() => turn.dispatchEvent(event));
  expect(height).toHaveBeenCalled();
  render(false);
  height.mockClear();
  act(() => turn.dispatchEvent(event));
  expect(observer.target).toBeUndefined();
  expect(height).not.toHaveBeenCalled();
});

it("only regroups the changed turn while preserving rendered history", () => {
  const blocks: Block[] = Array.from({ length: 20 }, (_, index): Block[] => [
    { id: `u${index}`, role: "user", text: `Question ${index}` },
    { id: `a${index}`, role: "assistant", text: `Answer ${index}` },
  ]).flat();
  const render = (next: Block[], visible = true) =>
    act(() =>
      root.render(createElement(AgentTranscript, { blocks: next, visible })),
    );
  render(blocks);
  expect(container.querySelectorAll(".transcript-turn")).toHaveLength(20);
  expect(groupTurnItems).toHaveBeenCalledTimes(20);
  render(blocks.slice());
  expect(groupTurnItems).toHaveBeenCalledTimes(20);

  const updated = blocks.slice();
  updated[updated.length - 1] = {
    ...updated[updated.length - 1],
    text: "Updated answer",
  };
  render(updated);
  expect(groupTurnItems).toHaveBeenCalledTimes(21);
  expect(container.textContent).toContain("Answer 0");
  expect(container.textContent).toContain("Updated answer");
  expect(container.textContent).not.toContain("Answer 19");
  render(updated, false);
  render(updated);
  expect(groupTurnItems).toHaveBeenCalledTimes(21);
  expect(container.textContent).toContain("Updated answer");
});
