import { describe, expect, it } from "vitest";
import { coerceCwd, firstCwd } from "./activeCwd";

describe("coerceCwd", () => {
  it("passes a usable path through unchanged", () => {
    expect(coerceCwd("C:/proyectos/voktty")).toBe("C:/proyectos/voktty");
    expect(coerceCwd("/home/user/repo")).toBe("/home/user/repo");
  });

  it("rejects the empty and whitespace-only cases", () => {
    expect(coerceCwd("")).toBeNull();
    expect(coerceCwd("   ")).toBeNull();
  });

  it("rejects absent values", () => {
    expect(coerceCwd(null)).toBeNull();
    expect(coerceCwd(undefined)).toBeNull();
  });

  it("rejects the non-string shapes that crashed consumers", () => {
    // What reached ProjectToolkitPopover as cwd.replace is not a function: a
    // value whose type was asserted at a boundary rather than checked.
    expect(coerceCwd({ path: "/repo" })).toBeNull();
    expect(coerceCwd(["/repo"])).toBeNull();
    expect(coerceCwd(42)).toBeNull();
    expect(coerceCwd(true)).toBeNull();
  });

  it("keeps surrounding whitespace on an otherwise usable path", () => {
    // Trim decides usability; it must not rewrite the path itself, because a
    // trailing space can be part of a real directory name.
    expect(coerceCwd(" /repo ")).toBe(" /repo ");
  });
});

describe("firstCwd", () => {
  it("returns the first usable candidate", () => {
    expect(firstCwd(null, undefined, "/repo", "/other")).toBe("/repo");
  });

  it("skips a poisoned candidate instead of returning it", () => {
    expect(firstCwd({ bad: true }, "/repo")).toBe("/repo");
  });

  it("returns null when nothing is usable", () => {
    expect(firstCwd(null, undefined, "", {}, 0)).toBeNull();
  });

  it("returns null with no candidates at all", () => {
    expect(firstCwd()).toBeNull();
  });
});
