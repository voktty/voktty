import { createContext } from "react";
import type { TabKey } from "@/modules/tabs/lib/tabIdentity";

export const HarnessTerminalOwner = createContext<{
  tabKey: TabKey;
  visible: boolean;
  layoutKey?: string;
  onFocus?: () => void;
} | null>(null);
