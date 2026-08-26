import { beforeEach, describe, expect, it, vi } from "vitest";

const player = vi.hoisted(() => ({
  unlock: vi.fn<() => Promise<boolean>>(),
  play: vi.fn(),
  setEnabled: vi.fn(),
  setVolume: vi.fn(),
  stopAll: vi.fn(),
}));
const preferences = vi.hoisted(() => ({
  hydrated: true,
  soundEnabled: true,
  soundVolume: 0.65,
}));

vi.mock("uisfx", () => ({
  createUISFX: vi.fn(() => player),
}));
vi.mock("@/modules/settings/preferences", () => ({
  usePreferencesStore: {
    getState: () => preferences,
    subscribe: vi.fn(() => () => undefined),
  },
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  preferences.hydrated = true;
  preferences.soundEnabled = true;
  preferences.soundVolume = 0.65;
  player.unlock.mockResolvedValue(true);
  player.play.mockReturnValue(null);
});

describe("Voktty sound engine", () => {
  it("creates one local player and delegates a cue", async () => {
    const { createUISFX } = await import("uisfx");
    const { playVokttySound } = await import("./sound");

    playVokttySound("notification");
    playVokttySound("select");

    expect(createUISFX).toHaveBeenCalledOnce();
    expect(createUISFX).toHaveBeenCalledWith({
      pack: "mechanical",
      volume: 0.65,
      enabled: false,
      maxVoices: 4,
    });
    expect(player.play).toHaveBeenNthCalledWith(1, "notification", undefined);
    expect(player.play).toHaveBeenNthCalledWith(2, "select", undefined);
  });

  it("keeps all playback disabled until preferences are hydrated", async () => {
    preferences.hydrated = false;
    const { playVokttySound } = await import("./sound");

    expect(playVokttySound("notification")).toBeNull();
    expect(player.play).not.toHaveBeenCalled();
  });

  it("stops playback when the global preference is disabled", async () => {
    preferences.soundEnabled = false;
    const { playVokttySound } = await import("./sound");

    expect(playVokttySound("notification")).toBeNull();
    expect(player.play).not.toHaveBeenCalled();
  });

  it("unlocks through the local player after a user gesture", async () => {
    const { unlockVokttySounds } = await import("./sound");

    await expect(unlockVokttySounds()).resolves.toBe(true);
    expect(player.unlock).toHaveBeenCalledOnce();
  });

  it("fails silently when the audio provider throws", async () => {
    player.play.mockImplementation(() => {
      throw new Error("audio unavailable");
    });
    const { playVokttySound } = await import("./sound");

    expect(playVokttySound("notification")).toBeNull();
  });
});
