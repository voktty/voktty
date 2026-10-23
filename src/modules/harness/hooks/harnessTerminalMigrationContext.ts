import { createContext } from "react";
import type { createLegacyTerminalMigrations } from "@/modules/harness/lib/legacyTerminalMigrations";

export const HarnessTerminalMigrationContext = createContext<ReturnType<
  typeof createLegacyTerminalMigrations
> | null>(null);
