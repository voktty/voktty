import { describe, expect, it } from "vitest";
import { looksLikeProject, projectRailItems } from "./recents";

describe("looksLikeProject", () => {
  it("rejects the home directory so it is never indexed", () => {
    // Home arrives expanded from `default_cwd`. Walking it reaches
    // ~/Library, which makes macOS prompt for access to other apps' data.
    expect(looksLikeProject("/Users/me")).toBe(false);
    expect(looksLikeProject("/Users/me/")).toBe(false);
    expect(looksLikeProject("/home/me")).toBe(false);
    expect(looksLikeProject("~")).toBe(false);
  });

  it("rejects system roots and app bundles", () => {
    expect(looksLikeProject("/")).toBe(false);
    expect(looksLikeProject("")).toBe(false);
    expect(looksLikeProject("/Applications/Some.app/Contents")).toBe(false);
  });

  it("accepts real projects, including ones directly under home", () => {
    expect(looksLikeProject("/Users/me/code/app")).toBe(true);
    expect(looksLikeProject("/Users/me/Desktop")).toBe(true);
    expect(looksLikeProject("/tmp/scratch")).toBe(true);
  });
});

describe("projectRailItems", () => {
  it("pins the current project first and drops duplicates", () => {
    expect(
      projectRailItems(
        [
          { path: "/tmp/older", openedAt: 1 },
          { path: "/tmp/current", openedAt: 2 },
        ],
        "/tmp/current/",
      ).map((item) => item.path),
    ).toEqual(["/tmp/current", "/tmp/older"]);
  });

  it("ignores home as a current folder", () => {
    expect(
      projectRailItems([{ path: "/tmp/app", openedAt: 1 }], "/Users/me").map(
        (item) => item.path,
      ),
    ).toEqual(["/tmp/app"]);
  });
});


describe("looksLikeProject", () => {
  it("rejects the home directory so it is never indexed", () => {
    // Home arrives expanded from `default_cwd`. Walking it reaches
    // ~/Library, which makes macOS prompt for access to other apps' data.
    expect(looksLikeProject("/Users/me")).toBe(false);
    expect(looksLikeProject("/Users/me/")).toBe(false);
    expect(looksLikeProject("/home/me")).toBe(false);
    expect(looksLikeProject("~")).toBe(false);
  });

  it("rejects system roots and app bundles", () => {
    expect(looksLikeProject("/")).toBe(false);
    expect(looksLikeProject("")).toBe(false);
    expect(looksLikeProject("/Applications/Some.app/Contents")).toBe(false);
  });

  it("accepts real projects, including ones directly under home", () => {
    expect(looksLikeProject("/Users/me/code/app")).toBe(true);
    expect(looksLikeProject("/Users/me/Desktop")).toBe(true);
    expect(looksLikeProject("/tmp/scratch")).toBe(true);
  });
});
