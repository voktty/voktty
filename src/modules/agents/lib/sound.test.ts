import { beforeEach, describe, expect, it, vi } from "vitest";

const sound = vi.hoisted(() => ({
  playVokttySound: vi.fn(),
}));

vi.mock("@/modules/sound", () => sound);

beforeEach(() => {
  vi.resetAllMocks();
});

describe("playAgentNotificationSound", () => {
  it("uses the shared Voktty sound engine", async () => {
    const { playAgentNotificationSound } = await import("./sound");

    playAgentNotificationSound();

    expect(sound.playVokttySound).toHaveBeenCalledWith("notification", {
      retrigger: "restart",
    });
  });
});
