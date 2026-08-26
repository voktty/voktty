import {
  indexedDocumentOffsetAt,
  indexDocumentPositions,
} from "./documentPosition";

export type NormalizedInlayHint = {
  line: number;
  character: number;
  label: string;
  kind: "type" | "parameter" | null;
  paddingLeft: boolean;
  paddingRight: boolean;
  tooltip: string | null;
};

export type NormalizedInlayHints = {
  hints: NormalizedInlayHint[];
  truncated: boolean;
};

export const MAX_VISIBLE_INLAY_HINTS = 500;
const MAX_LABEL_LENGTH = 120;
const MAX_TOOLTIP_LENGTH = 500;

export type InlayHintOffset = Omit<
  NormalizedInlayHint,
  "line" | "character"
> & {
  offset: number;
};

export function supportsInlayHints(capabilities: unknown): boolean {
  if (!capabilities || typeof capabilities !== "object") return false;
  const provider = (capabilities as Record<string, unknown>).inlayHintProvider;
  return (
    provider === true || (provider !== null && typeof provider === "object")
  );
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function plainText(value: string, limit: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, limit - 1)}…`;
}

function label(value: unknown): string | null {
  if (typeof value === "string") {
    return plainText(value, MAX_LABEL_LENGTH) || null;
  }
  if (!Array.isArray(value) || value.length === 0 || value.length > 20) {
    return null;
  }
  const parts: string[] = [];
  for (const rawPart of value) {
    const part = object(rawPart);
    if (!part || typeof part.value !== "string") return null;
    parts.push(part.value);
  }
  return plainText(parts.join(""), MAX_LABEL_LENGTH) || null;
}

function tooltip(value: unknown): string | null {
  if (typeof value === "string") {
    return plainText(value, MAX_TOOLTIP_LENGTH) || null;
  }
  const candidate = object(value);
  return candidate && typeof candidate.value === "string"
    ? plainText(candidate.value, MAX_TOOLTIP_LENGTH) || null
    : null;
}

function hint(value: unknown): NormalizedInlayHint | null {
  const candidate = object(value);
  const rawPosition = object(candidate?.position);
  if (!candidate || !rawPosition) return null;
  const { line, character } = rawPosition;
  if (
    !Number.isSafeInteger(line) ||
    !Number.isSafeInteger(character) ||
    (line as number) < 0 ||
    (character as number) < 0
  ) {
    return null;
  }
  const normalizedLabel = label(candidate.label);
  if (!normalizedLabel) return null;
  return {
    line: line as number,
    character: character as number,
    label: normalizedLabel,
    kind:
      candidate.kind === 1 ? "type" : candidate.kind === 2 ? "parameter" : null,
    paddingLeft: candidate.paddingLeft === true,
    paddingRight: candidate.paddingRight === true,
    tooltip: tooltip(candidate.tooltip),
  };
}

export function normalizeInlayHints(
  value: unknown,
  maxHints = MAX_VISIBLE_INLAY_HINTS,
): NormalizedInlayHints {
  if (!Array.isArray(value)) return { hints: [], truncated: false };
  const limit = Math.max(1, Math.min(MAX_VISIBLE_INLAY_HINTS, maxHints));
  const hints: NormalizedInlayHint[] = [];
  const seen = new Set<string>();
  let truncated = false;
  for (const raw of value) {
    const normalized = hint(raw);
    if (!normalized) continue;
    const key = `${normalized.line}\u0000${normalized.character}\u0000${normalized.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (hints.length >= limit) {
      truncated = true;
      break;
    }
    hints.push(normalized);
  }
  hints.sort(
    (a, b) =>
      a.line - b.line ||
      a.character - b.character ||
      a.label.localeCompare(b.label),
  );
  return { hints, truncated };
}

export function inlayHintOffsets(
  document: string,
  hints: readonly NormalizedInlayHint[],
): InlayHintOffset[] {
  const index = indexDocumentPositions(document);
  const offsets: InlayHintOffset[] = [];
  for (const { line, character, ...hint } of hints) {
    const offset = indexedDocumentOffsetAt(index, line, character);
    if (offset !== null) offsets.push({ offset, ...hint });
  }
  return offsets;
}
