import {
  indexedDocumentOffsetAt,
  indexDocumentPositions,
} from "./documentPosition";

export type SemanticTokenLegend = {
  tokenTypes: readonly string[];
  tokenModifiers: readonly string[];
};

export type NormalizedSemanticToken = {
  line: number;
  character: number;
  length: number;
  type: string;
  modifiers: string[];
};

export type NormalizedSemanticTokens = {
  tokens: NormalizedSemanticToken[];
  truncated: boolean;
};

export const MAX_SEMANTIC_TOKENS = 20_000;

export type SemanticTokenOffset = {
  from: number;
  to: number;
  type: string;
  modifiers: string[];
};

function validLegend(value: unknown): value is SemanticTokenLegend {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    Array.isArray(candidate.tokenTypes) &&
    candidate.tokenTypes.length > 0 &&
    candidate.tokenTypes.every(
      (token) => typeof token === "string" && token.length > 0,
    ) &&
    Array.isArray(candidate.tokenModifiers) &&
    candidate.tokenModifiers.every(
      (modifier) => typeof modifier === "string" && modifier.length > 0,
    )
  );
}

export function semanticTokenLegend(
  capabilities: unknown,
): SemanticTokenLegend | null {
  if (!capabilities || typeof capabilities !== "object") return null;
  const provider = (capabilities as Record<string, unknown>)
    .semanticTokensProvider;
  if (!provider || typeof provider !== "object") return null;
  const candidate = provider as Record<string, unknown>;
  if (candidate.full !== true && typeof candidate.full !== "object") {
    return null;
  }
  return validLegend(candidate.legend) ? candidate.legend : null;
}

function validData(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length % 5 === 0 &&
    value.every(
      (entry) => Number.isSafeInteger(entry) && (entry as number) >= 0,
    )
  );
}

export function normalizeSemanticTokens(
  response: unknown,
  legend: unknown,
  maxTokens = MAX_SEMANTIC_TOKENS,
): NormalizedSemanticTokens | null {
  if (!response || typeof response !== "object" || !validLegend(legend)) {
    return null;
  }
  const data = (response as Record<string, unknown>).data;
  if (!validData(data)) return null;
  const limit = Math.max(1, Math.min(MAX_SEMANTIC_TOKENS, maxTokens));
  const count = data.length / 5;
  const tokens: NormalizedSemanticToken[] = [];
  let line = 0;
  let character = 0;
  for (let index = 0; index < Math.min(count, limit); index += 1) {
    const offset = index * 5;
    const deltaLine = data[offset];
    const deltaStart = data[offset + 1];
    const length = data[offset + 2];
    const typeIndex = data[offset + 3];
    const modifierBits = data[offset + 4];
    if (
      deltaLine === undefined ||
      deltaStart === undefined ||
      length === undefined ||
      typeIndex === undefined ||
      modifierBits === undefined ||
      length === 0 ||
      typeIndex >= legend.tokenTypes.length ||
      modifierBits > 0xffff_ffff
    ) {
      return null;
    }
    if (deltaLine === 0) {
      character += deltaStart;
    } else {
      line += deltaLine;
      character = deltaStart;
    }
    const modifiers: string[] = [];
    const modifierCount = Math.min(legend.tokenModifiers.length, 32);
    for (let bit = 0; bit < modifierCount; bit += 1) {
      if (Math.floor(modifierBits / 2 ** bit) % 2 === 1) {
        const modifier = legend.tokenModifiers[bit];
        if (modifier) modifiers.push(modifier);
      }
    }
    const type = legend.tokenTypes[typeIndex];
    if (!type) return null;
    tokens.push({ line, character, length, type, modifiers });
  }
  return { tokens, truncated: count > limit };
}

export function semanticTokenOffsets(
  document: string,
  tokens: readonly NormalizedSemanticToken[],
): SemanticTokenOffset[] {
  const index = indexDocumentPositions(document);
  const offsets: SemanticTokenOffset[] = [];
  let previousTo = -1;
  for (const token of tokens) {
    const from = indexedDocumentOffsetAt(index, token.line, token.character);
    const to = indexedDocumentOffsetAt(
      index,
      token.line,
      token.character + token.length,
    );
    if (from === null || to === null || to <= from || from < previousTo) {
      continue;
    }
    offsets.push({
      from,
      to,
      type: token.type,
      modifiers: token.modifiers,
    });
    previousTo = to;
  }
  return offsets;
}
