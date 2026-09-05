import { describe, expect, it } from "vitest";
import { displayName, group } from "./transferPaths";

describe("group", () => {
  it("takes the shared directory as the root", () => {
    expect(group(["/srv/app/a.txt", "/srv/app/b.txt"], false)).toEqual({
      root: "/srv/app",
      items: ["a.txt", "b.txt"],
    });
  });

  it("keeps nested names so the destination mirrors the source", () => {
    expect(group(["/srv/app/a.txt", "/srv/app/deep/b.txt"], false)).toEqual({
      root: "/srv/app",
      items: ["a.txt", "deep/b.txt"],
    });
  });

  it("climbs to the deepest common parent across directories", () => {
    expect(group(["/srv/one/a.txt", "/srv/two/b.txt"], false)).toEqual({
      root: "/srv",
      items: ["one/a.txt", "two/b.txt"],
    });
  });

  it("handles a single path", () => {
    expect(group(["/srv/app/a.txt"], false)).toEqual({
      root: "/srv/app",
      items: ["a.txt"],
    });
  });

  it("falls back to the root when nothing is shared", () => {
    expect(group(["/one/a.txt", "/two/b.txt"], false)).toEqual({
      root: "/",
      items: ["one/a.txt", "two/b.txt"],
    });
  });

  it("handles a file sitting directly at the root", () => {
    expect(group(["/a.txt"], false)).toEqual({ root: "/", items: ["a.txt"] });
  });

  it("returns nothing for an empty or blank selection", () => {
    expect(group([], false)).toBeUndefined();
    expect(group(["", "   "], false)).toBeUndefined();
  });

  it("ignores blank entries mixed into a real selection", () => {
    expect(group(["/srv/a.txt", ""], false)).toEqual({
      root: "/srv",
      items: ["a.txt"],
    });
  });

  it("accepts either separator for local paths", () => {
    expect(group(["C:\\tmp\\a.txt", "C:/tmp/b.txt"], true)).toEqual({
      root: "C:/tmp",
      items: ["a.txt", "b.txt"],
    });
  });

  it("does not treat a backslash as a separator in a remote path", () => {
    // A backslash is a legal character in a POSIX filename.
    expect(group(["/srv/we\\ird.txt"], false)).toEqual({
      root: "/srv",
      items: ["we\\ird.txt"],
    });
  });
});

describe("displayName", () => {
  it("returns the last segment", () => {
    expect(displayName("/srv/app/main.rs", false)).toBe("main.rs");
    expect(displayName("C:\\tmp\\notes.txt", true)).toBe("notes.txt");
  });

  it("ignores a trailing separator", () => {
    expect(displayName("/srv/app/", false)).toBe("app");
  });

  it("falls back to the whole path when there is no segment", () => {
    expect(displayName("/", false)).toBe("/");
  });
});
