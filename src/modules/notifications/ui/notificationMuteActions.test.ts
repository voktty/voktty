import { describe, expect, it, vi } from "vitest";
import {
  notificationMuteActions,
  notificationMuteDeadline,
  notificationMuteStatus,
} from "./notificationMuteActions";

describe("notificationMuteActions", () => {
  it("computes status for indefinite and timed mutes", () => {
    expect(notificationMuteStatus(undefined)).toBeNull();
    expect(notificationMuteStatus({ disabled: [] })).toBeNull();
    expect(notificationMuteStatus({ disabled: [], mutedUntil: null })).toBe(
      "Muted until resumed",
    );
    expect(
      notificationMuteStatus({ disabled: [], mutedUntil: 1_800_000_000_000 }),
    ).toContain("Muted until");
  });

  it("builds preset action list with relative time strings", () => {
    const fixedNow = new Date("2026-09-14T10:00:00Z");
    const actions = notificationMuteActions(fixedNow);
    expect(actions.length).toBeGreaterThanOrEqual(4);
    expect(actions.some((a) => a.id === "mute:1")).toBe(true);
    expect(actions.some((a) => a.id === "mute:indefinite")).toBe(true);
    expect(actions.some((a) => a.id === "mute:custom")).toBe(true);
  });

  it("calculates deadline timestamps correctly", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000_000_000);
    expect(notificationMuteDeadline("mute:1")).toBe(1_000_000_000 + 3_600_000);
    expect(notificationMuteDeadline("mute:8")).toBe(1_000_000_000 + 28_800_000);
    expect(notificationMuteDeadline("mute:indefinite")).toBeNull();
    expect(notificationMuteDeadline("mute:custom")).toBeUndefined();
    expect(notificationMuteDeadline("unknown")).toBeUndefined();
    vi.restoreAllMocks();
  });
});
