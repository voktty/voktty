import { describe, expect, it } from "vitest";
import {
  adjacentItemId,
  shouldHandleListNavigation,
  tabCommand,
} from "./tabKeys";

function key(
  partial: Partial<
    Pick<
      KeyboardEvent,
      | "key"
      | "code"
      | "metaKey"
      | "ctrlKey"
      | "altKey"
      | "shiftKey"
      | "isComposing"
    >
  >,
): KeyboardEvent {
  return {
    isComposing: false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    key: "",
    code: "",
    ...partial,
  } as KeyboardEvent;
}

describe("tabCommand", () => {
  it("opens a terminal pane with cmd-backtick", () => {
    expect(tabCommand(key({ key: "`", code: "Backquote", metaKey: true }))).toBe(
      "new-terminal",
    );
  });

  it("opens a terminal workspace tab with shift-cmd-backtick", () => {
    expect(
      tabCommand(
        key({ key: "~", code: "Backquote", metaKey: true, shiftKey: true }),
      ),
    ).toBe("new-terminal-tab");
  });

  it("keeps existing tab chrome bindings", () => {
    expect(tabCommand(key({ key: "t", metaKey: true }))).toBe("new");
    expect(tabCommand(key({ key: "d", metaKey: true }))).toBe("split-right");
    expect(tabCommand(key({ key: "j", metaKey: true }))).toBe(
      "toggle-terminal",
    );
  });

  it("walks tab visit history with cmd-brackets", () => {
    expect(
      tabCommand(key({ key: "[", code: "BracketLeft", metaKey: true })),
    ).toBe("back");
    expect(
      tabCommand(key({ key: "]", code: "BracketRight", metaKey: true })),
    ).toBe("forward");
  });

  it("keeps shift-cmd-brackets as adjacent tab cycle", () => {
    expect(
      tabCommand(
        key({ key: "{", code: "BracketLeft", metaKey: true, shiftKey: true }),
      ),
    ).toBe("prev");
    expect(
      tabCommand(
        key({ key: "}", code: "BracketRight", metaKey: true, shiftKey: true }),
      ),
    ).toBe("next");
  });

  it("uses shift-mod arrows for session and project navigation", () => {
    expect(
      tabCommand(key({ key: "ArrowUp", metaKey: true, shiftKey: true })),
    ).toBe("prev-session");
    expect(
      tabCommand(key({ key: "ArrowDown", metaKey: true, shiftKey: true })),
    ).toBe("next-session");
    expect(
      tabCommand(key({ key: "ArrowLeft", metaKey: true, shiftKey: true })),
    ).toBe("prev-project");
    expect(
      tabCommand(key({ key: "ArrowRight", metaKey: true, shiftKey: true })),
    ).toBe("next-project");
  });

  it("cycles ordered item ids and wraps at both ends", () => {
    expect(adjacentItemId(["a", "b", "c"], "b", 1)).toBe("c");
    expect(adjacentItemId(["a", "b", "c"], "c", 1)).toBe("a");
    expect(adjacentItemId(["a", "b", "c"], "a", -1)).toBe("c");
    expect(adjacentItemId(["a", "b", "c"], "missing", 1)).toBe("a");
    expect(adjacentItemId(["a", "b", "c"], "missing", -1)).toBe("c");
    expect(adjacentItemId([], "a", 1)).toBeNull();
  });

  it("blocks list navigation while another text or app surface owns focus", () => {
    expect(
      shouldHandleListNavigation({ blockedTarget: false, surfaceOpen: false }),
    ).toBe(true);
    expect(
      shouldHandleListNavigation({ blockedTarget: true, surfaceOpen: false }),
    ).toBe(false);
    expect(
      shouldHandleListNavigation({ blockedTarget: false, surfaceOpen: true }),
    ).toBe(false);
  });
});
