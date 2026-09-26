import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  copyTerminalSelection,
  pasteClipboardIntoTerminal,
  shouldHandleTerminalContextMenuPaste,
} from "./terminalInteraction";
import { resetTerminalPasteDeduplication } from "./terminalPaste";

describe("copyTerminalSelection", () => {
  beforeEach(() => {
    resetTerminalPasteDeduplication();
  });
  it("copies the exact terminal selection", async () => {
    const writeText = vi.fn<() => Promise<void>>().mockResolvedValue();

    await expect(
      copyTerminalSelection({ getSelection: () => "  pnpm test\n" }, writeText),
    ).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("  pnpm test\n");
  });

  it("does not write when there is no selection", async () => {
    const writeText = vi.fn<() => Promise<void>>().mockResolvedValue();

    await expect(
      copyTerminalSelection({ getSelection: () => "" }, writeText),
    ).resolves.toBe(false);
    expect(writeText).not.toHaveBeenCalled();
  });

  it("turns clipboard failures into a false result", async () => {
    const writeText = vi
      .fn<() => Promise<void>>()
      .mockRejectedValue(new Error("denied"));

    await expect(
      copyTerminalSelection({ getSelection: () => "text" }, writeText),
    ).resolves.toBe(false);
  });
});

describe("pasteClipboardIntoTerminal", () => {
  it("reads, pastes, and focuses the terminal", async () => {
    const terminal = { paste: vi.fn(), focus: vi.fn() };

    await expect(
      pasteClipboardIntoTerminal(terminal, async () => "echo hello"),
    ).resolves.toBe(true);
    expect(terminal.paste).toHaveBeenCalledWith("echo hello");
    expect(terminal.focus).toHaveBeenCalledOnce();
  });

  it("does not paste an empty clipboard", async () => {
    const terminal = { paste: vi.fn(), focus: vi.fn() };

    await expect(
      pasteClipboardIntoTerminal(terminal, async () => ""),
    ).resolves.toBe(false);
    expect(terminal.paste).not.toHaveBeenCalled();
  });

  it("does not paste after the terminal has been rebound", async () => {
    const terminal = { paste: vi.fn(), focus: vi.fn() };
    const canPaste = vi.fn(() => false);

    await expect(
      pasteClipboardIntoTerminal(terminal, async () => "echo hello", canPaste),
    ).resolves.toBe(false);
    expect(canPaste).toHaveBeenCalledOnce();
    expect(terminal.paste).not.toHaveBeenCalled();
  });
});

describe("shouldHandleTerminalContextMenuPaste", () => {
  it("returns false if terminal is null", () => {
    expect(shouldHandleTerminalContextMenuPaste(null)).toBe(false);
  });

  it("returns true for standard shells where mouse tracking is inactive", () => {
    expect(shouldHandleTerminalContextMenuPaste({})).toBe(true);
    expect(
      shouldHandleTerminalContextMenuPaste({
        modes: { mouseTrackingMode: "none" },
      }),
    ).toBe(true);
    expect(
      shouldHandleTerminalContextMenuPaste({
        modes: { mouseTrackingMode: "" },
      }),
    ).toBe(true);
  });

  it("returns false when mouse tracking is enabled (e.g. Claude Code, ink CLI, vim)", () => {
    expect(
      shouldHandleTerminalContextMenuPaste({
        modes: { mouseTrackingMode: "normal" },
      }),
    ).toBe(false);
    expect(
      shouldHandleTerminalContextMenuPaste({
        modes: { mouseTrackingMode: "button-event" },
      }),
    ).toBe(false);
    expect(
      shouldHandleTerminalContextMenuPaste({
        modes: { mouseTrackingMode: "any-event" },
      }),
    ).toBe(false);
    expect(
      shouldHandleTerminalContextMenuPaste({
        modes: { mouseTrackingMode: "vt200" },
      }),
    ).toBe(false);
  });

  it("returns true when shiftKey is pressed, overriding mouse tracking", () => {
    expect(
      shouldHandleTerminalContextMenuPaste(
        { modes: { mouseTrackingMode: "normal" } },
        true,
      ),
    ).toBe(true);
    expect(
      shouldHandleTerminalContextMenuPaste(
        { modes: { mouseTrackingMode: "any-event" } },
        true,
      ),
    ).toBe(true);
  });
});
