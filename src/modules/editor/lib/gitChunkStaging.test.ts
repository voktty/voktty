import { Chunk } from "@codemirror/merge";
import { Text } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { stageChunkText } from "./gitChunkStaging";

function chunksFor(original: string, current: string): readonly Chunk[] {
  return Chunk.build(
    Text.of(original.split("\n")),
    Text.of(current.split("\n")),
    {
      scanLimit: 5_000,
      timeout: 100,
    },
  );
}

describe("stageChunkText", () => {
  it("stages only the hunk at the given position, leaving the other hunk as it was in the index", () => {
    const original = "one\ntwo\nthree\nfour\nfive\n";
    const current = "ONE\ntwo\nthree\nfour\nFIVE\n";
    const chunks = chunksFor(original, current);
    expect(chunks).toHaveLength(2);

    expect(stageChunkText(original, current, chunks[0].fromB)).toBe(
      "ONE\ntwo\nthree\nfour\nfive\n",
    );
    expect(stageChunkText(original, current, chunks[1].fromB)).toBe(
      "one\ntwo\nthree\nfour\nFIVE\n",
    );
  });

  it("stages a pure insertion", () => {
    const original = "a\nb\n";
    const current = "a\nX\nb\n";
    const chunks = chunksFor(original, current);
    expect(chunks).toHaveLength(1);
    expect(stageChunkText(original, current, chunks[0].fromB)).toBe(
      "a\nX\nb\n",
    );
  });

  it("stages a pure deletion", () => {
    const original = "a\nb\nc\n";
    const current = "a\nc\n";
    const chunks = chunksFor(original, current);
    expect(chunks).toHaveLength(1);
    expect(stageChunkText(original, current, chunks[0].fromB)).toBe("a\nc\n");
  });

  it("returns null when there is no hunk at that position", () => {
    expect(stageChunkText("same\n", "same\n", 0)).toBeNull();
  });

  it("stages the last hunk of the file, at the very end of the document", () => {
    const original = "keep\nold-tail\n";
    const current = "keep\nnew-tail\n";
    const chunks = chunksFor(original, current);
    expect(chunks).toHaveLength(1);
    expect(stageChunkText(original, current, chunks[0].fromB)).toBe(
      "keep\nnew-tail\n",
    );
  });
});
