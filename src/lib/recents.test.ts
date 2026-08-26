import { describe, expect, it } from "vitest";
import {
  looksLikeProject,
  projectRailItems,
  projectRailSections,
  syncProjectRailOrder,
} from "./recents";

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

describe("projectRailSections", () => {
  it("keeps saved order and does not move the current project first", () => {
    const recents = [
      { path: "/tmp/older", openedAt: 1 },
      { path: "/tmp/current", openedAt: 2 },
    ];
    const { pinned, projects } = projectRailSections(
      recents,
      "/tmp/current/",
      ["/tmp/older", "/tmp/current"],
      [],
    );
    expect([...pinned, ...projects].map((item) => item.path)).toEqual([
      "/tmp/older",
      "/tmp/current",
    ]);
  });

  it("places pinned projects before unpinned ones", () => {
    const recents = [
      { path: "/tmp/a", openedAt: 1 },
      { path: "/tmp/b", openedAt: 2 },
      { path: "/tmp/c", openedAt: 3 },
    ];
    const { pinned, projects } = projectRailSections(
      recents,
      "/tmp/a",
      ["/tmp/a", "/tmp/b", "/tmp/c"],
      ["/tmp/b"],
    );
    expect(pinned.map((item) => item.path)).toEqual(["/tmp/b"]);
    expect(projects.map((item) => item.path)).toEqual(["/tmp/a", "/tmp/c"]);
  });

  it("appends new projects without reordering existing entries", () => {
    const recents = [
      { path: "/tmp/older", openedAt: 1 },
      { path: "/tmp/new", openedAt: 3 },
    ];
    const projects = new Map([
      ["/tmp/older", { path: "/tmp/older", openedAt: 1 }],
      ["/tmp/new", { path: "/tmp/new", openedAt: 3 }],
    ]);
    expect(syncProjectRailOrder(["/tmp/older"], projects)).toEqual([
      "/tmp/older",
      "/tmp/new",
    ]);
  });
});

describe("projectRailItems", () => {
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
