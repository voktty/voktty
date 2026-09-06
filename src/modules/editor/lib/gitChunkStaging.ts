import { Chunk } from "@codemirror/merge";
import { Text } from "@codemirror/state";

const DIFF_CONFIG = { scanLimit: 5_000, timeout: 100 };

/**
 * The reconstructed file that results from staging one hunk out of a working
 * tree diff: the index (`original`) plus that one hunk's change from the
 * working tree (`current`), everything else left as it was in the index.
 *
 * `pos` is a document position in `current` inside the hunk to stage — the
 * same position a CodeMirror `Chunk`'s `fromB` points at, so a click on a
 * rendered chunk can be turned directly into a stage action.
 */
export function stageChunkText(
  original: string,
  current: string,
  pos: number,
): string | null {
  const orig = Text.of(original.split("\n"));
  const doc = Text.of(current.split("\n"));
  const chunk = findChunk(doc, chunksFor(orig, doc), pos);
  if (!chunk) return null;
  const change = applySide(
    doc,
    orig,
    chunk.fromB,
    chunk.toB,
    chunk.fromA,
    chunk.toA,
  );
  return orig.replace(change.from, change.to, change.insert).toString();
}

function chunksFor(original: Text, current: Text): readonly Chunk[] {
  return Chunk.build(original, current, DIFF_CONFIG);
}

/** The chunk covering `pos` in `doc`, or the empty chunk sitting right at it. */
export function findChunk(
  doc: Text,
  chunks: readonly Chunk[],
  pos: number,
): Chunk | undefined {
  const at = Math.max(0, Math.min(pos, doc.length));
  const covering = chunks.find(
    (chunk) => chunk.fromB <= at && chunk.endB >= at,
  );
  if (covering) return covering;
  if (doc.length === 0) return chunks[0];
  const line = doc.lineAt(at);
  return chunks.find(
    (chunk) =>
      chunk.fromB === chunk.toB &&
      chunk.fromB >= line.from &&
      chunk.fromB <= line.to + 1,
  );
}

function applySide(
  source: Text,
  target: Text,
  fromS: number,
  toS: number,
  fromT: number,
  toT: number,
): { from: number; to: number; insert: Text } {
  let insert = source.sliceString(fromS, Math.max(fromS, toS - 1));
  if (fromS !== toS && toT <= target.length) insert += "\n";
  return {
    from: fromT,
    to: Math.min(target.length, toT),
    insert: Text.of(insert.split("\n")),
  };
}
