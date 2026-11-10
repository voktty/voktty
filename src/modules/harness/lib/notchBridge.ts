import type { LiveAgent } from "./liveAgents";
import type { Block, Session } from "./session";

/** Main window -> notch overlay: what the overlay should draw. */
export const NOTCH_STATE_EVENT = "voktty:notch-state";
/** Notch overlay -> main window: the overlay finished loading and wants state. */
export const NOTCH_READY_EVENT = "voktty:notch-ready";
/** Notch overlay -> main window: the user did something in the overlay. */
export const NOTCH_ACTION_EVENT = "voktty:notch-action";

export type NotchSnapshot = {
  liveAgents: LiveAgent[];
  sessions: Session[];
};

export type NotchAction =
  | { kind: "open"; cwd: string }
  | {
      kind: "approval";
      sessionId: string;
      approvalId: number;
      decision: "allow" | "deny";
    };

const MAX_BLOCKS_PER_SESSION = 24;
const MAX_TEXT_LENGTH = 2000;

export type NotchVisibilityInput = {
  enabled: boolean;
  appFocused: boolean;
};

/**
 * The overlay is a utility for watching agents while Voktty is not the
 * foreground app (minimised or behind another window). Inside Voktty the
 * Harness already shows everything, so the window is absent whenever the main
 * window has focus. While present it rests as a thin hover strip and reveals
 * the notch by itself on activity.
 */
export function shouldShowNotchOverlay({
  enabled,
  appFocused,
}: NotchVisibilityInput): boolean {
  return enabled && !appFocused;
}

function trimBlock(block: Block): Block {
  return block.text.length > MAX_TEXT_LENGTH
    ? { ...block, text: block.text.slice(0, MAX_TEXT_LENGTH) }
    : block;
}

/**
 * Event payloads are serialised as JSON on every change, so the overlay only
 * gets the sessions it can show, with a bounded tail of short blocks.
 */
export function snapshotForOverlay(
  liveAgents: readonly LiveAgent[],
  sessions: readonly Session[],
): NotchSnapshot {
  const ids = new Set(liveAgents.map((agent) => agent.id));
  return {
    liveAgents: [...liveAgents],
    sessions: sessions
      .filter((session) => ids.has(session.id))
      .map(
        (session): Session => ({
          id: session.id,
          harness: session.harness,
          model: session.model,
          modelSettings: {},
          runtimeMode: session.runtimeMode,
          title: session.title,
          cwd: session.cwd,
          busy: session.busy,
          blocks: session.blocks.slice(-MAX_BLOCKS_PER_SESSION).map(trimBlock),
        }),
      ),
  };
}
