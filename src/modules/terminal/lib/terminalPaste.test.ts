import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  pasteIntoTerminal,
  resetTerminalPasteDeduplication,
} from "./terminalPaste";

describe("pasteIntoTerminal", () => {
  beforeEach(() => {
    resetTerminalPasteDeduplication();
  });

  it("pastes and focuses the resolved terminal", () => {
    const terminal = { paste: vi.fn(), focus: vi.fn() };

    expect(pasteIntoTerminal(terminal, "/repo/file.ts ")).toBe(true);
    expect(terminal.paste).toHaveBeenCalledWith("/repo/file.ts ");
    expect(terminal.focus).toHaveBeenCalledOnce();
  });

  it("returns false when no terminal is resolved", () => {
    expect(pasteIntoTerminal(null, "/repo/file.ts ")).toBe(false);
  });

  it("deduplicates rapid identical paste events within the debounce window", () => {
    const terminal = { paste: vi.fn(), focus: vi.fn() };

    expect(pasteIntoTerminal(terminal, "claude test", 1000)).toBe(true);
    expect(pasteIntoTerminal(terminal, "claude test", 1050)).toBe(false);
    expect(terminal.paste).toHaveBeenCalledTimes(1);

    // After the window expires, the same text can be pasted again
    expect(pasteIntoTerminal(terminal, "claude test", 1300)).toBe(true);
    expect(terminal.paste).toHaveBeenCalledTimes(2);
  });

  it("allows distinct text without deduplication blocking", () => {
    const terminal = { paste: vi.fn(), focus: vi.fn() };

    expect(pasteIntoTerminal(terminal, "first", 1000)).toBe(true);
    expect(pasteIntoTerminal(terminal, "second", 1010)).toBe(true);
    expect(terminal.paste).toHaveBeenCalledTimes(2);
  });
});

