import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  announceSessionFinished,
  notifySession,
  saveNotificationsEnabled,
  setWindowFocused,
} from "@/modules/harness/lib/notifications";
import { updateNotificationPreferences } from "./notificationPreferences";
import { newSession } from "@/modules/harness/lib/session";

const { invoke, play } = vi.hoisted(() => ({ invoke: vi.fn(), play: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("cuelume", () => ({ play, setEnabled: vi.fn(), setVolume: vi.fn() }));

describe("notificationDelivery", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, String(value)),
      removeItem: (key: string) => store.delete(key),
      clear: () => store.clear(),
      get length() {
        return store.size;
      },
      key: (index: number) => Array.from(store.keys())[index] ?? null,
    });
    vi.stubGlobal("window", {
      dispatchEvent: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    invoke.mockReset();
    play.mockClear();
    invoke.mockResolvedValue(undefined);
    saveNotificationsEnabled(true);
    setWindowFocused(false);
  });

  it("returns false without a banner or sound for a non-project path", async () => {
    const sent = await notifySession(
      newSession("claude", "/"),
      "finished",
      false,
    );

    expect(sent).toBe(false);
    expect(
      invoke.mock.calls.filter(([command]) => command === "show_notification"),
    ).toEqual([]);
    expect(play).not.toHaveBeenCalled();
  });

  it("finishes without a banner or sound for a non-project path", async () => {
    await expect(
      announceSessionFinished(
        newSession("claude", "/"),
        false,
      ),
    ).resolves.toBeUndefined();

    expect(
      invoke.mock.calls.filter(([command]) => command === "show_notification"),
    ).toEqual([]);
    expect(play).not.toHaveBeenCalled();
  });

  it("blocks every project banner, including approvals and questions, while muted", async () => {
    updateNotificationPreferences(["local:/private"], {
      mutedUntil: null,
    });
    const session = newSession("claude", "/private");
    expect(await notifySession(session, "finished", false)).toBe(false);
    expect(
      await notifySession(session, { kind: "approval", requestId: 1 }, false),
    ).toBe(false);
    expect(
      await notifySession(session, { kind: "question", requestId: 2 }, false),
    ).toBe(false);
    expect(
      invoke.mock.calls.filter(([command]) => command === "show_notification"),
    ).toEqual([]);
  });

  it("does not deliver an input event observed during a mute after expiry", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    try {
      updateNotificationPreferences(["local:/private"], {
        mutedUntil: 2000,
      });
      const sent = notifySession(
        newSession("claude", "/private"),
        { kind: "question", requestId: 1 },
        false,
      );
      vi.setSystemTime(3000);
      expect(await sent).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
