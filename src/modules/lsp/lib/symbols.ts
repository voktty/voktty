import type { IdeSymbol } from "@/modules/editor/lib/outlineSymbols";
import { fileUriToPath } from "./uri";

type LspPosition = { line: number; character: number };
type LspRange = { start: LspPosition; end: LspPosition };
export type LspDocumentSymbol = {
  name: string;
  detail?: string;
  kind: number;
  range: LspRange;
  selectionRange: LspRange;
  children?: LspDocumentSymbol[];
};
export type LspSymbolInformation = {
  name: string;
  kind: number;
  containerName?: string;
  location: { uri: string; range?: LspRange };
};

export const MAX_SYMBOL_RESULTS = 500;

function isDocumentSymbol(
  symbol: LspDocumentSymbol | LspSymbolInformation,
): symbol is LspDocumentSymbol {
  return "selectionRange" in symbol;
}

function fromDocumentSymbol(
  symbol: LspDocumentSymbol,
  path: string,
): IdeSymbol {
  const position = symbol.selectionRange.start;
  return {
    id: `${path}:${position.line}:${position.character}:${symbol.name}`,
    name: symbol.name,
    detail: symbol.detail,
    kind: symbol.kind,
    path,
    line: position.line + 1,
    column: position.character + 1,
    endLine: symbol.range.end.line + 1,
    children: (symbol.children ?? []).map((child) =>
      fromDocumentSymbol(child, path),
    ),
  };
}

function fromSymbolInformation(
  symbol: LspSymbolInformation,
  fallbackPath?: string,
): IdeSymbol | null {
  const range = symbol.location.range;
  const path = fileUriToPath(symbol.location.uri) ?? fallbackPath;
  if (!range || !path) return null;
  return {
    id: `${path}:${range.start.line}:${range.start.character}:${symbol.name}`,
    name: symbol.name,
    detail: symbol.containerName,
    kind: symbol.kind,
    path,
    line: range.start.line + 1,
    column: range.start.character + 1,
    endLine: range.end.line + 1,
    children: [],
  };
}

export function normalizeDocumentSymbols(
  raw: Array<LspDocumentSymbol | LspSymbolInformation> | null | undefined,
  path: string,
): IdeSymbol[] {
  if (!raw) return [];
  return raw
    .flatMap((symbol) => {
      if (isDocumentSymbol(symbol)) return [fromDocumentSymbol(symbol, path)];
      const normalized = fromSymbolInformation(symbol, path);
      return normalized ? [normalized] : [];
    })
    .slice(0, MAX_SYMBOL_RESULTS);
}

export function normalizeWorkspaceSymbols(
  raw: LspSymbolInformation[] | null | undefined,
): IdeSymbol[] {
  if (!raw) return [];
  const symbols: IdeSymbol[] = [];
  for (const symbol of raw) {
    const normalized = fromSymbolInformation(symbol);
    if (normalized) symbols.push(normalized);
    if (symbols.length >= MAX_SYMBOL_RESULTS) break;
  }
  return symbols;
}
