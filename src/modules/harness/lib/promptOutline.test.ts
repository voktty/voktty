import { describe, expect, it } from "vitest";
import type { Block } from "./session";
import {
  activePromptId,
  barLift,
  barWindow,
  previewLines,
  promptBlocks,
  promptLabel,
  promptPreview,
} from "./promptOutline";

function userBlock(id: string, text: string): Block {
  return { id, role: "user", text };
}

function assistantBlock(id: string, text: string): Block {
  return { id, role: "assistant", text };
}

describe("promptOutline", () => {
  it("filters user blocks", () => {
    const blocks: Block[] = [
      userBlock("1", "hello"),
      assistantBlock("2", "world"),
      userBlock("3", "next"),
    ];
    expect(promptBlocks(blocks).map((b) => b.id)).toEqual(["1", "3"]);
  });

  it("calculates bar window sliding", () => {
    expect(barWindow(10, 2, 5)).toEqual({ start: 2, end: 7 });
    expect(barWindow(10, 8, 5)).toEqual({ start: 5, end: 10 });
    expect(barWindow(3, null, 5)).toEqual({ start: 0, end: 3 });
  });

  it("calculates activePromptId", () => {
    const anchors = [
      { id: "p1", top: 0, bottom: 100 },
      { id: "p2", top: 150, bottom: 250 },
      { id: "p3", top: 300, bottom: 400 },
    ];
    expect(activePromptId({ top: 50, bottom: 200 }, anchors)).toBe("p1");
    expect(activePromptId({ top: 120, bottom: 220 }, anchors)).toBe("p2");
    expect(activePromptId({ top: 500, bottom: 600 }, anchors, 5)).toBe("p3");
  });

  it("computes bar lift for dock magnification", () => {
    expect(barLift(2, 2)).toBe(1);
    expect(barLift(1, 2)).toBeCloseTo(0.666, 2);
    expect(barLift(0, 2)).toBeCloseTo(0.333, 2);
    expect(barLift(5, 2)).toBe(0);
  });

  it("extracts preview lines skipping markdown code blocks", () => {
    const text = "```ts\nconst a = 1;\n```\nHere is the actual answer.\nSecond line.";
    expect(previewLines(text, 2)).toEqual([
      "Here is the actual answer.",
      "Second line.",
    ]);
  });

  it("generates prompt label", () => {
    expect(promptLabel(userBlock("p1", "First prompt line\nSecond line"))).toBe("First prompt line");
  });

  it("creates prompt preview", () => {
    const blocks: Block[] = [
      userBlock("p1", "What is the capital of France?"),
      assistantBlock("a1", "Paris is the capital of France.\nIt is known for the Eiffel Tower."),
    ];
    const preview = promptPreview(blocks, "p1");
    expect(preview).toEqual({
      title: "What is the capital of France?",
      reply: "Paris is the capital of France.",
      detail: "It is known for the Eiffel Tower.",
    });
  });
});
