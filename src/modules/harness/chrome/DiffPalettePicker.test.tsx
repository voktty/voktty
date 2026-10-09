// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { DiffPalettePicker } from "@/modules/harness/chrome/DiffPalettePicker";
import {
  applyDiffPalette,
  initDiffPalette,
  loadDiffPalette,
  saveDiffPalette,
} from "@/modules/harness/lib/diffPalette";
import { loadLocale, translate } from "@/modules/i18n";

let root: Root | undefined;
let parent: HTMLDivElement | undefined;
let stop: (() => void) | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  parent?.remove();
  stop?.();
  stop = undefined;
  vi.restoreAllMocks();
  localStorage.clear();
  applyDiffPalette("default");
});

function mount() {
  stop = initDiffPalette();
  parent = document.createElement("div");
  document.body.append(parent);
  root = createRoot(parent);
  act(() => root?.render(<DiffPalettePicker />));
  const picker = parent.querySelector("select");
  if (!picker) throw new Error("Missing palette picker");
  return picker;
}

it("restores a choice and applies each palette through the settings control", () => {
  saveDiffPalette("colorblind");
  const picker = mount();
  expect(picker.value).toBe("colorblind");
  expect(picker.getAttribute("aria-label")).toBe("Diff colors");
  for (const palette of ["high-contrast", "default", "colorblind"]) {
    act(() => {
      picker.value = palette;
      picker.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(loadDiffPalette()).toBe(palette);
    expect(picker.value).toBe(palette);
    expect(
      document.documentElement.classList.contains(`diff-palette-${palette}`),
    ).toBe(palette !== "default");
  }
});

it("reflects same-window saves, other-window changes and preference clearing", () => {
  const picker = mount();
  act(() => saveDiffPalette("high-contrast"));
  expect(picker.value).toBe("high-contrast");
  act(() => {
    localStorage.setItem("monocode.diffPalette", "colorblind");
    window.dispatchEvent(
      new StorageEvent("storage", { key: "monocode.diffPalette" }),
    );
  });
  expect(picker.value).toBe("colorblind");
  act(() => {
    localStorage.clear();
    window.dispatchEvent(new StorageEvent("storage", { key: null }));
  });
  expect(picker.value).toBe("default");
});

it("keeps the displayed choice aligned with the view when saving fails", () => {
  const picker = mount();
  vi.spyOn(localStorage, "setItem").mockImplementation(() => {
    throw new Error("unavailable");
  });
  act(() => {
    picker.value = "colorblind";
    picker.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(picker.value).toBe("colorblind");
  expect(
    document.documentElement.classList.contains("diff-palette-colorblind"),
  ).toBe(true);
});

it("provides Spanish labels for every new setting", async () => {
  await loadLocale("es");
  expect(translate("es", "harness.settings.diffColors")).toBe(
    "Colores de diferencias",
  );
  expect(translate("es", "harness.settings.colorblind")).toBe("Daltonismo");
  expect(translate("es", "harness.settings.highContrast")).toBe(
    "Alto contraste",
  );
});
