// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import {
  applyDiffPalette,
  initDiffPalette,
  loadDiffPalette,
  saveDiffPalette,
} from "@/modules/harness/lib/diffPalette";

let stop: (() => void) | undefined;
afterEach(() => {
  stop?.();
  stop = undefined;
  vi.restoreAllMocks();
  localStorage.clear();
  applyDiffPalette("default");
});

it("defaults safely for missing and invalid preferences", () => {
  expect(loadDiffPalette()).toBe("default");
  localStorage.setItem("monocode.diffPalette", "green");
  expect(loadDiffPalette()).toBe("default");
});

it.each(["default", "colorblind", "high-contrast"] as const)(
  "persists and restores %s at startup",
  (palette) => {
    saveDiffPalette(palette);
    expect(loadDiffPalette()).toBe(palette);
    applyDiffPalette("default");
    stop = initDiffPalette();
    expect(
      document.documentElement.classList.contains(`diff-palette-${palette}`),
    ).toBe(palette !== "default");
  },
);

it("switches classes without replacing the app theme", () => {
  document.documentElement.classList.add("dark");
  applyDiffPalette("colorblind");
  applyDiffPalette("high-contrast");
  expect(
    document.documentElement.classList.contains("diff-palette-colorblind"),
  ).toBe(false);
  expect(
    document.documentElement.classList.contains("diff-palette-high-contrast"),
  ).toBe(true);
  expect(document.documentElement.classList.contains("dark")).toBe(true);
  document.documentElement.classList.remove("dark");
});

it("applies changes from another window and cleans up its listener", () => {
  stop = initDiffPalette();
  localStorage.setItem("monocode.diffPalette", "colorblind");
  window.dispatchEvent(new StorageEvent("storage", { key: "other" }));
  expect(
    document.documentElement.classList.contains("diff-palette-colorblind"),
  ).toBe(false);
  window.dispatchEvent(
    new StorageEvent("storage", { key: "monocode.diffPalette" }),
  );
  expect(
    document.documentElement.classList.contains("diff-palette-colorblind"),
  ).toBe(true);
  localStorage.clear();
  window.dispatchEvent(new StorageEvent("storage", { key: null }));
  expect(
    document.documentElement.classList.contains("diff-palette-colorblind"),
  ).toBe(false);
  stop();
  localStorage.setItem("monocode.diffPalette", "high-contrast");
  window.dispatchEvent(
    new StorageEvent("storage", { key: "monocode.diffPalette" }),
  );
  expect(
    document.documentElement.classList.contains("diff-palette-high-contrast"),
  ).toBe(false);
});

it("applies the current choice when storage writes fail", () => {
  vi.spyOn(localStorage, "setItem").mockImplementation(() => {
    throw new Error("unavailable");
  });
  expect(() => saveDiffPalette("colorblind")).not.toThrow();
  expect(
    document.documentElement.classList.contains("diff-palette-colorblind"),
  ).toBe(true);
});

it("uses defaults when storage reads fail", () => {
  vi.spyOn(localStorage, "getItem").mockImplementation(() => {
    throw new Error("unavailable");
  });
  expect(loadDiffPalette()).toBe("default");
  expect(() => {
    stop = initDiffPalette();
  }).not.toThrow();
});
