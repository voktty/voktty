import { describe, expect, it } from "vitest";
import { collectHarnessWindowInboxProjects } from "@/modules/harness/lib/harnessWindowInboxProjects";

describe("window Inbox project scope", () => {
  it("merges retained and persisted projects using existing exact path normalization", () => {
    const result = collectHarnessWindowInboxProjects(
      [
        { path: "C:\\work\\one\\", openedAt: 12 },
        { path: "/work/recent", openedAt: 9 },
      ],
      ["c:/work/one", "remote://machine/srv/project", "/work/live", "~", "/"],
    );
    expect(result.map((project) => project.path)).toEqual([
      "/work/live",
      "/work/recent",
      "c:/work/one",
      "remote://machine/srv/project",
    ]);
  });

  it("ignores recency and input order so presentation changes do not restart polling", () => {
    const one = collectHarnessWindowInboxProjects(
      [{ path: "/work/one", openedAt: 1 }],
      ["/work/two"],
    );
    const two = collectHarnessWindowInboxProjects(
      [{ path: "/work/one", openedAt: 999 }],
      ["/work/two", "/work/two"],
    );
    expect(two).toEqual(one);
  });

  it("bounds metadata and prioritizes live resources over persisted recents", () => {
    const recent = Array.from({ length: 600 }, (_, index) => ({
      path: `/work/recent-${index}`,
      openedAt: index,
    }));
    const result = collectHarnessWindowInboxProjects(recent, [
      "/work/retained",
    ]);
    expect(result).toHaveLength(500);
    expect(result.some((project) => project.path === "/work/retained")).toBe(
      true,
    );
    expect(recent).toHaveLength(600);
  });
});
