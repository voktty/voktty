import { describe, expect, it } from "vitest";
import {
  absoluteToBrowseRelative,
  browseStartCandidates,
  lexicalAbsolutePath,
  normalizeRemoteDirectoryRelative,
  normalizeRemoteProjectPath,
  remoteDirectoryListing,
  remoteDirectoryPath,
  remoteProjectPathIssue,
} from "./remoteProjectBrowser";

describe("native remote project browser paths", () => {
  it("accepts and normalizes absolute project paths", () => {
    expect(normalizeRemoteProjectPath("  /srv/workspace/my app///  ")).toBe(
      "/srv/workspace/my app",
    );
    expect(normalizeRemoteProjectPath("/")).toBe("/");
    expect(remoteProjectPathIssue("/srv/workspace/app")).toBeUndefined();
  });

  it("rejects empty, relative, and control-character project paths", () => {
    expect(remoteProjectPathIssue("  ")).toBe("required");
    expect(remoteProjectPathIssue("workspace/app")).toBe("absolute");
    expect(remoteProjectPathIssue("/workspace/app\nother")).toBe("control");
  });

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
      parentRelativePath: "",
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
    expect(listing.parentRelativePath).toBe("");
    expect(remoteDirectoryListing("/srv", "", []).parentRelativePath).toBeNull();
    expect(listing.entries.map((entry) => entry.name)).toEqual(["src"]);
    expect(
      remoteDirectoryListing("/srv", "repo/src", []).parentRelativePath,
    ).toBe("repo");
  });
});

describe("browsing above a project root", () => {
  it("collapses dot segments without leaving the root", () => {
    expect(lexicalAbsolutePath("/srv//app/./src/../lib/")).toBe("/srv/app/lib");
    expect(lexicalAbsolutePath("/../../etc")).toBe("/etc");
    expect(lexicalAbsolutePath("/")).toBe("/");
    expect(absoluteToBrowseRelative("/srv/app")).toBe("srv/app");
    expect(absoluteToBrowseRelative("/")).toBe("");
  });

  it("tries the typed folder, its ancestors, the profile folder, the home and the root", () => {
    expect(
      browseStartCandidates({
        typed: "/srv/app/missing",
        initialDirectory: "/data/work",
        user: "dev",
      }),
    ).toEqual([
      "/srv/app/missing",
      "/srv/app",
      "/srv",
      "/data/work",
      "/data",
      "/home/dev",
      "/",
    ]);
  });

  it("falls back to the user's home and the root without a typed path", () => {
    expect(browseStartCandidates({ user: "root" })).toEqual(["/root", "/"]);
    expect(browseStartCandidates({ user: "bad user;rm" })).toEqual(["/"]);
    expect(browseStartCandidates({ typed: "relative/path" })).toEqual(["/"]);
  });
});