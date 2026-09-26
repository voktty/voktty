import type { ExplorerMenuItem } from "./ExplorerMenu";
import { reminderTime } from "../lib/sessionReminders";

export function sessionReminderPresets(
  t: (key: string, params?: Record<string, string | number>) => string,
  now = new Date(),
) {
  const timeInHours = (hours: 1 | 3) => {
    const date = new Date(reminderTime(`reminder:${hours}h`, now)!);
    return `${date.getHours()}:${String(date.getMinutes()).padStart(2, "0")}`;
  };

  return [
    {
      kind: "item",
      id: "reminder:1h",
      label: t("harness.reminders.inOneHour", { time: timeInHours(1) }),
    },
    {
      kind: "item",
      id: "reminder:3h",
      label: t("harness.reminders.inThreeHours", { time: timeInHours(3) }),
    },
    {
      kind: "item",
      id: "reminder:evening",
      label: t("harness.reminders.thisEvening"),
      disabled: reminderTime("reminder:evening", now) == null,
    },
    {
      kind: "item",
      id: "reminder:tomorrow",
      label: t("harness.reminders.tomorrow"),
    },
    {
      kind: "item",
      id: "reminder:next-week",
      label: t("harness.reminders.nextWeek"),
    },
  ] satisfies ExplorerMenuItem[];
}
