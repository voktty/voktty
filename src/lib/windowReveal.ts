import { getCurrentWindow } from "@tauri-apps/api/window";
import { markStartupPhase } from "@/lib/startupTiming";

let windowRevealed = false;

export function revealWindow(): void {
  if (windowRevealed) return;
  windowRevealed = true;
  getCurrentWindow()
    .show()
    .then(() => markStartupPhase("window-visible"))
    .catch((e) => console.error("window.show failed:", e));
}
