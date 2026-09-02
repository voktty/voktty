export function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (
    from === to ||
    from < 0 ||
    to < 0 ||
    from >= items.length ||
    to >= items.length
  ) {
    return items;
  }
  const next = items.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export function orderByIds<T extends { id: string }>(
  items: T[],
  ids: string[],
): T[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const next: T[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    const item = byId.get(id);
    if (!item || seen.has(id)) continue;
    seen.add(id);
    next.push(item);
  }
  for (const item of items) {
    if (!seen.has(item.id)) next.push(item);
  }
  return next;
}
