import { hasLeaf, setLeafCwd } from "@/modules/terminal/lib/panes";
import type { Tab } from "./useTabs";

export function updateTerminalCwd(tab: Tab, leafId: number, cwd: string): Tab {
  if (tab.kind !== "terminal" || !hasLeaf(tab.paneTree, leafId)) return tab;
  const paneTree = setLeafCwd(tab.paneTree, leafId, cwd);
  const cwdChanged = tab.activeLeafId === leafId && tab.cwd !== cwd;
  if (paneTree === tab.paneTree && !cwdChanged) return tab;
  // The helper's root belongs to its authenticated session, independent of cd.
  return { ...tab, paneTree, ...(cwdChanged && { cwd }) };
}
