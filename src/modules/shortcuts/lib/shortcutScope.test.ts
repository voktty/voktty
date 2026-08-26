import { describe, expect, it } from "vitest";
import {
  isTerminalFocused,
  shouldDisablePaneSwapShortcut,
  shouldDisableShortcut,
} from "@/modules/shortcuts/lib/shortcutScope";

function makeTarget(classes: string[]) {
  const classList = new Set(classes);
  return {
    closest: (selector: string) => {
      const parts = selector.split(",").map((s) => s.trim().replace(/^\./, ""));
      return parts.some((p) => classList.has(p)) ? {} : null;
    },
  } as unknown as HTMLElement;
}

function makeKeyboardEvent(init?: {
  key?: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  target?: EventTarget | null;
}): KeyboardEvent {
  return {
    key: init?.key ?? "o",
    shiftKey: init?.shiftKey ?? false,
    ctrlKey: init?.ctrlKey ?? true,
    altKey: init?.altKey ?? false,
    metaKey: init?.metaKey ?? false,
    target: init?.target ?? null,
  } as unknown as KeyboardEvent;
}

describe("shortcutScope", () => {
  describe("shouldDisablePaneSwapShortcut", () => {
    it.each([
      "pane.swapLeft",
      "pane.swapRight",
      "pane.swapUp",
      "pane.swapDown",
    ] as const)("disables %s outside multi-pane terminals", (id) => {
      expect(shouldDisablePaneSwapShortcut(id, null)).toBe(true);
      expect(shouldDisablePaneSwapShortcut(id, 1)).toBe(true);
      expect(shouldDisablePaneSwapShortcut(id, 2)).toBe(false);
    });

    it("rejects unrelated shortcuts", () => {
      expect(shouldDisablePaneSwapShortcut("pane.focusNext", null)).toBe(false);
      expect(shouldDisablePaneSwapShortcut("editor.undo", 1)).toBe(false);
    });
  });

  describe("isTerminalFocused", () => {
    it("identifies elements inside xterm or helper textarea", () => {
      const termEl = makeTarget(["xterm-helper-textarea"]);
      expect(isTerminalFocused(termEl)).toBe(true);

      const outside = makeTarget(["sidebar", "button"]);
      expect(isTerminalFocused(outside)).toBe(false);
      expect(isTerminalFocused(null)).toBe(false);
    });
  });

  describe("shouldDisableShortcut - Terminal vs Outside Priority", () => {
    const termTarget = makeTarget(["xterm-helper-textarea"]);
    const outsideTarget = makeTarget(["sidebar-btn"]);

    it("disables editor.openFile (Ctrl+O) when inside terminal so nano/mc receive it", () => {
      const eventInTerm = makeKeyboardEvent({ key: "o", target: termTarget });
      expect(
        shouldDisableShortcut({
          id: "editor.openFile",
          event: eventInTerm,
          activeTabKind: "terminal",
          isMac: false,
        }),
      ).toBe(true);

      const eventOutside = makeKeyboardEvent({
        key: "o",
        target: outsideTarget,
      });
      expect(
        shouldDisableShortcut({
          id: "editor.openFile",
          event: eventOutside,
          activeTabKind: "terminal",
          isMac: false,
        }),
      ).toBe(false);
    });

    it("disables editor.openFolder (Ctrl+Shift+O) when inside terminal", () => {
      const eventInTerm = makeKeyboardEvent({
        key: "o",
        shiftKey: true,
        target: termTarget,
      });
      expect(
        shouldDisableShortcut({
          id: "editor.openFolder",
          event: eventInTerm,
          activeTabKind: "terminal",
        }),
      ).toBe(true);

      const eventOutside = makeKeyboardEvent({
        key: "o",
        shiftKey: true,
        target: outsideTarget,
      });
      expect(
        shouldDisableShortcut({
          id: "editor.openFolder",
          event: eventOutside,
          activeTabKind: "terminal",
        }),
      ).toBe(false);
    });

    it("disables editor text manipulation in non-editor tabs or when in terminal", () => {
      const eventInTerm = makeKeyboardEvent({ key: "z", target: termTarget });
      expect(
        shouldDisableShortcut({
          id: "editor.undo",
          event: eventInTerm,
          activeTabKind: "terminal",
        }),
      ).toBe(true);

      const eventInEditor = makeKeyboardEvent({
        key: "z",
        target: outsideTarget,
      });
      expect(
        shouldDisableShortcut({
          id: "editor.undo",
          event: eventInEditor,
          activeTabKind: "editor",
        }),
      ).toBe(false);

      expect(
        shouldDisableShortcut({
          id: "editor.navigateBack",
          event: eventInTerm,
          activeTabKind: "terminal",
        }),
      ).toBe(true);

      expect(
        shouldDisableShortcut({
          id: "editor.signatureHelp",
          event: eventInTerm,
          activeTabKind: "terminal",
        }),
      ).toBe(true);
      expect(
        shouldDisableShortcut({
          id: "editor.goToImplementation",
          event: eventInTerm,
          activeTabKind: "terminal",
        }),
      ).toBe(true);
      expect(
        shouldDisableShortcut({
          id: "editor.peekDefinition",
          event: eventInTerm,
          activeTabKind: "terminal",
        }),
      ).toBe(true);
    });

    it("prioritizes terminal interactive keys (Ctrl+R, Ctrl+E, Ctrl+G) on non-Mac platforms", () => {
      const eventR = makeKeyboardEvent({ key: "r", target: termTarget });
      expect(
        shouldDisableShortcut({
          id: "tab.newPrivate",
          event: eventR,
          activeTabKind: "terminal",
          isMac: false,
        }),
      ).toBe(true);

      const eventE = makeKeyboardEvent({ key: "e", target: termTarget });
      expect(
        shouldDisableShortcut({
          id: "tab.newEditor",
          event: eventE,
          activeTabKind: "terminal",
          isMac: false,
        }),
      ).toBe(true);

      const eventG = makeKeyboardEvent({ key: "g", target: termTarget });
      expect(
        shouldDisableShortcut({
          id: "pane.source",
          event: eventG,
          activeTabKind: "terminal",
          isMac: false,
        }),
      ).toBe(true);
    });

    it("allows sidebar.toggle with shift inside terminal, but yields plain Ctrl+B", () => {
      const plainB = makeKeyboardEvent({ key: "b", target: termTarget });
      expect(
        shouldDisableShortcut({
          id: "sidebar.toggle",
          event: plainB,
          activeTabKind: "terminal",
        }),
      ).toBe(true);

      const shiftB = makeKeyboardEvent({
        key: "b",
        shiftKey: true,
        target: termTarget,
      });
      expect(
        shouldDisableShortcut({
          id: "sidebar.toggle",
          event: shiftB,
          activeTabKind: "terminal",
        }),
      ).toBe(false);
    });
  });
});
