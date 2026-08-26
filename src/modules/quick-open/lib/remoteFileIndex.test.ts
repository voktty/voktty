import type { RemoteDirEntry } from "@/modules/remote";
import { describe, expect, it, vi } from "vitest";
import { indexRemoteFiles } from "./remoteFileIndex";

const file = (name: string): RemoteDirEntry => ({
  name,
  kind: "file",
  size: 1,
  mtime: 1,
});

const directory = (name: string): RemoteDirEntry => ({
  name,
  kind: "dir",
  size: 0,
  mtime: 1,
});

describe("remote Quick Open index", () => {
  it("walks directories while pruning dependencies and hidden entries", async () => {
    const readDirectory = vi.fn(async (path: string) => {
      if (path === "/srv/app") {
        return [
          directory("src"),
          directory("node_modules"),
          file("README.md"),
          file(".env"),
        ];
      }
      if (path === "/srv/app/src") return [file("main.ts")];
      throw new Error(`unexpected path ${path}`);
    });

    await expect(indexRemoteFiles("/srv/app", readDirectory)).resolves.toEqual({
      files: ["README.md", "src/main.ts"],
      truncated: false,
    });
    expect(readDirectory).not.toHaveBeenCalledWith("/srv/app/node_modules");
  });

  it("includes hidden files when requested", async () => {
    const readDirectory = vi.fn(async () => [file(".env")]);
    const result = await indexRemoteFiles("/srv/app", readDirectory, {
      showHidden: true,
    });
    expect(result.files).toEqual([".env"]);
  });

  it("stops at the bounded result limit", async () => {
    const readDirectory = vi.fn(async () => [file("a.ts"), file("b.ts")]);
    await expect(
      indexRemoteFiles("/srv/app", readDirectory, { limit: 1 }),
    ).resolves.toEqual({ files: ["a.ts"], truncated: true });
  });

  it("propagates an inaccessible workspace root", async () => {
    const readDirectory = vi.fn(async () => {
      throw new Error("disconnected");
    });
    await expect(indexRemoteFiles("/srv/app", readDirectory)).rejects.toThrow(
      "disconnected",
    );
  });

  it("marks the index as partial when a nested directory is inaccessible", async () => {
    const readDirectory = vi.fn(async (path: string) => {
      if (path === "/srv/app") return [directory("src"), file("README.md")];
      throw new Error("permission denied");
    });

    await expect(indexRemoteFiles("/srv/app", readDirectory)).resolves.toEqual({
      files: ["README.md"],
      truncated: true,
    });
  });

  it("marks the index as partial when the depth limit omits a directory", async () => {
    const readDirectory = vi.fn(async (path: string) => {
      if (path === "/srv/app") return [directory("src")];
      if (path === "/srv/app/src") return [directory("generated")];
      return [file("output.ts")];
    });

    await expect(
      indexRemoteFiles("/srv/app", readDirectory, { maxDepth: 1 }),
    ).resolves.toEqual({ files: [], truncated: true });
    expect(readDirectory).not.toHaveBeenCalledWith("/srv/app/src/generated");
  });
});
