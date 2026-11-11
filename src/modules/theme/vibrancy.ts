import { invoke } from "@tauri-apps/api/core";
import type { WindowMaterial } from "./windowMaterial";

/** Mirrors `Backdrop` in `src-tauri/src/modules/vibrancy.rs`. */
export type Backdrop = "vibrancy" | "mica" | "none";

let kindPromise: Promise<Backdrop> | null = null;

export function getBackdropKind(): Promise<Backdrop> {
  kindPromise ??= invoke<Backdrop>("window_backdrop_kind").catch(
    () => "none" as const,
  );
  return kindPromise;
}

let materialsPromise: Promise<WindowMaterial[]> | null = null;

/** Windows materials this system can paint; empty elsewhere. */
export function getWindowMaterials(): Promise<WindowMaterial[]> {
  materialsPromise ??= invoke<WindowMaterial[]>("window_materials").catch(
    () => [],
  );
  return materialsPromise;
}

/** Last state handed to the native side. Repeating it would rebuild the
 * effect view for nothing. */
let applied: string | null = null;
let queue: Promise<void> = Promise.resolve();

/** Serialized: two in-flight toggles could otherwise land out of order.
 * `force` bypasses the no-op dedup and re-sends the same state to native -
 * needed after a raw OS theme flip, since Windows can silently reset the
 * window's Mica dark/light attribute on that broadcast even though Voktty's
 * own resolved mode (and therefore `dark`) never changed. */
export function applyVibrancy(
  enabled: boolean,
  dark: boolean,
  force = false,
  material: WindowMaterial | "none" = "mica",
): Promise<void> {
  queue = queue.then(() => run(enabled, dark, force, material));
  return queue;
}

async function run(
  enabled: boolean,
  dark: boolean,
  force: boolean,
  material: WindowMaterial | "none",
): Promise<void> {
  const kind = await getBackdropKind();
  const on = enabled && kind !== "none" && material !== "none";
  const root = document.documentElement;

  const paintOpaque = () => {
    root.removeAttribute("data-vibrancy");
  };

  if (on) {
    root.setAttribute("data-vibrancy", "on");
  } else {
    paintOpaque();
  }

  // Mica and macOS Vibrancy tint their own backdrop based on the active dark/light mode,
  // so they have to be rebuilt on a mode flip.
  const key = on ? `on:${dark}:${material}` : "off";
  if (key === applied && !force) return;

  try {
    await invoke("window_set_backdrop", {
      enabled: on,
      dark,
      ...(on ? { material } : {}),
    });
    applied = key;
  } catch {
    // Never leave the webview transparent over nothing.
    paintOpaque();
    applied = null;
  }
}

let currentCornerSquare: boolean | null = null;

export async function setWindowCornerPreference(square: boolean): Promise<void> {
  if (currentCornerSquare === square) return;
  try {
    await invoke("window_set_corner_preference", { square });
    currentCornerSquare = square;
  } catch {
    // Graceful fallback when outside Tauri or unsupported platform
  }
}

