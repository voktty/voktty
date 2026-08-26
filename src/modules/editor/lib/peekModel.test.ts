import { describe, expect, it } from "vitest";
import { buildPeekExcerpt, movePeekIndex, samePeekPath } from "./peekModel";

describe("editor peek model", () => {
  it("builds a bounded excerpt and remaps the UTF-16 target", () => {
    const source = ["zero", "one", "const rocket = 1;", "three", "four"].join(
      "\r\n",
    );

    expect(buildPeekExcerpt(source, 2, 6, 1, 1)).toEqual({
      content: "one\nconst rocket = 1;\nthree",
      startLine: 2,
      targetLine: 1,
      targetColumn: 6,
      targetOffset: 10,
    });
  });

  it("rejects invalid positions and UTF-16 surrogate splits", () => {
    expect(buildPeekExcerpt("const icon = '🚀';", 0, 15)).toBeNull();
    expect(buildPeekExcerpt("one", 2, 0)).toBeNull();
  });

  it("drops oversized neighboring lines while preserving the target", () => {
    const oversized = "x".repeat(300_000);
    const result = buildPeekExcerpt(`${oversized}\ntarget\nafter`, 1, 2, 1, 1);

    expect(result?.content).toBe("target\nafter");
    expect(result?.startLine).toBe(2);
    expect(result?.targetOffset).toBe(2);
  });

  it("cycles through results without escaping the bounded list", () => {
    expect(movePeekIndex(2, 1, 3)).toBe(0);
    expect(movePeekIndex(0, -1, 3)).toBe(2);
    expect(movePeekIndex(4, 1, 0)).toBe(0);
  });

  it("compares Windows paths case-insensitively and Unix paths exactly", () => {
    expect(
      samePeekPath("C:\\Work\\voktty\\main.ts", "c:/work/voktty/main.ts"),
    ).toBe(true);
    expect(samePeekPath("/Work/main.ts", "/work/main.ts")).toBe(false);
  });
});
