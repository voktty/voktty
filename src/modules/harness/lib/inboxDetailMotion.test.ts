import { describe, expect, it } from "vitest";
import {
  createInboxDetailMotionState,
  inboxDetailMotionReducer,
} from "./inboxDetailMotion";

describe("inbox detail panel motion", () => {
  it("does not replay the content reveal for the same selection", () => {
    const state = createInboxDetailMotionState("github:pr:42");

    expect(
      inboxDetailMotionReducer(state, {
        type: "select",
        itemKey: "github:pr:42",
      }),
    ).toBe(state);
  });

  it("reveals a newly selected item and ignores completion from an older one", () => {
    const initial = createInboxDetailMotionState("github:pr:42");
    const selected = inboxDetailMotionReducer(initial, {
      type: "select",
      itemKey: "github:issue:43",
    });

    expect(selected).toEqual({
      itemKey: "github:issue:43",
      revealKey: "github:issue:43",
    });
    expect(
      inboxDetailMotionReducer(selected, {
        type: "reveal-finished",
        itemKey: "github:pr:42",
      }),
    ).toBe(selected);
    expect(
      inboxDetailMotionReducer(selected, {
        type: "reveal-finished",
        itemKey: "github:issue:43",
      }),
    ).toEqual({ itemKey: "github:issue:43", revealKey: null });
  });

  it("clears a pending reveal when the selection is removed", () => {
    const pending = inboxDetailMotionReducer(
      createInboxDetailMotionState(null),
      { type: "select", itemKey: "github:pr:42" },
    );

    expect(
      inboxDetailMotionReducer(pending, { type: "select", itemKey: null }),
    ).toEqual({ itemKey: null, revealKey: null });
  });
});
