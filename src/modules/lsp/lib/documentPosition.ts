export type DocumentPositionIndex = {
  document: string;
  lineStarts: number[];
};

export function indexDocumentPositions(
  document: string,
): DocumentPositionIndex {
  const lineStarts = [0];
  for (let offset = 0; offset < document.length; offset += 1) {
    if (document.charCodeAt(offset) === 10) lineStarts.push(offset + 1);
  }
  return { document, lineStarts };
}

export function indexedDocumentOffsetAt(
  index: DocumentPositionIndex,
  line: number,
  character: number,
): number | null {
  if (
    !Number.isSafeInteger(line) ||
    !Number.isSafeInteger(character) ||
    line < 0 ||
    character < 0
  ) {
    return null;
  }
  const lineStart = index.lineStarts[line];
  if (lineStart === undefined) return null;
  const nextLineStart = index.lineStarts[line + 1];
  let lineEnd =
    nextLineStart === undefined ? index.document.length : nextLineStart - 1;
  if (
    lineEnd > lineStart &&
    index.document.charCodeAt(lineEnd - 1) === 13
  ) {
    lineEnd -= 1;
  }
  const lineLength = lineEnd - lineStart;
  if (character > lineLength) return null;
  const offset = lineStart + character;
  if (character > 0 && character < lineLength) {
    const previous = index.document.charCodeAt(offset - 1);
    const current = index.document.charCodeAt(offset);
    if (
      previous >= 0xd800 &&
      previous <= 0xdbff &&
      current >= 0xdc00 &&
      current <= 0xdfff
    ) {
      return null;
    }
  }
  return offset;
}

export function documentOffsetAt(
  document: string,
  line: number,
  character: number,
): number | null {
  return indexedDocumentOffsetAt(
    indexDocumentPositions(document),
    line,
    character,
  );
}
