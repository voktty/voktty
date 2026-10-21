import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FsEntry } from "./fs";
import {
  forgetDir,
  listCachedDir,
  notifyDirsChanged,
  peekDir,
  refreshCachedDirs,
  refreshDir,
  subscribeDirsChanged,
} from "./fileTree";

const root = "/tmp/empty-project";

function entry(name: string): FsEntry {
  return {
    name,
    path: `${root}/${name}`,
    isDir: false,
    ignored: false,
  };
}

const listDir = vi.fn<(path: string) => Promise<FsEntry[]>>();

vi.mock("./fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./fs")>();
  return {
    ...actual,
    listDir: (path: string) => listDir(path),
  };
});

describe("fileTree cache", () => {
  beforeEach(() => {
    forgetDir(root);
    listDir.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps the first listing until refreshDir", async () => {
    listDir.mockResolvedValueOnce([]);
    await listCachedDir(root);
    expect(peekDir(root)).toEqual([]);

    listDir.mockResolvedValueOnce([entry("hello.ts")]);
    expect(await listCachedDir(root)).toEqual([]);
    expect(listDir).toHaveBeenCalledTimes(1);

    expect(await refreshDir(root)).toEqual([entry("hello.ts")]);
    expect(peekDir(root)).toEqual([entry("hello.ts")]);
  });

  it("refreshCachedDirs re-lists every cached folder", async () => {
    listDir.mockResolvedValueOnce([]);
    await listCachedDir(root);
    listDir.mockResolvedValueOnce([entry("created.ts")]);
    await refreshCachedDirs();
    expect(peekDir(root)).toEqual([entry("created.ts")]);
  });

  it("notifyDirsChanged refreshes the cache and tells listeners", async () => {
    vi.useFakeTimers();
    listDir.mockResolvedValueOnce([]);
    await listCachedDir(root);

    const onChange = vi.fn();
    const stop = subscribeDirsChanged(onChange);
    listDir.mockResolvedValueOnce([entry("from-agent.ts")]);
    notifyDirsChanged();
    expect(peekDir(root)).toEqual([]);

    await vi.runAllTimersAsync();
    expect(peekDir(root)).toEqual([entry("from-agent.ts")]);
    expect(onChange).toHaveBeenCalledTimes(1);
    stop();
  });
});

describe("fileTree revalidation", () => {
  beforeEach(() => {
    forgetDir(root);
    listDir.mockReset();
  });

  it("keeps the cached listing visible while a refresh is in flight", async () => {
    listDir.mockResolvedValueOnce([entry("a.ts")]);
    await listCachedDir(root);

    let finish: (entries: FsEntry[]) => void = () => undefined;
    listDir.mockReturnValueOnce(
      new Promise<FsEntry[]>((resolve) => {
        finish = resolve;
      }),
    );
    const refreshing = refreshDir(root);
    expect(peekDir(root)).toEqual([entry("a.ts")]);

    finish([entry("a.ts"), entry("b.ts")]);
    await refreshing;
    expect(peekDir(root)).toEqual([entry("a.ts"), entry("b.ts")]);
  });

  it("returns the same array when nothing changed", async () => {
    listDir.mockResolvedValueOnce([entry("a.ts")]);
    const first = await listCachedDir(root);
    listDir.mockResolvedValueOnce([entry("a.ts")]);
    expect(await refreshDir(root)).toBe(first);
    expect(peekDir(root)).toBe(first);
  });

  it("forgets a folder that can no longer be listed", async () => {
    listDir.mockResolvedValueOnce([entry("a.ts")]);
    await listCachedDir(root);
    listDir.mockRejectedValueOnce(new Error("gone"));
    await refreshCachedDirs();
    expect(peekDir(root)).toBeNull();
  });

  it("does not revive a folder forgotten while its listing was in flight", async () => {
    listDir.mockResolvedValueOnce([entry("a.ts")]);
    await listCachedDir(root);
    let finish: (entries: FsEntry[]) => void = () => undefined;
    listDir.mockReturnValueOnce(
      new Promise<FsEntry[]>((resolve) => {
        finish = resolve;
      }),
    );
    const refreshing = refreshDir(root);
    forgetDir(root);
    finish([entry("a.ts"), entry("b.ts")]);
    await refreshing;
    expect(peekDir(root)).toBeNull();
  });
});

describe("refreshCachedDirs concurrency", () => {
  it("never lists more than four folders at once", async () => {
    const base = "/tmp/many";
    const paths = Array.from({ length: 10 }, (_, index) => `${base}/d${index}`);
    listDir.mockResolvedValue([]);
    await Promise.all(paths.map((path) => listCachedDir(path)));

    let active = 0;
    let peak = 0;
    listDir.mockReset().mockImplementation(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      return [];
    });
    await refreshCachedDirs();
    expect(listDir.mock.calls.length).toBeGreaterThanOrEqual(paths.length);
    expect(peak).toBeLessThanOrEqual(4);
    forgetDir(base);
  });
});