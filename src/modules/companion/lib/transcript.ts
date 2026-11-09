import type { Block } from "@/modules/harness/lib/session";

export type TranscriptItem =
  | { kind: "block"; block: Block }
  | { kind: "reasoning"; id: string; text: string; streaming: boolean };

/**
 * Folds consecutive reasoning blocks into a single item so the phone shows one
 * collapsible row instead of a wall of model thoughts. Empty reasoning blocks
 * are dropped unless they are still streaming.
 */
export function groupTranscript(blocks: readonly Block[]): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  for (const block of blocks) {
    if (block.role !== "reasoning") {
      items.push({ kind: "block", block });
      continue;
    }
    const text = block.text.trim();
    const streaming = block.streaming === true;
    if (!text && !streaming) continue;
    const last = items[items.length - 1];
    if (last?.kind === "reasoning") {
      last.text = text ? (last.text ? `${last.text}\n\n${text}` : text) : last.text;
      last.streaming = streaming;
      continue;
    }
    items.push({ kind: "reasoning", id: block.id, text, streaming });
  }
  return items;
}
