import { describe, expect, it } from "vitest";
import {
  canRecordShortcut,
  getBindingTokens,
  type KeyBinding,
  matchBinding,
  SHORTCUTS,
  type ShortcutId,
} from "./shortcuts";

// These tests run in the vitest node environment, where the Tauri OS plugin is
// unavailable so `IS_MAC` resolves to false. That makes the non-mac token
// branch deterministic across host platforms.

function event(over: Partial<KeyboardEvent>): KeyboardEvent {
  return {
    key: "",
    code: "",
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    ...over,
  } as KeyboardEvent;
}

describe("getBindingTokens", () => {
  it("returns nothing for an undefined binding", () => {
    expect(getBindingTokens(undefined)).toEqual([]);
  });

  it("lists modifiers in order, then the key", () => {
    const binding: KeyBinding = { key: "k", ctrl: true, shift: true };
    expect(getBindingTokens(binding)).toEqual(["Ctrl", "Shift", "K"]);
  });

  it("labels space and arrow keys", () => {
    expect(getBindingTokens({ key: " ", meta: true })).toEqual([
      "Win",
      "Space",
    ]);
    expect(getBindingTokens({ key: "ArrowUp", alt: true })).toEqual([
      "Alt",
      "↑",
    ]);
  });

  it("uppercases a single-character key", () => {
    expect(getBindingTokens({ key: "c" })).toEqual(["C"]);
  });
});

describe("canRecordShortcut", () => {
  it("accepts standalone function keys for configurable F1-style commands", () => {
    expect(canRecordShortcut({ key: "F1" })).toBe(true);
    expect(canRecordShortcut({ key: "F24" })).toBe(true);
  });

  it("still rejects unmodified typing and navigation keys", () => {
    expect(canRecordShortcut({ key: "a" })).toBe(false);
    expect(canRecordShortcut({ key: "ArrowLeft" })).toBe(false);
    expect(canRecordShortcut({ key: "a", shift: true })).toBe(false);
    expect(canRecordShortcut({ key: "a", ctrl: true })).toBe(true);
  });
});

describe("matchBinding", () => {
  it("matches when key and all modifiers agree", () => {
    expect(
      matchBinding(event({ key: "c", ctrlKey: true }), {
        key: "c",
        ctrl: true,
      }),
    ).toBe(true);
  });

  it("matches the key case-insensitively", () => {
    expect(
      matchBinding(event({ key: "C", ctrlKey: true }), {
        key: "c",
        ctrl: true,
      }),
    ).toBe(true);
  });

  it("fails when a required modifier is missing", () => {
    expect(matchBinding(event({ key: "c" }), { key: "c", ctrl: true })).toBe(
      false,
    );
  });

  it("fails when an extra modifier is pressed", () => {
    expect(
      matchBinding(event({ key: "c", ctrlKey: true, shiftKey: true }), {
        key: "c",
        ctrl: true,
      }),
    ).toBe(false);
  });

  it("falls back to the physical code for alt combinations", () => {
    // Alt often rewrites e.key (here to "ç"); the binding still matches via e.code.
    expect(
      matchBinding(event({ key: "ç", code: "KeyC", altKey: true }), {
        key: "c",
        alt: true,
      }),
    ).toBe(true);
    expect(
      matchBinding(event({ key: "ç", code: "KeyD", altKey: true }), {
        key: "c",
        alt: true,
      }),
    ).toBe(false);
  });

  it("falls back to the physical code for shift combinations", () => {
    // Shift turns Period into ">"; ⌘⇧. still matches the "." binding.
    expect(
      matchBinding(
        event({ key: ">", code: "Period", shiftKey: true, metaKey: true }),
        { key: ".", shift: true, meta: true },
      ),
    ).toBe(true);
    expect(
      matchBinding(
        event({ key: ">", code: "Comma", shiftKey: true, metaKey: true }),
        { key: ".", shift: true, meta: true },
      ),
    ).toBe(false);
  });

  it("does not fall back to the physical code without alt or shift", () => {
    expect(
      matchBinding(event({ key: "ç", code: "KeyC", metaKey: true }), {
        key: "c",
        meta: true,
      }),
    ).toBe(false);
  });

  it("only accepts digit keys for the jump-to-tab shortcut", () => {
    expect(
      matchBinding(event({ key: "3" }), { key: "1" }, "tab.selectByIndex"),
    ).toBe(true);
    expect(
      matchBinding(event({ key: "x" }), { key: "1" }, "tab.selectByIndex"),
    ).toBe(false);
  });
});

describe("IDE shortcut defaults", () => {
  function bindings(id: ShortcutId): KeyBinding[] {
    return (
      SHORTCUTS.find((shortcut) => shortcut.id === id)?.defaultBindings ?? []
    );
  }

  it("opens commands on F1 and workspace files on Mod+P", () => {
    expect(bindings("file.quickOpen")).toEqual([{ ctrl: true, key: "p" }]);
    expect(bindings("tabs.launchpad")).toEqual([]);
    expect(bindings("commandPalette.open")).toEqual([{ key: "F1" }]);
  });

  it("reserves Mod+G for editor go to line", () => {
    expect(bindings("editor.gotoLine")).toEqual([{ ctrl: true, key: "g" }]);
    expect(bindings("pane.source")).toEqual([
      { ctrl: true, shift: true, key: "g" },
    ]);
  });

  it("opens workspace content search with Mod+Shift+F", () => {
    expect(bindings("commandPalette.content")).toEqual([
      { ctrl: true, shift: true, key: "f" },
    ]);
    expect(bindings("explorer.search")).toEqual([]);
  });

  it("uses Alt+Arrow for editor navigation without stealing an Outline binding", () => {
    expect(bindings("editor.navigateBack")).toEqual([
      { alt: true, key: "ArrowLeft" },
    ]);
    expect(bindings("editor.navigateForward")).toEqual([
      { alt: true, key: "ArrowRight" },
    ]);
    expect(bindings("editor.outline")).toEqual([]);
  });

  it("uses the conventional signature help shortcut", () => {
    expect(bindings("editor.signatureHelp")).toEqual([
      { ctrl: true, shift: true, key: " " },
    ]);
  });

  it("uses conventional symbol navigation shortcuts", () => {
    expect(bindings("editor.goToDefinition")).toEqual([{ key: "F12" }]);
    expect(bindings("editor.peekDefinition")).toEqual([
      { alt: true, key: "F12" },
    ]);
    expect(bindings("editor.goToImplementation")).toEqual([
      { ctrl: true, key: "F12" },
    ]);
    expect(bindings("editor.findReferences")).toEqual([
      { shift: true, key: "F12" },
    ]);
    expect(bindings("editor.goToTypeDefinition")).toEqual([]);
  });
});
