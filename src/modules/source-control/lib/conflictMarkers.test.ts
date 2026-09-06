import { describe, expect, it } from "vitest";
import {
  applyConflictResolutions,
  hasConflictMarkers,
  parseConflictMarkers,
} from "./conflictMarkers";

describe("parseConflictMarkers", () => {
  it("parses a single standard conflict hunk", () => {
    const text = [
      "before",
      "<<<<<<< HEAD",
      "ours line 1",
      "ours line 2",
      "=======",
      "theirs line",
      ">>>>>>> feature",
      "after",
    ].join("\n");
    const parsed = parseConflictMarkers(text);
    expect(parsed.hunks).toHaveLength(1);
    const hunk = parsed.hunks[0];
    expect(hunk.oursLabel).toBe("HEAD");
    expect(hunk.theirsLabel).toBe("feature");
    expect(hunk.oursLines).toEqual(["ours line 1", "ours line 2"]);
    expect(hunk.theirsLines).toEqual(["theirs line"]);
    expect(hunk.baseLines).toBeNull();
    expect(hunk.startLine).toBe(1);
    expect(hunk.endLine).toBe(6);
  });

  it("parses diff3-style hunks with a base section", () => {
    const text = [
      "<<<<<<< HEAD",
      "ours",
      "||||||| merged common ancestors",
      "base",
      "=======",
      "theirs",
      ">>>>>>> feature",
    ].join("\n");
    const parsed = parseConflictMarkers(text);
    expect(parsed.hunks).toHaveLength(1);
    expect(parsed.hunks[0].baseLines).toEqual(["base"]);
  });

  it("parses multiple hunks in the same file", () => {
    const text = [
      "<<<<<<< HEAD",
      "a-ours",
      "=======",
      "a-theirs",
      ">>>>>>> feature",
      "middle",
      "<<<<<<< HEAD",
      "b-ours",
      "=======",
      "b-theirs",
      ">>>>>>> feature",
    ].join("\n");
    const parsed = parseConflictMarkers(text);
    expect(parsed.hunks).toHaveLength(2);
    expect(parsed.hunks[0].oursLines).toEqual(["a-ours"]);
    expect(parsed.hunks[1].oursLines).toEqual(["b-ours"]);
  });

  it("returns no hunks for a clean file", () => {
    const parsed = parseConflictMarkers("just\nsome\ntext\n");
    expect(parsed.hunks).toHaveLength(0);
    expect(hasConflictMarkers("just\nsome\ntext\n")).toBe(false);
  });

  it("ignores an unclosed conflict marker instead of consuming the rest of the file", () => {
    const text = ["<<<<<<< HEAD", "ours", "no closing markers here"].join(
      "\n",
    );
    const parsed = parseConflictMarkers(text);
    expect(parsed.hunks).toHaveLength(0);
  });

  it("detects a real conflict file", () => {
    const text = [
      "<<<<<<< HEAD",
      "ours",
      "=======",
      "theirs",
      ">>>>>>> feature",
    ].join("\n");
    expect(hasConflictMarkers(text)).toBe(true);
  });
});

describe("applyConflictResolutions", () => {
  const text = [
    "before",
    "<<<<<<< HEAD",
    "ours",
    "=======",
    "theirs",
    ">>>>>>> feature",
    "after",
  ].join("\n");

  it("defaults unresolved hunks to ours", () => {
    const parsed = parseConflictMarkers(text);
    const result = applyConflictResolutions(parsed, new Map());
    expect(result).toBe(["before", "ours", "after"].join("\n"));
  });

  it("applies theirs when chosen", () => {
    const parsed = parseConflictMarkers(text);
    const result = applyConflictResolutions(
      parsed,
      new Map([[0, "theirs"]]),
    );
    expect(result).toBe(["before", "theirs", "after"].join("\n"));
  });

  it("applies both when chosen, ours first then theirs", () => {
    const parsed = parseConflictMarkers(text);
    const result = applyConflictResolutions(parsed, new Map([[0, "both"]]));
    expect(result).toBe(["before", "ours", "theirs", "after"].join("\n"));
  });

  it("applies base for diff3-style hunks when chosen", () => {
    const diff3Text = [
      "<<<<<<< HEAD",
      "ours",
      "||||||| merged common ancestors",
      "base",
      "=======",
      "theirs",
      ">>>>>>> feature",
    ].join("\n");
    const parsed = parseConflictMarkers(diff3Text);
    const result = applyConflictResolutions(parsed, new Map([[0, "base"]]));
    expect(result).toBe("base");
  });

  it("falls back to ours when base is requested but unavailable", () => {
    const parsed = parseConflictMarkers(text);
    const result = applyConflictResolutions(parsed, new Map([[0, "base"]]));
    expect(result).toBe(["before", "ours", "after"].join("\n"));
  });

  it("resolves multiple hunks independently", () => {
    const twoHunks = [
      "<<<<<<< HEAD",
      "a-ours",
      "=======",
      "a-theirs",
      ">>>>>>> feature",
      "middle",
      "<<<<<<< HEAD",
      "b-ours",
      "=======",
      "b-theirs",
      ">>>>>>> feature",
    ].join("\n");
    const parsed = parseConflictMarkers(twoHunks);
    const result = applyConflictResolutions(
      parsed,
      new Map([
        [0, "theirs"],
        [1, "ours"],
      ]),
    );
    expect(result).toBe(
      ["a-theirs", "middle", "b-ours"].join("\n"),
    );
  });

  it("does not insert blank lines for an empty side of a hunk", () => {
    const emptyOurs = [
      "before",
      "<<<<<<< HEAD",
      "=======",
      "theirs",
      ">>>>>>> feature",
      "after",
    ].join("\n");
    const parsed = parseConflictMarkers(emptyOurs);
    const result = applyConflictResolutions(parsed, new Map());
    expect(result).toBe(["before", "after"].join("\n"));
  });
});
