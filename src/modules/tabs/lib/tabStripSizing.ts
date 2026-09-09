export const TAB_STRIP_GAP_PX = 2;

function usedWidth(
  indices: readonly number[],
  widths: readonly number[],
): number {
  return indices.reduce(
    (total, index, position) =>
      total + widths[index] + (position === 0 ? 0 : TAB_STRIP_GAP_PX),
    0,
  );
}

export function fitTabStripItems(
  widths: readonly number[],
  availableWidth: number,
  activeIndex: number,
): number[] {
  if (availableWidth <= 0 || widths.length === 0) return [];

  const visible: number[] = [];
  let occupied = 0;
  for (let index = 0; index < widths.length; index += 1) {
    const width = Math.max(0, widths[index]);
    const nextWidth =
      occupied + width + (visible.length === 0 ? 0 : TAB_STRIP_GAP_PX);
    if (nextWidth > availableWidth) break;
    visible.push(index);
    occupied = nextWidth;
  }

  if (
    activeIndex < 0 ||
    activeIndex >= widths.length ||
    visible.includes(activeIndex) ||
    widths[activeIndex] > availableWidth
  ) {
    return visible;
  }

  while (
    visible.length > 0 &&
    usedWidth([...visible, activeIndex], widths) > availableWidth
  ) {
    visible.pop();
  }

  return [...visible, activeIndex];
}

export function originalGapForFittedItems<T>(
  allItems: readonly T[],
  fittedItems: readonly T[],
  fittedGap: number,
): number {
  if (fittedGap <= 0) return 0;
  const previous = fittedItems[Math.min(fittedGap, fittedItems.length) - 1];
  const previousIndex = allItems.indexOf(previous);
  return previousIndex < 0 ? 0 : previousIndex + 1;
}
