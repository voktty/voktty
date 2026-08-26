import { describe, expect, it, vi } from "vitest";
import {
  copyTerminalSelection,
  pasteClipboardIntoTerminal,
} from "./terminalInteraction";

describe("copyTerminalSelection", () => {
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
