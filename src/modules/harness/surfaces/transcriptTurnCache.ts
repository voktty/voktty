import type { Block } from "@/modules/harness/lib/session";
import {
  groupTurnItems,
  groupTurns,
  type TurnItem,
} from "@/modules/harness/surfaces/transcriptActivity";

/** Reuse unchanged history while immutable updates replace the live blocks. */
export class TranscriptTurnCache {
  private blocks: Block[] | undefined;
  private turns: Block[][] = [];
  private items = new WeakMap<Block[], Map<boolean, TurnItem[]>>();

  group(blocks: Block[]): Block[][] {
    if (this.blocks === blocks) return this.turns;
    const previous = new Map(this.turns.map((turn) => [turn[0].id, turn]));
    const next = groupTurns(blocks).map((turn) => {
      const before = previous.get(turn[0].id);
      return before &&
        before.length === turn.length &&
        turn.every((block, index) => block === before[index])
        ? before
        : turn;
    });
    this.blocks = blocks;
    if (
      next.length !== this.turns.length ||
      next.some((turn, index) => turn !== this.turns[index])
    )
      this.turns = next;
    return this.turns;
  }

  turnItems(turn: Block[], zen: boolean): TurnItem[] {
    let variants = this.items.get(turn);
    const previous = variants?.get(zen);
    if (previous) return previous;
    const items = groupTurnItems(turn, zen);
    if (!variants) {
      variants = new Map();
      this.items.set(turn, variants);
    }
    variants.set(zen, items);
    return items;
  }
}
