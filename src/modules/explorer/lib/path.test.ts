import { describe, expect, it } from "vitest";
import { parentPath } from "./path";

describe("parentPath", () => {
  it.each([
    ["/home/serge/project", "/home/serge"],
    ["/home/serge", "/home"],
    ["/", "/"],
    ["//", "/"],
    ["C:/Users/serge/project", "C:/Users/serge"],
    ["C:/Users", "C:/"],
    ["C:/", "C:/"],
    ["C:\\Users\\serge\\project", "C:/Users/serge"],
    ["//server/share/project", "//server/share"],
    ["//server/share", "//server/share"],
  ])("returns the parent of %s", (path, expected) => {
    expect(parentPath(path)).toBe(expected);
  });
});
