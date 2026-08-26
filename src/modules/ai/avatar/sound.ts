import type { CueName } from "uisfx";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { playVokttySoundThrottled } from "@/modules/sound/events";
import type { AvatarPresenceState } from "./presence";

const AVATAR_PROGRESS_STATES = new Set<AvatarPresenceState>([
  "planning",
  "tool-running",
]);

export function avatarPresenceCue(
  previous: AvatarPresenceState,
  next: AvatarPresenceState,
): CueName | null {
  if (previous === next || !AVATAR_PROGRESS_STATES.has(next)) return null;
  return "progress-step";
}

export function playAvatarPresenceSound(
  previous: AvatarPresenceState,
  next: AvatarPresenceState,
): void {
  const cue = avatarPresenceCue(previous, next);
  if (!cue) return;

  const preferences = usePreferencesStore.getState();
  if (
    !preferences.hydrated ||
    !preferences.soundEnabled ||
    !preferences.agentNotificationSound
  ) {
    return;
  }

  playVokttySoundThrottled(cue, "avatar:progress", 180);
}
