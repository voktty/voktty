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

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
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
