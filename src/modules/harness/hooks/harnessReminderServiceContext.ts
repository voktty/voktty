import { createContext } from "react";
import type { PersistencePermit } from "@/modules/harness/lib/persistenceAdmission";
import type { SessionReminder } from "@/modules/harness/lib/sessionReminders";

export type ReminderSessionOpener = (
  sessionId: string,
  permit?: PersistencePermit,
) => Promise<void> | Promise<boolean>;

export type ConfirmedReminderSessionOpener = (
  ...args: Parameters<ReminderSessionOpener>
) => Promise<boolean>;

export type HarnessReminderService = {
  reminders: SessionReminder[];
  due: SessionReminder[];
  error: string | null;
  refreshCurrent: (isCurrent: () => boolean) => Promise<void>;
};

export const HarnessReminderServiceContext =
  createContext<HarnessReminderService | null>(null);
