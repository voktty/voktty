import type { Tab } from "@/modules/tabs";
import type { TabKey } from "@/modules/tabs/lib/tabIdentity";
import type { WorkspacePlacement } from "@/modules/spaces/lib/spaceGeometry";
import {
  terminalLeafCount,
  MAX_VISIBLE_TERMINAL_LEAVES,
} from "@/modules/spaces/lib/spacePaneBudget";

export type TerminalSurfaceRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};
export type TerminalSurfaceRequest = {
  tabKey: TabKey;
  ownerTabKey: TabKey;
  projectCwd: string;
  focused: boolean;
  rect: TerminalSurfaceRect | null;
  onFocus?: () => void;
  layoutKey?: string | number;
};
export type TerminalSurfaceEntry = Readonly<TerminalSurfaceRequest> & {
  readonly identity: object;
  isCurrent: () => boolean;
};
export type TerminalSurfaceSnapshot = {
  readonly root: TerminalSurfaceRect | null;
  readonly entries: readonly TerminalSurfaceEntry[];
};
export type TerminalSurfacePlacement = {
  rect: { x: number; y: number; width: number; height: number };
  focused: boolean;
  focus: () => void;
};

function validRect(rect: TerminalSurfaceRect) {
  return (
    Object.values(rect).every(Number.isFinite) &&
    Number.isFinite(rect.left + rect.width) &&
    Number.isFinite(rect.top + rect.height) &&
    rect.width >= 0 &&
    rect.height >= 0
  );
}
function sameRect(
  a: TerminalSurfaceRect | null,
  b: TerminalSurfaceRect | null,
) {
  return (
    a === b ||
    (a !== null &&
      b !== null &&
      a.left === b.left &&
      a.top === b.top &&
      a.width === b.width &&
      a.height === b.height)
  );
}
function checked(input: TerminalSurfaceRequest): TerminalSurfaceRequest {
  if (
    ![input.tabKey, input.ownerTabKey, input.projectCwd].every(
      (value) =>
        typeof value === "string" &&
        value.length > 0 &&
        value.length <= 32768 &&
        !/[\x00-\x1f\x7f]/.test(value),
    ) ||
    (input.rect && !validRect(input.rect))
  )
    throw new Error("Invalid terminal surface.");
  return {
    tabKey: input.tabKey,
    ownerTabKey: input.ownerTabKey,
    projectCwd: input.projectCwd,
    focused: input.focused === true,
    rect: input.rect ? Object.freeze({ ...input.rect }) : null,
    onFocus: input.onFocus,
    layoutKey: input.layoutKey,
  };
}

export function createTerminalSurfaces(limit = 256) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 256)
    throw new Error("Invalid terminal surface limit.");
  const entries = new Map<object, TerminalSurfaceEntry>();
  const listeners = new Set<() => void>();
  const entryFor = (value: TerminalSurfaceRequest, identity: object) => {
    const entry: TerminalSurfaceEntry = Object.freeze({
      ...value,
      identity,
      isCurrent: () => entries.get(identity) === entry,
    });
    return entry;
  };
  let snapshot: TerminalSurfaceSnapshot = { root: null, entries: [] };
  const publish = (root = snapshot.root) => {
    snapshot = Object.freeze({
      root,
      entries: Object.freeze([...entries.values()]),
    });
    for (const listener of listeners) listener();
  };
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setRoot: (root: TerminalSurfaceRect | null) => {
      if (root && !validRect(root))
        throw new Error("Invalid terminal surface bounds.");
      if (!sameRect(root, snapshot.root))
        publish(root && Object.freeze({ ...root }));
    },
    register: (input: TerminalSurfaceRequest) => {
      const value = checked(input);
      if (entries.size >= limit)
        throw new Error("Terminal surface limit reached.");
      const identity = {};
      const isCurrent = () => entries.has(identity);
      entries.set(identity, entryFor(value, identity));
      publish();
      return {
        isCurrent,
        update: (next: TerminalSurfaceRequest) => {
          if (!isCurrent()) return false;
          const value = checked(next);
          const old = entries.get(identity);
          if (
            old?.tabKey === value.tabKey &&
            old.ownerTabKey === value.ownerTabKey &&
            old.projectCwd === value.projectCwd &&
            old.focused === value.focused &&
            old.onFocus === value.onFocus &&
            old.layoutKey === value.layoutKey &&
            sameRect(old.rect, value.rect)
          )
            return true;
          entries.set(identity, entryFor(value, identity));
          publish();
          return true;
        },
        release: () => {
          if (entries.delete(identity)) publish();
        },
      };
    },
  };
}

function intersect(
  a: TerminalSurfaceRect,
  b: TerminalSurfaceRect,
): TerminalSurfaceRect | null {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.left + a.width, b.left + b.width);
  const bottom = Math.min(a.top + a.height, b.top + b.height);
  return right > left && bottom > top
    ? { left, top, width: right - left, height: bottom - top }
    : null;
}

export function selectTerminalSurfacePlacements(
  tabs: readonly Tab[],
  activeId: number,
  placements: ReadonlyMap<number, WorkspacePlacement> | undefined,
  snapshot: TerminalSurfaceSnapshot,
): ReadonlyMap<TabKey, TerminalSurfacePlacement> {
  const output = new Map<TabKey, TerminalSurfacePlacement>();
  const root = snapshot.root;
  if (!root || root.width <= 0 || root.height <= 0) return output;
  const byKey = new Map(tabs.map((tab) => [tab.tabKey, tab]));
  const visible = (tab: Tab) =>
    !tab.cold && (placements ? placements.has(tab.id) : tab.id === activeId);
  let leaves = tabs.reduce(
    (count, tab) => count + (visible(tab) ? terminalLeafCount(tab) : 0),
    0,
  );
  for (const entry of snapshot.entries) {
    const terminal = byKey.get(entry.tabKey);
    const owner = byKey.get(entry.ownerTabKey);
    if (
      !entry.isCurrent() ||
      !entry.rect ||
      terminal?.kind !== "terminal" ||
      terminal.cold ||
      terminal.collaboration ||
      terminal.private ||
      visible(terminal) ||
      output.has(terminal.tabKey) ||
      owner?.kind !== "harness" ||
      !visible(owner) ||
      terminal.projectCwd !== entry.projectCwd ||
      owner.cwd !== entry.projectCwd
    )
      continue;
    const ownerPlacement = placements?.get(owner.id);
    const ownerRect = ownerPlacement
      ? {
          left: root.left + ownerPlacement.rect.x * root.width,
          top: root.top + ownerPlacement.rect.y * root.height,
          width: ownerPlacement.rect.width * root.width,
          height: ownerPlacement.rect.height * root.height,
        }
      : root;
    const clipped = intersect(entry.rect, ownerRect);
    const rect = clipped && intersect(clipped, root);
    const added = terminalLeafCount(terminal);
    if (!rect || leaves + added > MAX_VISIBLE_TERMINAL_LEAVES) continue;
    leaves += added;
    output.set(terminal.tabKey, {
      rect: {
        x: (rect.left - root.left) / root.width,
        y: (rect.top - root.top) / root.height,
        width: rect.width / root.width,
        height: rect.height / root.height,
      },
      focused:
        entry.focused &&
        (ownerPlacement ? ownerPlacement.focused : owner.id === activeId),
      focus: () => {
        if (entry.isCurrent()) entry.onFocus?.();
      },
    });
  }
  return output;
}
