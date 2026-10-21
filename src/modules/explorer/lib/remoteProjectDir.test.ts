import { describe, expect, it } from "vitest";
import { isRemoteProjectUri, toDirEntries } from "./remoteProjectDir";
import { parentPath } from "./path";

describe("remote project folders in the explorer", () => {
  it("recognizes only remote project paths", () => {
    expect(isRemoteProjectUri("remote://voktty-ssh-a/srv/app")).toBe(true);
    expect(isRemoteProjectUri("C:\\work\\app")).toBe(false);
    expect(isRemoteProjectUri("//server/share")).toBe(false);
  });

  it("maps the host listing and hides dotfiles unless asked", () => {
    const listing = [
      { name: ".git", isDir: true, ignored: true },
      { name: "src", isDir: true, ignored: false },
      { name: "a.ts", isDir: false, ignored: false },
    ];
    expect(toDirEntries(listing, false).map((entry) => entry.name)).toEqual([
      "src",
      "a.ts",
    ]);
    const all = toDirEntries(listing, true);
    expect(all[0]).toMatchObject({ name: ".git", kind: "dir", gitignored: true });
    expect(all[2]).toMatchObject({ name: "a.ts", kind: "file" });
  });

  it("never walks above the root of the remote machine", () => {
    expect(parentPath("remote://voktty-ssh-a/srv/app")).toBe(
      "remote://voktty-ssh-a/srv",
    );
    expect(parentPath("remote://voktty-ssh-a/srv")).toBe(
      "remote://voktty-ssh-a/",
    );
    expect(parentPath("remote://voktty-ssh-a/")).toBe("remote://voktty-ssh-a/");
    expect(parentPath("remote://voktty-ssh-a")).toBe("remote://voktty-ssh-a/");
  });
});
