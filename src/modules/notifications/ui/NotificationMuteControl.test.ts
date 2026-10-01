import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadNotificationPreferences,
  updateNotificationPreferences,
} from "../model/notificationPreferences";
import { NotificationMuteControl } from "./NotificationMuteControl";

describe("NotificationMuteControl", () => {
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
  });

  it("renders unmuted state correctly", () => {
    const markup = renderToStaticMarkup(
      createElement(NotificationMuteControl, {
        projectIds: ["local:/test"],
      }),
    );
    expect(markup).toContain("Mute");
    expect(markup).not.toContain("Resume notifications");
  });

  it("renders muted state with resume button", () => {
    updateNotificationPreferences(["local:/test"], { mutedUntil: null });
    const markup = renderToStaticMarkup(
      createElement(NotificationMuteControl, {
        projectIds: ["local:/test"],
      }),
    );
    expect(markup).toContain("Muted");
    expect(markup).toContain("Resume notifications");
    expect(markup).toContain("Muted until resumed");
  });

  it("renders summary when multiple projects are muted", () => {
    updateNotificationPreferences(["local:/p1", "local:/p2"], {
      mutedUntil: null,
    });
    const markup = renderToStaticMarkup(
      createElement(NotificationMuteControl, {
        projectIds: ["local:/p1", "local:/p2", "local:/p3"],
      }),
    );
    expect(markup).toContain("2 of 3 projects muted");
    expect(markup).toContain("Resume notifications");
  });

  it("updates preferences on mute and resume calls", () => {
    updateNotificationPreferences(["local:/p1"], { disabled: ["issues"] });
    updateNotificationPreferences(["local:/p1"], { mutedUntil: 1_900_000_000 });
    expect(loadNotificationPreferences()["local:/p1"]).toEqual({
      disabled: ["issues"],
      mutedUntil: 1_900_000_000,
    });

    updateNotificationPreferences(["local:/p1"], { mutedUntil: undefined });
    expect(loadNotificationPreferences()["local:/p1"]).toEqual({
      disabled: ["issues"],
      mutedUntil: undefined,
      resumedAt: expect.any(Number),
    });
  });
});
