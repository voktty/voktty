import type { CueName } from "uisfx";
import type { ProblemSummary } from "@/modules/editor/lib/problems";
import { playVokttySound } from "./sound";

const lastPlayedAt = new Map<string, number>();

/**
 * Plays a semantic application cue while coalescing bursts from noisy
 * producers such as language servers and task polling.
 */
export function playVokttySoundThrottled(
  cue: CueName,
  key: string,
  cooldownMs = 450,
): void {
  const now = Date.now();
  const previous = lastPlayedAt.get(key) ?? 0;
  if (now - previous < cooldownMs) return;
  const playing = playVokttySound(cue, { retrigger: "restart" });
  if (playing) lastPlayedAt.set(key, now);
}

/** Maps the most important current diagnostic to a distinct available cue. */
export function problemSoundCue(summary: ProblemSummary): CueName | null {
  if (summary.errors > 0) return "error";
  if (summary.warnings > 0) return "warning";
  if (summary.information > 0) return "info";
  if (summary.hints > 0) return "select";
  return null;
}

/**
 * Settings switches are rendered by several section components. A delegated
 * handler keeps their sound behavior consistent without changing every
 * individual setting control.
 */
export function scheduleSettingsToggleSound(target: EventTarget | null): void {
  if (!(target instanceof HTMLElement)) return;
  const control = target.closest<HTMLElement>(
    '[role="switch"], input[type="checkbox"]',
  );
  if (!control || control.getAttribute("aria-disabled") === "true") return;

  const wasChecked =
    control.getAttribute("role") === "switch"
      ? control.getAttribute("aria-checked") === "true"
      : (control as HTMLInputElement).checked;
  const cue: CueName = wasChecked ? "toggle-off" : "toggle-on";

  // Run after the control updates its state. This means enabling sounds can
  // produce the first audible cue, while disabling them stays silent.
  window.setTimeout(() => {
    playVokttySound(cue, { retrigger: "restart" });
  }, 0);
}
