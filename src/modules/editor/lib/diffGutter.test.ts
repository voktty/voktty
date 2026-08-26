import { describe, expect, it } from "vitest";
import { computeLineChanges } from "./diffGutter";

describe("computeLineChanges", () => {
  it("returns empty map when original and current are identical", () => {
    const text = "const a = 1;\nconst b = 2;";
    const changes = computeLineChanges(text, text);
    expect(changes.size).toBe(0);
  });

  it("returns empty map when originalText is empty", () => {
    const changes = computeLineChanges("", "const a = 1;");
    expect(changes.size).toBe(0);
  });

  it("detects added lines when file expands", () => {
    const original = "line 1\nline 2";
    const current = "line 1\nline 1.5\nline 2\nline 3";
    const changes = computeLineChanges(original, current);

    expect(changes.get(2)).toBe("added");
    expect(changes.get(4)).toBe("added");
    expect(changes.has(1)).toBe(false);
    expect(changes.has(3)).toBe(false);
  });

  it("detects modified lines", () => {
    const original = "const x = 10;\nconst y = 20;";
    const current = "const x = 99;\nconst y = 20;";
    const changes = computeLineChanges(original, current);

    expect(changes.get(1)).toBe("modified");
    expect(changes.has(2)).toBe(false);
  });

  it("handles empty original text with populated current", () => {
    const changes = computeLineChanges("line1", "line1\nline2");
    expect(changes.get(2)).toBe("added");
  });
});
