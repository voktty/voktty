import {
  indexDocumentPositions,
  indexedDocumentOffsetAt,
} from "@/modules/lsp/lib/documentPosition";

export type PeekExcerpt = {
  content: string;
  /** First displayed source line, 1-based. */
  startLine: number;
  /** Target line within the excerpt, 0-based. */
  targetLine: number;
  targetColumn: number;
  targetOffset: number;
};

export const MAX_PEEK_EXCERPT_CHARS = 256 * 1024;

export function buildPeekExcerpt(
  source: string,
  line: number,
  character: number,
  contextBefore = 30,
  contextAfter = 60,
): PeekExcerpt | null {
  const content = source.replace(/\r\n?/g, "\n");
  const positions = indexDocumentPositions(content);
  if (indexedDocumentOffsetAt(positions, line, character) === null) return null;

  const lines = content.split("\n");
  let start = Math.max(0, line - Math.max(0, contextBefore));
  let end = Math.min(lines.length, line + Math.max(0, contextAfter) + 1);
  let excerpt = lines.slice(start, end).join("\n");
  while (
    excerpt.length > MAX_PEEK_EXCERPT_CHARS &&
    (start < line || end > line + 1)
  ) {
    if (line - start >= end - line - 1 && start < line) start += 1;
    else if (end > line + 1) end -= 1;
    excerpt = lines.slice(start, end).join("\n");
  }
  if (excerpt.length > MAX_PEEK_EXCERPT_CHARS) return null;

  const targetLine = line - start;
  const excerptPositions = indexDocumentPositions(excerpt);
  const targetOffset = indexedDocumentOffsetAt(
    excerptPositions,
    targetLine,
    character,
  );
  if (targetOffset === null) return null;

  return {
    content: excerpt,
    startLine: start + 1,
    targetLine,
    targetColumn: character,
    targetOffset,
  };
}

export function movePeekIndex(
  current: number,
  delta: number,
  count: number,
): number {
  if (count <= 0) return 0;
  return (((current + delta) % count) + count) % count;
}

function normalizedPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/{2,}/g, "/");
}

export function samePeekPath(left: string, right: string): boolean {
  const a = normalizedPath(left);
  const b = normalizedPath(right);
  return /^[A-Za-z]:\//.test(a) && /^[A-Za-z]:\//.test(b)
    ? a.toLowerCase() === b.toLowerCase()
    : a === b;
}
