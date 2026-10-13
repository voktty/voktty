import type { Tab } from "@/modules/tabs";
import { findLeafCwd } from "@/modules/terminal/lib/panes";

export function selectAiWorkspaceCwd(
  active: Tab | undefined,
  tabs: readonly Tab[],
  fallback: string | null,
): string | null {
  if (active?.kind === "harness") return active.cwd ?? fallback;
  if (active?.kind === "terminal")
    return (
      findLeafCwd(active.paneTree, active.activeLeafId) ?? active.cwd ?? null
    );
  for (let index = tabs.length - 1; index >= 0; index--) {
    const tab = tabs[index];
    if (tab.kind !== "terminal") continue;
    const cwd = findLeafCwd(tab.paneTree, tab.activeLeafId) ?? tab.cwd;
    if (cwd) return cwd;
  }
  return fallback;
}
