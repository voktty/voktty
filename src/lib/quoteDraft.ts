export type QuoteRequest = {
  id: number;
  text: string;
};

export type QuoteConsumption = {
  draft: string;
  consumedId: number | null;
  changed: boolean;
};

export function isMarkdownBlockquotePosition(
  text: string,
  position: number,
): boolean {
  const index = Math.max(0, Math.min(position, text.length));
  const lineStart = text.lastIndexOf("\n", Math.max(0, index - 1)) + 1;
  return /^ {0,3}>/.test(text.slice(lineStart, index));
}

export function appendSelectionQuote(draft: string, text: string): string {
  const selected = text.replace(/\r\n?/g, "\n").trim();
  if (!selected) return draft;

  const quote = selected
    .split("\n")
    .map((line) => (line ? `> ${line}` : ">"))
    .join("\n");
  const separator =
    draft.length === 0
      ? ""
      : draft.endsWith("\n\n")
        ? ""
        : draft.endsWith("\n")
          ? "\n"
          : "\n\n";
  return `${draft}${separator}${quote}\n\n`;
}

export function consumeQuoteRequest(
  draft: string,
  consumedId: number | null,
  request: QuoteRequest | undefined,
): QuoteConsumption {
  if (!request || request.id === consumedId) {
    return { draft, consumedId, changed: false };
  }

  const next = appendSelectionQuote(draft, request.text);
  return {
    draft: next,
    consumedId: request.id,
    changed: next !== draft,
  };
}

export function acknowledgeQuoteRequest(
  current: QuoteRequest | undefined,
  handledId: number,
): QuoteRequest | undefined {
  return current?.id === handledId ? undefined : current;
}
