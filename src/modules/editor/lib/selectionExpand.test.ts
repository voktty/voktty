import { describe, expect, it } from "vitest";
import { getExpandedRange } from "./selectionExpand";

describe("selectionExpand", () => {
  it("expands single cursor to word", () => {
    const text = "const myVariable = 42;";
    const range = getExpandedRange(text, 8, 8); // inside "myVariable"
    expect(range).toEqual({ from: 6, to: 16 });
  });

  it("expands word to enclosing quotes", () => {
    const text = 'const msg = "hello world";';
    const range = getExpandedRange(text, 14, 18); // "hell"
    expect(range).toEqual({ from: 13, to: 24 }); // "hello world"
  });

  it("expands inside brackets to enclosing parentheses", () => {
    const text = "calculate(x + y, z);";
    const range = getExpandedRange(text, 10, 15); // "x + y"
    expect(range).toEqual({ from: 10, to: 18 }); // "x + y, z"
  });
});
