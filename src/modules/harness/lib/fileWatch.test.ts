import { afterEach, describe, expect, it, vi } from "vitest";

const statFiles = vi.hoisted(() => vi.fn());

vi.mock("./fs", () => ({ statFiles }));

import {
  invalidateWatchedFiles,
  nudgeWatchedFiles,
  watchFile,
} from "./fileWatch";

describe("file watch", () => {
  const stops: Array<() => void> = [];

  afterEach(() => {
    while (stops.length > 0) stops.pop()?.();
    statFiles.mockReset();
  });

  it("reconciles the file after establishing its initial mtime baseline", async () => {
    statFiles.mockResolvedValue([{ path: "/repo/README.md", mtimeMs: 2 }]);
    const changed = vi.fn();

    stops.push(watchFile("/repo/README.md", changed));

    await vi.waitFor(() => expect(changed).toHaveBeenCalledOnce());
  });

  it("does not notify again while the sampled mtime is unchanged", async () => {
    statFiles.mockResolvedValue([{ path: "/repo/README.md", mtimeMs: 2 }]);
    const changed = vi.fn();
    stops.push(watchFile("/repo/README.md", changed));
    await vi.waitFor(() => expect(changed).toHaveBeenCalledOnce());

    nudgeWatchedFiles(["/repo/README.md"]);

    await vi.waitFor(() => expect(statFiles).toHaveBeenCalledTimes(2));
    expect(changed).toHaveBeenCalledOnce();
  });

  it("notifies when a later sample observes a different mtime", async () => {
    statFiles
      .mockResolvedValueOnce([{ path: "/repo/README.md", mtimeMs: 2 }])
      .mockResolvedValueOnce([{ path: "/repo/README.md", mtimeMs: 3 }]);
    const changed = vi.fn();
    stops.push(watchFile("/repo/README.md", changed));
    await vi.waitFor(() => expect(changed).toHaveBeenCalledOnce());

    nudgeWatchedFiles(["/repo/README.md"]);

    await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(2));
  });

  it("does not duplicate an invalidation while resetting its baseline", async () => {
    statFiles.mockResolvedValue([{ path: "/repo/README.md", mtimeMs: 2 }]);
    const changed = vi.fn();
    stops.push(watchFile("/repo/README.md", changed));
    await vi.waitFor(() => expect(changed).toHaveBeenCalledOnce());

    invalidateWatchedFiles(["/repo/README.md"]);

    await vi.waitFor(() => expect(statFiles).toHaveBeenCalledTimes(2));
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it("samples local and remote files separately and keeps polling after a remote failure", async () => {
    const local = "/repo/a.txt";
    const remote = "remote://machine/repo/b.txt";
    statFiles.mockImplementation(async (paths: string[]) => {
      if (paths.includes(remote)) throw new Error("Machine disconnected");
      return paths.map((path) => ({ path, mtimeMs: 1 }));
    });
    const localChanged = vi.fn();
    const remoteChanged = vi.fn();
    stops.push(watchFile(remote, remoteChanged));
    stops.push(watchFile(local, localChanged));
    await vi.waitFor(() => expect(localChanged).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(statFiles).toHaveBeenCalledTimes(2));

    nudgeWatchedFiles();
    await vi.waitFor(() => expect(statFiles).toHaveBeenCalledTimes(4));
    expect(statFiles.mock.calls.every(([paths]) => paths.length === 1)).toBe(
      true,
    );
    expect(remoteChanged).not.toHaveBeenCalled();
  });
});
