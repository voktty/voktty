export const TAB_PREFERRED_WIDTH_PX = 220;

const NEW_TAB_CONTROL_WIDTH_PX = 26;
const OVERFLOW_CONTROL_WIDTH_PX = 40;
const STRIP_GAP_PX = 2;

/**
 * Returns the ideal width of the horizontal tab group. Flexbox may shrink the
 * group below this value, but it should not grow beyond the width its tabs can
 * actually use. This keeps trailing controls beside the final tab.
 */
export function preferredTabBarWidth(
  itemCount: number,
  showOverflowControl: boolean,
): number {
  const normalizedItemCount = Math.max(0, Math.trunc(itemCount));
  const controlCount = showOverflowControl ? 2 : 1;
  const controlsWidth =
    NEW_TAB_CONTROL_WIDTH_PX +
    (showOverflowControl ? OVERFLOW_CONTROL_WIDTH_PX : 0);
  // The Tabs root remains in the outer flex row even when it has no items, so
  // there is always one gap before the first trailing control.
  const gapCount = Math.max(
    controlCount,
    normalizedItemCount + controlCount - 1,
  );

  return (
    normalizedItemCount * TAB_PREFERRED_WIDTH_PX +
    controlsWidth +
    gapCount * STRIP_GAP_PX
  );
}
