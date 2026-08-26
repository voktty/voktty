import { leafIds, type PaneNode } from "@/modules/terminal/lib/panes";
import {
  MAX_PANES_PER_TAB,
  RENDERER_POOL_SIZE,
} from "@/modules/terminal/lib/paneLimits";
import type { TabKey } from "@/modules/tabs/lib/tabIdentity";

/**
 * Keep one renderer slot available for focus changes, previews and recovery.
 * The per-tab limit and the pool limit currently converge on eight leaves.
 */
export const MAX_VISIBLE_TERMINAL_LEAVES = Math.min(
  MAX_PANES_PER_TAB,
  RENDERER_POOL_SIZE - 1,
);

export type PaneBudgetTab = {
  tabKey: TabKey;
  kind: string;
  paneTree?: PaneNode;
};

export type PaneBudget = {
  current: number;
  added: number;
  projected: number;
  max: number;
  allowed: boolean;
};

export function terminalLeafCount(tab: PaneBudgetTab | undefined): number {
  return tab?.kind === "terminal" && tab.paneTree
    ? leafIds(tab.paneTree).length
    : 0;
}

export function visibleTerminalLeafCount(
  tabs: readonly PaneBudgetTab[],
  memberOrder: readonly TabKey[],
): number {
  const tabsByKey = new Map(tabs.map((tab) => [tab.tabKey, tab]));
  const seen = new Set<TabKey>();
  let count = 0;
  for (const tabKey of memberOrder) {
    if (seen.has(tabKey)) continue;
    seen.add(tabKey);
    count += terminalLeafCount(tabsByKey.get(tabKey));
  }
  return count;
}

export function projectPaneBudget(
  current: number,
  added: number,
  max = MAX_VISIBLE_TERMINAL_LEAVES,
): PaneBudget {
  const projected = current + Math.max(0, added);
  return {
    current,
    added: Math.max(0, added),
    projected,
    max,
    allowed: projected <= max,
  };
}

export function viewSpacePaneBudget(
  tabs: readonly PaneBudgetTab[],
  memberOrder: readonly TabKey[],
  max = MAX_VISIBLE_TERMINAL_LEAVES,
): PaneBudget {
  return projectPaneBudget(visibleTerminalLeafCount(tabs, memberOrder), 0, max);
}

export function tabAssignmentPaneBudget(
  tabs: readonly PaneBudgetTab[],
  memberOrder: readonly TabKey[],
  tabKey: TabKey,
  max = MAX_VISIBLE_TERMINAL_LEAVES,
): PaneBudget {
  const current = visibleTerminalLeafCount(tabs, memberOrder);
  const alreadyMember = memberOrder.includes(tabKey);
  const source = tabs.find((tab) => tab.tabKey === tabKey);
  return projectPaneBudget(
    current,
    alreadyMember ? 0 : terminalLeafCount(source),
    max,
  );
}
