export type DiffPalette = "default" | "colorblind" | "high-contrast";

const KEY = "monocode.diffPalette";
export const DIFF_PALETTE_CHANGE_EVENT = "monocode:diffpalettechange";

function parsePalette(value: unknown): DiffPalette {
  return value === "colorblind" || value === "high-contrast"
    ? value
    : "default";
}

export function loadDiffPalette(): DiffPalette {
  try {
    return parsePalette(localStorage.getItem(KEY));
  } catch {
    return "default";
  }
}

export function applyDiffPalette(value: DiffPalette): DiffPalette {
  const next = parsePalette(value);
  const classes = document.documentElement.classList;
  classes.toggle("diff-palette-colorblind", next === "colorblind");
  classes.toggle("diff-palette-high-contrast", next === "high-contrast");
  return next;
}

export function saveDiffPalette(value: DiffPalette) {
  const next = applyDiffPalette(value);
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // Keep the current view usable when preference storage is unavailable.
  }
  window.dispatchEvent(new CustomEvent(DIFF_PALETTE_CHANGE_EVENT));
}

/** Main and settings webviews share storage but have separate documents. */
export function initDiffPalette(): () => void {
  applyDiffPalette(loadDiffPalette());
  const onStorage = (event: StorageEvent) => {
    if (event.key !== KEY && event.key !== null) return;
    if (event.storageArea && event.storageArea !== localStorage) return;
    applyDiffPalette(loadDiffPalette());
    window.dispatchEvent(new CustomEvent(DIFF_PALETTE_CHANGE_EVENT));
  };
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
}
