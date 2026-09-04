import { platform } from "@tauri-apps/plugin-os";

const PLATFORM = (() => {
  try {
    const p = platform();
    if (p) return p;
  } catch {}
  if (typeof navigator !== "undefined" && navigator.userAgent) {
    if (/windows|win32/i.test(navigator.userAgent)) return "windows";
    if (/macintosh|mac os x/i.test(navigator.userAgent)) return "macos";
    if (/linux/i.test(navigator.userAgent)) return "linux";
  }
  if (typeof process !== "undefined" && process.platform) {
    if (process.platform === "win32") return "windows";
    if (process.platform === "darwin") return "macos";
    if (process.platform === "linux") return "linux";
  }
  return "";
})();

export const IS_MAC = PLATFORM === "macos";
export const IS_LINUX = PLATFORM === "linux";
export const IS_WINDOWS = PLATFORM === "windows";
export const IS_ANDROID = PLATFORM === "android";
export const IS_IOS = PLATFORM === "ios";
export const IS_MOBILE_OS = IS_ANDROID || IS_IOS;

/** Custom window controls (min/max/close) are rendered by us only on
 * non-macOS platforms — macOS keeps the native traffic lights via the
 * overlay title bar. */
export const USE_CUSTOM_WINDOW_CONTROLS = !IS_MAC && PLATFORM !== "";

export const MOD_KEY = IS_MAC ? "⌘" : "Ctrl";
/** KeyBinding property name for the platform's primary modifier. */
export const MOD_PROP: "meta" | "ctrl" = IS_MAC ? "meta" : "ctrl";
export const CTRL_KEY = IS_MAC ? "⌃" : "Ctrl";
export const ALT_KEY = IS_MAC ? "⌥" : "Alt";
export const SHIFT_KEY = IS_MAC ? "⇧" : "Shift";
export const TAB_KEY = IS_MAC ? "⇥" : "Tab";
export const ENTER_KEY = IS_MAC ? "↵" : "Enter";

export const KEY_SEP = IS_MAC ? "" : "+";

export function fmtShortcut(...parts: string[]): string {
  return parts.join(KEY_SEP);
}
