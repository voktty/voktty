import { createContext } from "react";
import type { ResumedWorkspace } from "@/modules/harness/lib/inFlight";
import type { WindowTransferPayload } from "@/modules/harness/lib/windowTransfer";

export type HarnessRestoredView = {
  resumed?: ResumedWorkspace;
  windowTransfer?: WindowTransferPayload;
};

export const HarnessRestoreContext = createContext<{
  views: ReadonlyMap<string, HarnessRestoredView>;
  claimed: Set<string>;
} | null>(null);
