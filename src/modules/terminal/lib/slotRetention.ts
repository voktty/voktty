/**
 * Renderer-slot retention policy.
 *
 * Switching to a terminal is only instant when its slot is still warm: the
 * xterm instance alive with its buffer, and its WebGL context still attached.
 * Rebuilding either one costs a snapshot replay and a GPU context creation on
 * the frame the user is waiting for, and on integrated graphics the context is
 * the more expensive half.
 *
 * The policy is therefore driven by state, not by elapsed time. A slot is not
 * released because the user took a break; it is released because something
 * else needs the resource. That keeps the cost proportional to how many
 * terminals are actually in use, which is predictable, instead of to how long
 * ago they were touched, which is not.
 */

/** xterm stores four Uint32 per cell (content, fg, bg, extended). */
export const BYTES_PER_CELL = 16;

/**
 * Ceiling on buffers held for leaves that are not currently rendered. Sized so
 * a full pool at the default scrollback stays far below it, while a user who
 * raises scrollback to the 50k maximum still cannot pin hundreds of megabytes.
 */
export const MAX_RETAINED_BUFFER_BYTES = 192 * 1024 * 1024;

/**
 * Live WebGL contexts allowed at once. A composite space renders at most eight
 * leaves, so every bound slot always fits; the ninth pool slot is by
 * construction never bound and is the first to give its context up.
 */
export const MAX_WEBGL_CONTEXTS = 8;

/** Truly empty slots (no buffer to lose) kept allocated for the next spawn. */
export const IDLE_SLOTS_KEEP_WARM = 1;

export type RetentionSlot = {
  id: number;
  /** Non-null while the slot renders a leaf. */
  currentLeafId: number | null;
  /** Non-null while the slot still holds a released leaf's buffer intact. */
  retainedLeafId: number | null;
  /** display:none, so xterm has paused rendering even though it stays bound. */
  parked: boolean;
  lastUsedAt: number;
  /** buffer.active.length * cols */
  bufferCells: number;
  hasWebgl: boolean;
};

function isBound(slot: RetentionSlot): boolean {
  return slot.currentLeafId !== null;
}

/** Bound and actually painting: the only slots whose context is in use now. */
function isRendering(slot: RetentionSlot): boolean {
  return isBound(slot) && !slot.parked;
}

function isRetaining(slot: RetentionSlot): boolean {
  return !isBound(slot) && slot.retainedLeafId !== null;
}

function isEmpty(slot: RetentionSlot): boolean {
  return !isBound(slot) && slot.retainedLeafId === null;
}

function oldestFirst(a: RetentionSlot, b: RetentionSlot): number {
  return a.lastUsedAt - b.lastUsedAt;
}

/**
 * Slots to dispose entirely.
 *
 * A bound slot is never disposed. A retaining slot is disposed only to bring
 * total retained buffer memory back under budget, because disposing it forces
 * the next switch to that leaf to replay a serialized snapshot. Empty slots
 * beyond `keepWarm` are free to drop.
 */
export function planSlotReap(
  slots: readonly RetentionSlot[],
  options: {
    keepWarm?: number;
    maxRetainedBytes?: number;
  } = {},
): number[] {
  const keepWarm = options.keepWarm ?? IDLE_SLOTS_KEEP_WARM;
  const maxRetainedBytes =
    options.maxRetainedBytes ?? MAX_RETAINED_BUFFER_BYTES;

  const doomed: number[] = [];

  const empty = slots.filter(isEmpty).sort(oldestFirst);
  for (const slot of empty.slice(0, Math.max(0, empty.length - keepWarm))) {
    doomed.push(slot.id);
  }

  const retaining = slots.filter(isRetaining).sort(oldestFirst);
  let retainedBytes = retaining.reduce(
    (total, slot) => total + slot.bufferCells * BYTES_PER_CELL,
    0,
  );
  for (const slot of retaining) {
    if (retainedBytes <= maxRetainedBytes) break;
    doomed.push(slot.id);
    retainedBytes -= slot.bufferCells * BYTES_PER_CELL;
  }

  return doomed;
}

/**
 * Slots that must give up their WebGL context so the page stays under the
 * context ceiling. A slot that is painting right now always keeps its
 * context; the rest are ranked by recency, so the terminals a user alternates
 * between never lose theirs.
 */
export function planWebglRelease(
  slots: readonly RetentionSlot[],
  maxContexts: number = MAX_WEBGL_CONTEXTS,
): number[] {
  const withContext = slots.filter((slot) => slot.hasWebgl);
  if (withContext.length <= maxContexts) return [];

  const ranked = [...withContext].sort((a, b) => {
    const renderingDelta = Number(isRendering(b)) - Number(isRendering(a));
    if (renderingDelta !== 0) return renderingDelta;
    return b.lastUsedAt - a.lastUsedAt;
  });

  return ranked.slice(maxContexts).map((slot) => slot.id);
}
