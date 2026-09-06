import { describe, expect, it } from "vitest";
import { caretIsAtLineEnd, screenBelongsToTui } from "./rendererPool";

describe("caretIsAtLineEnd", () => {
  const prompt = "~/proyectos ❯ git comm";

  it("accepts a caret sitting past the last glyph", () => {
    expect(caretIsAtLineEnd(prompt.length, prompt)).toBe(true);
  });

  it("rejects a caret parked inside the line", () => {
    // Walking back over "comm" to fix a typo must retire the ghost, because
    // the query is only the text to its left and accepting would splice a
    // history entry into the middle of the command.
    expect(caretIsAtLineEnd(prompt.length - 4, prompt)).toBe(false);
    expect(caretIsAtLineEnd(0, prompt)).toBe(false);
  });

  it("treats a caret beyond the trimmed text as the end", () => {
    // Wide glyphs advance the column further than the JS string length, and
    // the safe direction there is to allow rather than to block.
    expect(caretIsAtLineEnd(prompt.length + 2, prompt)).toBe(true);
  });

  it("accepts an empty line", () => {
    expect(caretIsAtLineEnd(0, "")).toBe(true);
  });
});

describe("screenBelongsToTui", () => {
  it("never blocks on the normal buffer", () => {
    expect(screenBelongsToTui(false, null)).toBe(false);
    expect(screenBelongsToTui(false, false)).toBe(false);
  });

  it("allows a prompt on the alternate buffer", () => {
    // A default SSH pane runs under `tmux new-session -A`, which holds the
    // whole session on the alternate buffer. The OSC 133 marker is what
    // separates that from a real full-screen program.
    expect(screenBelongsToTui(true, true)).toBe(false);
  });

  it("blocks a running command on the alternate buffer", () => {
    expect(screenBelongsToTui(true, false)).toBe(true);
  });

  it("falls back to the buffer heuristic without shell integration", () => {
    expect(screenBelongsToTui(true, null)).toBe(true);
  });
});
