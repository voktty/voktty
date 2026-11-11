/**
 * Opacity of each surface over the native window backdrop, from the single
 * "surface opacity" setting.
 *
 * Chrome is one layer: the frame carries the whole opacity and the sidebar,
 * toolbars and canvas sit on it transparent, so the sidebar and the centre
 * read as the same material at any setting. Raised surfaces (cards, the
 * composer) add a little on top so they stay distinct, and menus keep a
 * floor so text over a busy desktop is always legible.
 */
export type SurfaceAlphas = {
  frame: number;
  card: number;
  popover: number;
  activeItem: number;
};

/** Below this, text in menus and dialogs washes out over a busy desktop. */
export const POPOVER_MIN_ALPHA = 0.92;
const CARD_LIFT = 0.12;
const CARD_MIN_ALPHA = 0.35;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(1, Math.max(0, value));
}

export function surfaceAlphas(opacity: number): SurfaceAlphas {
  const frame = clamp01(opacity);
  return {
    frame,
    card: Math.min(1, Math.max(CARD_MIN_ALPHA, frame + CARD_LIFT)),
    popover: Math.max(POPOVER_MIN_ALPHA, frame),
    activeItem: Math.min(1, Math.max(0.5, frame)),
  };
}
