import {
  createUISFX,
  type CueName,
  type PlayOptions,
  type PlayingSFX,
  type UISFXPlayer,
} from "uisfx";
import {
  clampSoundVolume,
  SOUND_VOLUME_DEFAULT,
} from "@/modules/settings/store";
import { usePreferencesStore } from "@/modules/settings/preferences";

const SOUND_PACK = "mechanical" as const;
const MAX_VOICES = 4;

let player: UISFXPlayer | undefined;
let unlockListenersInstalled = false;

function isReadyToPlay(): boolean {
  const preferences = usePreferencesStore.getState();
  return preferences.hydrated && preferences.soundEnabled;
}

function syncPlayer(nextPlayer: UISFXPlayer): void {
  const preferences = usePreferencesStore.getState();
  const enabled = preferences.hydrated && preferences.soundEnabled;
  nextPlayer.setVolume(
    clampSoundVolume(preferences.soundVolume ?? SOUND_VOLUME_DEFAULT),
  );
  nextPlayer.setEnabled(enabled);
  if (!enabled) nextPlayer.stopAll();
}

function getPlayer(): UISFXPlayer | undefined {
  if (player) return player;
  try {
    player = createUISFX({
      pack: SOUND_PACK,
      volume: SOUND_VOLUME_DEFAULT,
      enabled: false,
      maxVoices: MAX_VOICES,
    });
    syncPlayer(player);
    return player;
  } catch {
    return undefined;
  }
}

export function playVokttySound(
  cue: CueName,
  options?: PlayOptions,
): PlayingSFX | null {
  if (!isReadyToPlay()) return null;
  const nextPlayer = getPlayer();
  if (!nextPlayer) return null;
  try {
    syncPlayer(nextPlayer);
    return nextPlayer.play(cue, options);
  } catch {
    return null;
  }
}

export async function unlockVokttySounds(): Promise<boolean> {
  if (!isReadyToPlay()) return false;
  const nextPlayer = getPlayer();
  if (!nextPlayer) return false;
  try {
    syncPlayer(nextPlayer);
    return await nextPlayer.unlock();
  } catch {
    return false;
  }
}

function removeUnlockListeners(): void {
  if (typeof window === "undefined" || !unlockListenersInstalled) return;
  window.removeEventListener("pointerdown", handleUnlockGesture, true);
  window.removeEventListener("keydown", handleUnlockGesture, true);
  unlockListenersInstalled = false;
}

function handleUnlockGesture(): void {
  if (!usePreferencesStore.getState().hydrated) return;
  void unlockVokttySounds().finally(removeUnlockListeners);
}

function installUnlockListeners(): void {
  if (typeof window === "undefined" || unlockListenersInstalled) return;
  window.addEventListener("pointerdown", handleUnlockGesture, true);
  window.addEventListener("keydown", handleUnlockGesture, true);
  unlockListenersInstalled = true;
}

usePreferencesStore.subscribe((state, previous) => {
  if (
    state.hydrated === previous.hydrated &&
    state.soundEnabled === previous.soundEnabled &&
    state.soundVolume === previous.soundVolume
  ) {
    return;
  }
  const nextPlayer = getPlayer();
  if (nextPlayer) syncPlayer(nextPlayer);
});

installUnlockListeners();
