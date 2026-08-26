import { beforeEach, describe, expect, it, vi } from "vitest";

const playThrottled = vi.hoisted(() => vi.fn());
const preferences = vi.hoisted(() => ({
  hydrated: true,
  soundEnabled: true,
  agentNotificationSound: true,
}));

vi.mock("@/modules/sound/events", () => ({
  playVokttySoundThrottled: playThrottled,
}));

vi.mock("@/modules/settings/preferences", () => ({
  usePreferencesStore: {
    getState: () => preferences,
  },
}));

import { avatarPresenceCue, playAvatarPresenceSound } from "./sound";

describe("avatar semantic sounds", () => {
  beforeEach(() => {
    playThrottled.mockReset();
    preferences.hydrated = true;
    preferences.soundEnabled = true;
    preferences.agentNotificationSound = true;
  });

  it("uses one coalesced progress cue for meaningful work transitions", () => {
    expect(avatarPresenceCue("thinking", "planning")).toBe("progress-step");
    expect(avatarPresenceCue("planning", "tool-running")).toBe("progress-step");
  });

  it("does not emit sounds for idle, streaming or repeated states", () => {
    expect(avatarPresenceCue("idle", "thinking")).toBeNull();
    expect(avatarPresenceCue("tool-running", "tool-running")).toBeNull();
    expect(avatarPresenceCue("thinking", "streaming")).toBeNull();
  });

  it("routes an approved transition through the existing sound facade", () => {
    playAvatarPresenceSound("thinking", "planning");

    expect(playThrottled).toHaveBeenCalledWith(
      "progress-step",
      "avatar:progress",
      180,
    );
  });

  it("stays silent when sound or notification preferences are unavailable", () => {
    for (const preference of [
      "hydrated",
      "soundEnabled",
      "agentNotificationSound",
    ] as const) {
      preferences[preference] = false;
      playAvatarPresenceSound("thinking", "planning");
      expect(playThrottled).not.toHaveBeenCalled();
      preferences[preference] = true;
    }
  });
});
