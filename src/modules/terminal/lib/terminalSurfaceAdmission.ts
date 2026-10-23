import type { Tab } from "@/modules/tabs";
import type { TabKey } from "@/modules/tabs/lib/tabIdentity";
import type { WorkspacePlacement } from "@/modules/spaces/lib/spaceGeometry";
import {
  terminalLeafCount,
  MAX_VISIBLE_TERMINAL_LEAVES,
} from "@/modules/spaces/lib/spacePaneBudget";
import {
  terminalSurfaceReferences,
  type TerminalSurfaceEntry,
} from "@/modules/terminal/lib/terminalSurfaceLayout";

export type TerminalSurfaceIntent = {
  ownerTabKey: TabKey;
  projectCwd: string;
  slotKey: string;
};
export type TerminalAdmissionState = {
  tabs: readonly Tab[];
  activeId: number;
  placements?: ReadonlyMap<number, WorkspacePlacement>;
  entries: readonly TerminalSurfaceEntry[];
};

function members(
  state: TerminalAdmissionState,
  intent?: TerminalSurfaceIntent,
  bound?: TabKey,
) {
  const keys = new Set<TabKey>();
  for (const tab of state.tabs)
    if (
      tab.kind === "terminal" &&
      tab.tabKey !== bound &&
      (state.placements
        ? state.placements.has(tab.id)
        : tab.id === state.activeId)
    )
      keys.add(tab.tabKey);
  for (const { entry, terminal } of terminalSurfaceReferences(
    state.tabs,
    state.activeId,
    state.placements,
    state.entries,
  )) {
    if (
      terminal.tabKey === bound ||
      (intent &&
        entry.ownerTabKey === intent.ownerTabKey &&
        entry.slotKey === intent.slotKey)
    )
      continue;
    keys.add(terminal.tabKey);
  }
  return keys;
}

export function createTerminalSurfaceAdmission(
  read: () => TerminalAdmissionState,
  onCollected?: () => void,
) {
  type Hold = TerminalSurfaceIntent & {
    retired: boolean;
    settled: boolean;
    bound?: TabKey;
    finish: () => void;
  };
  const holds = new Set<Hold>();
  let live = true;
  const ownerCurrent = (
    state: TerminalAdmissionState,
    intent: TerminalSurfaceIntent,
  ) => {
    const owner = state.tabs.find((tab) => tab.tabKey === intent.ownerTabKey);
    return (
      owner?.kind === "harness" &&
      !owner.cold &&
      owner.cwd === intent.projectCwd &&
      (state.placements
        ? state.placements.has(owner.id)
        : owner.id === state.activeId)
    );
  };
  const allowed = (hold: Hold) => {
    const state = read();
    if (!live || hold.retired || !holds.has(hold) || !ownerCurrent(state, hold))
      return false;
    const visible = members(state);
    const projected = members(state, hold, hold.bound);
    let leaves = state.tabs.reduce(
      (count, tab) =>
        count + (projected.has(tab.tabKey) ? terminalLeafCount(tab) : 0),
      0,
    );
    for (const other of holds)
      if (other !== hold && (!other.bound || !visible.has(other.bound)))
        leaves++;
    const bound = state.tabs.find((tab) => tab.tabKey === hold.bound);
    leaves += Math.max(1, terminalLeafCount(bound));
    return leaves <= MAX_VISIBLE_TERMINAL_LEAVES;
  };
  const collect = () => {
    const state = read();
    const visible = members(state);
    let collected = false;
    for (const hold of holds) {
      if (
        hold.settled &&
        (hold.retired ||
          !ownerCurrent(state, hold) ||
          !hold.bound ||
          !state.tabs.some((tab) => tab.tabKey === hold.bound) ||
          visible.has(hold.bound))
      ) {
        hold.retired = true;
        holds.delete(hold);
        hold.finish();
        collected = true;
      }
    }
    if (collected) onCollected?.();
  };
  return {
    activationTargets: (tabs?: readonly Tab[]) => {
      if (!live) return [];
      const state = { ...read(), ...(tabs ? { tabs } : {}) };
      const references = terminalSurfaceReferences(
        state.tabs,
        state.activeId,
        state.placements,
        state.entries,
      );
      const occupied = new Set<TabKey>();
      for (const tab of state.tabs)
        if (
          state.placements
            ? state.placements.has(tab.id)
            : tab.id === state.activeId
        )
          occupied.add(tab.tabKey);
      for (const { terminal } of references)
        if (!terminal.cold) occupied.add(terminal.tabKey);
      let leaves = state.tabs.reduce(
        (count, tab) =>
          count + (occupied.has(tab.tabKey) ? terminalLeafCount(tab) : 0),
        0,
      );
      const referenced = members(state);
      for (const hold of holds)
        if (!hold.bound || !referenced.has(hold.bound)) leaves++;
      const output = [];
      for (const candidate of references) {
        const { terminal } = candidate;
        if (!terminal.cold || occupied.has(terminal.tabKey)) continue;
        const added = terminalLeafCount(terminal);
        if (leaves + added > MAX_VISIBLE_TERMINAL_LEAVES) continue;
        leaves += added;
        occupied.add(terminal.tabKey);
        output.push(candidate);
      }
      return output;
    },
    reserve: (input: TerminalSurfaceIntent) => {
      collect();
      const intent = { ...input };
      if (
        !live ||
        holds.size >= 256 ||
        ![intent.ownerTabKey, intent.projectCwd, intent.slotKey].every(
          (value) =>
            typeof value === "string" &&
            value.length > 0 &&
            value.length <= 32768 &&
            !/[\x00-\x1f\x7f]/.test(value),
        )
      )
        return undefined;
      if (
        [...holds].some(
          (hold) =>
            hold.ownerTabKey === intent.ownerTabKey &&
            hold.slotKey === intent.slotKey,
        )
      )
        return undefined;
      let finish = () => {};
      const done = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const hold: Hold = { ...intent, retired: false, settled: false, finish };
      holds.add(hold);
      if (!allowed(hold)) {
        holds.delete(hold);
        return undefined;
      }
      const isCurrent = () => {
        if (allowed(hold)) return true;
        hold.retired = true;
        return false;
      };
      return {
        done,
        isCurrent,
        bind: (tabKey: TabKey) => {
          if (!isCurrent() || hold.bound) return false;
          hold.bound = tabKey;
          return true;
        },
        retire: () => {
          hold.retired = true;
          collect();
        },
        // Native settlement precedes lazy surface registration. Keep its leaf reserved
        // until presentation takes ownership or the owning view is retired.
        release: () => {
          hold.settled = true;
          collect();
        },
      };
    },
    resume: () => {
      live = true;
    },
    revalidate: () => {
      collect();
      let changed = false;
      for (const hold of holds)
        if (!hold.retired && !allowed(hold)) {
          hold.retired = true;
          changed = true;
        }
      collect();
      return changed;
    },
    retire: () => {
      live = false;
      for (const hold of holds) hold.retired = true;
      collect();
    },
    size: () => holds.size,
  };
}
