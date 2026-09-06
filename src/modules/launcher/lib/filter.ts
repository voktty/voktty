import { fuzzyBest } from "@/modules/command-palette/lib/fuzzy";
import { mruRank, mruSnapshot } from "@/modules/command-palette/lib/mru";
import { LAUNCHER_GROUPS, type LauncherItem } from "../types";

export type LauncherSection = {
  group: LauncherItem["group"];
  items: LauncherItem[];
};

const GROUP_ORDER = new Map(LAUNCHER_GROUPS.map((g, i) => [g, i]));

/** Ranks by fuzzy score first and recency second, so a typed query always wins
 * over habit while an empty query still surfaces what you actually use. */
export function filterLauncherItems(
  items: readonly LauncherItem[],
  query: string,
): LauncherItem[] {
  const q = query.trim();
  const mru = mruSnapshot();

  if (!q) {
    return [...items].sort((a, b) => {
      const rank = mruRank(mru, b.id) - mruRank(mru, a.id);
      if (rank !== 0) return rank;
      const group =
        (GROUP_ORDER.get(a.group) ?? 0) - (GROUP_ORDER.get(b.group) ?? 0);
      if (group !== 0) return group;
      return a.title.localeCompare(b.title);
    });
  }

  const scored: { item: LauncherItem; score: number }[] = [];
  for (const item of items) {
    const score = fuzzyBest(q, [item.title, ...(item.keywords ?? [])]);
    if (score === null) continue;
    scored.push({ item, score });
  }
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return mruRank(mru, b.item.id) - mruRank(mru, a.item.id);
  });
  return scored.map((s) => s.item);
}

/** Group headers are only useful while browsing. Once a query narrows the set,
 * a single flat grid reads faster than six one-item sections. */
export function groupLauncherItems(
  items: readonly LauncherItem[],
): LauncherSection[] {
  const byGroup = new Map<LauncherItem["group"], LauncherItem[]>();
  for (const item of items) {
    const bucket = byGroup.get(item.group);
    if (bucket) bucket.push(item);
    else byGroup.set(item.group, [item]);
  }
  return LAUNCHER_GROUPS.filter((g) => byGroup.has(g)).map((group) => ({
    group,
    items: byGroup.get(group) ?? [],
  }));
}
