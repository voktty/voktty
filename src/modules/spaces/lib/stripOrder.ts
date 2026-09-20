import type { TabKey } from "@/modules/tabs/lib/tabIdentity";
import type { StripEntry } from "./spaceProjection";
import type { ViewSpaceId } from "./spaceLayout";

/**
 * Ordering of the tab strip.
 *
 * The strip is a list of entries, and an entry is either a standalone tab or a
 * whole space. Reordering has to move the entry, not the projected items it
 * renders as: an expanded space contributes one item per member, so a gap
 * measured in items does not address the entry list directly.
 *
 * The previous implementation permuted standalone entries among themselves and
 * left every other entry pinned where it was, which is why a space could not
 * be moved at all.
 */

/** Stable identity of a strip entry, independent of its position. */
export type StripEntryId = string;

export function stripEntryId(entry: StripEntry): StripEntryId {
  return entry.kind === "standalone"
    ? `standalone:${entry.tabKey}`
    : `space:${entry.spaceId}`;
}

export function standaloneEntryId(tabKey: TabKey): StripEntryId {
  return `standalone:${tabKey}`;
}

export function spaceEntryId(spaceId: ViewSpaceId): StripEntryId {
  return `space:${spaceId}`;
}

/**
 * Converts a gap between rendered items into a gap between entries.
 *
 * `itemOwners` is the owning entry of each rendered item, in render order. A
 * gap that falls inside an expanded space resolves to the boundary of that
 * space, because half a space cannot be an insertion point.
 */
export function entryGapFromItemGap(
  itemOwners: readonly StripEntryId[],
  itemGap: number,
): number {
  const bounded = Math.max(0, Math.min(itemGap, itemOwners.length));
  const seen: StripEntryId[] = [];
  for (const owner of itemOwners.slice(0, bounded)) {
    if (seen[seen.length - 1] !== owner) seen.push(owner);
  }
  // A gap landing mid-space belongs before it, not inside it.
  const last = seen[seen.length - 1];
  if (last !== undefined && itemOwners[bounded] === last) seen.pop();
  return seen.length;
}

/**
 * Moves one entry to a gap in the entry list. Returns the same array when the
 * move is a no-op, so callers can skip a state write.
 */
export function reorderStripEntries(
  entries: readonly StripEntry[],
  sourceId: StripEntryId,
  toEntryGap: number,
): StripEntry[] {
  const fromIndex = entries.findIndex(
    (entry) => stripEntryId(entry) === sourceId,
  );
  if (fromIndex === -1) return [...entries];

  const bounded = Math.max(0, Math.min(toEntryGap, entries.length));
  const next = [...entries];
  const [moved] = next.splice(fromIndex, 1);
  if (!moved) return [...entries];
  const insertIndex = bounded > fromIndex ? bounded - 1 : bounded;
  next.splice(insertIndex, 0, moved);

  // Same length by construction: one entry removed and reinserted.
  const before = entries.map(stripEntryId);
  const unchanged = next.every(
    (entry, index) => stripEntryId(entry) === before[index],
  );
  return unchanged ? [...entries] : next;
}
