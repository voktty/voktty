import { pasteIntoTerminal, type TerminalPasteTarget } from "./terminalPaste";

export type TerminalSelectionSource = {
  getSelection: () => string;
};

export type TerminalMouseModeSource = {
  modes?: {
    mouseTrackingMode?: string;
  };
};

export async function copyTerminalSelection(
  terminal: TerminalSelectionSource,
  writeText: (text: string) => Promise<void>,
): Promise<boolean> {
  const selection = terminal.getSelection();
  if (!selection) return false;

  try {
    await writeText(selection);
    return true;
  } catch {
    return false;
  }
}

export async function pasteClipboardIntoTerminal(
  terminal: TerminalPasteTarget | null,
  readText: () => Promise<string>,
  canPaste: () => boolean = () => true,
): Promise<boolean> {
  let text: string;
  try {
    text = await readText();
  } catch {
    return false;
  }

  if (!text || !canPaste()) return false;
  return pasteIntoTerminal(terminal, text);
}

export function shouldHandleTerminalContextMenuPaste(
  terminal: TerminalMouseModeSource | null,
  shiftKey: boolean = false,
): boolean {
  if (!terminal) return false;
  if (shiftKey) return true;

  const mouseMode = terminal.modes?.mouseTrackingMode;
  if (mouseMode && mouseMode !== "none") {
    return false;
  }

  return true;
}
