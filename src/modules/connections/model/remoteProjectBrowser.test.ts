import { describe, expect, it } from "vitest";
import {
  normalizeRemoteDirectoryRelative,
  remoteDirectoryListing,
  remoteDirectoryPath,
} from "./remoteProjectBrowser";

describe("native remote project browser paths", () => {
  it("keeps browsing relative to the authenticated workspace root", () => {
    expect(remoteDirectoryPath("/home/dev/", "repo/src")).toBe(
      "/home/dev/repo/src",
    );
    expect(
      remoteDirectoryListing("/home/dev", "repo", [
        { name: "src", kind: "directory" },
        { name: "link", kind: "symlink" },
        { name: "notes.txt", kind: "file" },
      ]),
    ).toEqual({
      path: "/home/dev/repo",
      relativePath: "repo",
      parentRelativePath: null,
      entries: [
        {
          name: "src",
          path: "/home/dev/repo/src",
          relativePath: "repo/src",
        },
      ],
    });
  });

  it("rejects absolute and parent paths before sending them to the helper", () => {
    for (const path of ["/etc", "../outside", "repo/../../outside"]) {
      expect(() => normalizeRemoteDirectoryRelative(path)).toThrow(
        "must stay inside the opened folder",
      );
    }
    expect(() => remoteDirectoryPath("relative", "repo")).toThrow(
      "invalid workspace root",
    );
  });

  it("exposes only children that can safely be represented as remote paths", () => {
    const listing = remoteDirectoryListing("/srv", "repo", [
      { name: "src", kind: "directory" },
      { name: "..", kind: "directory" },
      { name: "nested/name", kind: "directory" },
      { name: "windows\\path", kind: "directory" },
    ]);
    expect(listing.parentRelativePath).toBeNull();
    expect(listing.entries.map((entry) => entry.name)).toEqual(["src"]);
    expect(
      remoteDirectoryListing("/srv", "repo/src", []).parentRelativePath,
    ).toBe("repo");
  });
});
