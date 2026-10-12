// @vitest-environment happy-dom

import {
  invalidateProjectFiles,
  loadProjectFiles,
  peekProjectFiles,
} from "@/modules/harness/lib/fileIndex";
import { listProjectFiles, type ProjectFile } from "@/modules/harness/lib/fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@/modules/harness/lib/fs", () => ({ listProjectFiles: vi.fn() }));
const list = vi.mocked(listProjectFiles);
const firstCwd = "C:/repo/first";
const secondCwd = "C:/repo/second";
const files: ProjectFile[] = [
  { name: "a.ts", relative: "a.ts", path: "/repo/a.ts" },
];

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  invalidateProjectFiles();
  list.mockReset().mockResolvedValue(files);
});

afterEach(() => {
  invalidateProjectFiles();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it.each(["focus", "visibilitychange"])(
  "revalidates indexes after %s",
  async (event) => {
    await loadProjectFiles(firstCwd);
    await loadProjectFiles(secondCwd);
    const changed = [
      ...files,
      { name: "new.ts", relative: "new.ts", path: "/repo/new.ts" },
    ];
    list.mockResolvedValue(changed);
    (event === "focus" ? window : document).dispatchEvent(new Event(event));
    expect(peekProjectFiles(firstCwd)).toBeNull();
    await vi.runAllTimersAsync();
    expect(peekProjectFiles(secondCwd)).toBe(changed);
    expect(list).toHaveBeenCalledTimes(3);
  },
);

it("does not refresh or evict indexes while the window is hidden", async () => {
  await loadProjectFiles(firstCwd);
  await loadProjectFiles(secondCwd);
  vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  document.dispatchEvent(new Event("visibilitychange"));
  await vi.runAllTimersAsync();
  expect(peekProjectFiles(firstCwd)).toBe(files);
  expect(peekProjectFiles(secondCwd)).toBe(files);
  expect(list).toHaveBeenCalledTimes(2);
});
