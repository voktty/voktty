import { describe, expect, it } from "vitest";
import { removableUnavailableProjects } from "./projectCleanup";

const set = (...items: string[]) => new Set(items);

describe("removableUnavailableProjects", () => {
  const paths = ["/a", "/b", "/c", "remote://voktty-ssh-p1/srv/app", "~"];

  it("keeps only unavailable local folders", () => {
    expect(removableUnavailableProjects(paths, set("/a", "/c"), set(), "/z")).toEqual(["/a", "/c"]);
  });

  it("never offers a remote project, even when it was flagged as unavailable", () => {
    expect(
      removableUnavailableProjects(paths, set("remote://voktty-ssh-p1/srv/app", "/a"), set(), "/z"),
    ).toEqual(["/a"]);
  });

  it("protects a project with a running agent and the one on screen", () => {
    expect(removableUnavailableProjects(paths, set("/a", "/b", "/c"), set("/b"), "/c")).toEqual(["/a"]);
  });

  it("lists a project once and ignores empty paths", () => {
    expect(removableUnavailableProjects(["/a", "/a", ""], set("/a"), set(), "/z")).toEqual(["/a"]);
    expect(removableUnavailableProjects([], set("/a"), set(), "/z")).toEqual([]);
  });
});