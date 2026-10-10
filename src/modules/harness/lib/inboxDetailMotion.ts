export type InboxDetailMotionState = {
  itemKey: string | null;
  revealKey: string | null;
};

export type InboxDetailMotionAction =
  | { type: "select"; itemKey: string | null }
  | { type: "reveal-finished"; itemKey: string };

export function createInboxDetailMotionState(
  itemKey: string | null,
): InboxDetailMotionState {
  return { itemKey, revealKey: null };
}

export function inboxDetailMotionReducer(
  state: InboxDetailMotionState,
  action: InboxDetailMotionAction,
): InboxDetailMotionState {
  if (action.type === "select") {
    if (state.itemKey === action.itemKey) return state;
    return { itemKey: action.itemKey, revealKey: action.itemKey };
  }

  if (state.revealKey !== action.itemKey) return state;
  return { ...state, revealKey: null };
}
