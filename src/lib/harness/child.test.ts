import { describe, expect, it } from "vitest";
import { isCurrentChildExit } from "./child";

describe("isCurrentChildExit", () => {
  it("ignores an exit before this session has a live pid", () => {
    expect(isCurrentChildExit(undefined, 41)).toBe(false);
  });

  it("ignores the previous child's exit after a handoff spawn", () => {
    expect(isCurrentChildExit(42, 41)).toBe(false);
  });

  it("accepts the live child's own exit", () => {
    expect(isCurrentChildExit(42, 42)).toBe(true);
  });
});
