export type TerminalPasteTarget = {
  paste: (text: string) => void;
  focus: () => void;
};

let lastPastedText = "";
let lastPastedTimestamp = 0;
let lastPastedTerminal: TerminalPasteTarget | null = null;

export function resetTerminalPasteDeduplication(): void {
  lastPastedText = "";
  lastPastedTimestamp = 0;
  lastPastedTerminal = null;
}

export function pasteIntoTerminal(
  terminal: TerminalPasteTarget | null,
  text: string,
  now: number = Date.now(),
): boolean {
  if (!terminal || !text) return false;

  // Deduplicate rapid identical paste attempts on the same terminal
  // (e.g. browser contextmenu + native paste event firing in the same interaction).
  if (
    lastPastedTerminal === terminal &&
    lastPastedText === text &&
    now - lastPastedTimestamp < 250
  ) {
    return false;
  }

  lastPastedText = text;
  lastPastedTimestamp = now;
  lastPastedTerminal = terminal;

  terminal.paste(text);
  terminal.focus();
  return true;
}

