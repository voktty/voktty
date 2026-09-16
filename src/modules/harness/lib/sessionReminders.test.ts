import { describe, expect, it } from "vitest";
import { formatReminderTime, reminderTime } from "./sessionReminders";

describe("reminderTime", () => {
  it("calculates relative durations from the provided timestamp", () => {
    const now = new Date("2026-03-01T10:00:00Z");
    expect(reminderTime("reminder:1h", now)).toBe(
      now.getTime() + 60 * 60 * 1000,
    );
    expect(reminderTime("reminder:3h", now)).toBe(
      now.getTime() + 3 * 60 * 60 * 1000,
    );
  });

  it("schedules this evening when earlier in the day", () => {
    const now = new Date(2026, 2, 1, 10, 0, 0);
    const evening = reminderTime("reminder:evening", now);
    expect(evening).not.toBeNull();
    const date = new Date(evening!);
    expect(date.getFullYear()).toBe(2026);
    expect(date.getMonth()).toBe(2);
    expect(date.getDate()).toBe(1);
    expect(date.getHours()).toBe(18);
  });

  it("disables this evening once the hour has passed", () => {
    const now = new Date(2026, 2, 1, 19, 0, 0);
    expect(reminderTime("reminder:evening", now)).toBeNull();
  });

  it("schedules tomorrow and next week at 9am", () => {
    const sunday = new Date(2026, 2, 1, 12, 0, 0);
    const tomorrow = new Date(reminderTime("reminder:tomorrow", sunday)!);
    expect(tomorrow.getDate()).toBe(2);
    expect(tomorrow.getHours()).toBe(9);

    const nextWeek = new Date(reminderTime("reminder:next-week", sunday)!);
    expect(nextWeek.getDate()).toBe(2);
    expect(nextWeek.getDay()).toBe(1);
    expect(nextWeek.getHours()).toBe(9);
  });

  it("formats reminder times into readable strings", () => {
    const dueAt = new Date(2026, 2, 1, 14, 30, 0).getTime();
    const formatted = formatReminderTime(dueAt);
    expect(formatted).toMatch(/(?:14:30|2:30\s*PM)/i);
  });
});
