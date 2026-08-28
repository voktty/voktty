import {
  composeToolTitle,
  isEditTool,
  isWeakToolTitle,
} from "../lib/harness/preview";
import { displayPath } from "../lib/paths";
import type { Block } from "../lib/session";

export type ToolCallState = "pending" | "accepted" | "rejected";

export type TurnItem =
  { type: "block"; block: Block } | { type: "activity"; blocks: Block[] };

export function needsApproval(block: Block): boolean {
  return !!block.approval && !block.approval.decided;
}

export function toolCallState(block: Block): ToolCallState {
  const status = block.tool?.status?.toLowerCase() ?? "";
  const decided = block.approval?.decided;

  if (decided === "deny") return "rejected";
  if (
    status === "failed" ||
    status === "error" ||
    status === "cancelled" ||
    status === "canceled"
  ) {
    return "rejected";
  }
  if (needsApproval(block)) return "pending";
  if (status === "completed" || status === "success") return "accepted";
  if (
    block.streaming ||
    status === "in_progress" ||
    status === "pending" ||
    status === "running"
  ) {
    return "pending";
  }
  if (decided === "allow" || !status) return "accepted";
  return "pending";
}

export function toolCallLabel(block: Block, cwd?: string): string {
  const preview = block.tool?.preview;
  const path = preview?.path
    ? displayPath(preview.path, cwd)
    : preview?.fileName;
  return (
    composeToolTitle({
      kind: block.tool?.kind,
      title: block.text || block.tool?.title,
      path,
      query: preview?.query,
      previewKind: preview?.kind,
    }) || "Working"
  );
}

export function isIncompleteTool(
  block: Block,
  label: string,
  state: ToolCallState,
): boolean {
  if (state !== "pending") return false;
  const kind = block.tool?.kind?.toLowerCase();
  if (kind && kind !== "other") return false;
  if (
    block.tool?.preview?.path ||
    block.tool?.preview?.query ||
    block.tool?.preview?.lines?.length
  ) {
    return false;
  }
  return !label || isWeakToolTitle(label);
}

export function isHiddenTool(block: Block): boolean {
  if (block.role !== "tool" && block.role !== "approval") return false;
  if (
    isEditTool(
      block.tool?.kind,
      block.text || block.tool?.title,
      block.tool?.preview,
    )
  ) {
    return false;
  }
  const state = toolCallState(block);
  return isIncompleteTool(block, toolCallLabel(block), state);
}

/**
 * Zen mode folds edits in with the reads and searches. An edit still awaiting
 * approval stays out: you cannot judge a diff you cannot see.
 */
export function isActivityBlock(block: Block, zen = false): boolean {
  if (zen && isThinkingBlock(block)) return true;
  if (block.role !== "tool" && block.role !== "approval") return false;
  if (
    isEditTool(
      block.tool?.kind,
      block.text || block.tool?.title,
      block.tool?.preview,
    ) &&
    (!zen || needsApproval(block))
  ) {
    return false;
  }
  return !isHiddenTool(block);
}

/** Reasoning the agent streams while it works. Zen shows it, nothing else does. */
export function isThinkingBlock(block: Block): boolean {
  return block.role === "reasoning" && !!block.text.trim();
}

export function isToolBlock(block: Block): boolean {
  return block.role === "tool" || block.role === "approval";
}

/** Assistant prose with something in it — the paragraphs between tool calls. */
export function isProseBlock(block: Block): boolean {
  return block.role === "assistant" && !!block.text.trim();
}

/**
 * Where the turn's final answer starts: the trailing run of assistant prose.
 * Zen folds everything before it, so the last thing the agent says is the only
 * full-size thing left. A block still streaming sits in that run, which is why
 * text renders in full as it arrives and only folds once the next tool starts.
 */
export function finalResponseStart(blocks: Block[]): number {
  let index = blocks.length;
  while (index > 0 && isProseBlock(blocks[index - 1])) index -= 1;
  return index;
}

/** First paragraph of a folded prose block, stripped to one plain line. */
export function proseSummary(text: string): string {
  const body = text.replace(/```[\s\S]*?(?:```|$)/g, " ");
  const paragraph =
    body
      .split(/\n\s*\n/)
      .map((part) => part.trim())
      .find(Boolean) ?? "";
  return paragraph
    .replace(/^\s{0,3}(?:#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(\*|_)(.+?)\1/g, "$2")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Canonical verb for a write-preview row, so edits read as "Edit src/app.ts"
 * alongside "Read" and "Find". Harnesses phrase these in past tense, hence the
 * doubled-up forms.
 */
export function editVerb(label: string): string {
  const word = label.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  if (/^(delete|deleted|remove|removed)$/.test(word)) return "Delete";
  if (/^(move|moved|rename|renamed)$/.test(word)) return "Move";
  if (/^(create|created|add|added|new)$/.test(word)) return "Create";
  if (/^(write|wrote|writing)$/.test(word)) return "Write";
  return "Edit";
}

/** "14 tool calls · 5 files edited", for the collapsed zen row. */
export function activitySummary(blocks: Block[]): string {
  const tools = blocks.filter(isToolBlock);
  const calls = tools.length;
  if (calls === 0) {
    // A turn that only thought before answering still gets an honest label.
    const thoughts = blocks.filter(isThinkingBlock).length;
    if (thoughts > 0 && thoughts === blocks.length) {
      return `${thoughts} ${thoughts === 1 ? "thought" : "thoughts"}`;
    }
    const notes = blocks.length;
    return `${notes} earlier ${notes === 1 ? "message" : "messages"}`;
  }
  const files = new Set(
    tools
      .filter((block) =>
        isEditTool(
          block.tool?.kind,
          block.text || block.tool?.title,
          block.tool?.preview,
        ),
      )
      .map(
        (block) =>
          block.tool?.preview?.path ??
          block.tool?.preview?.fileName ??
          block.id,
      ),
  );
  const parts = [`${calls} tool ${calls === 1 ? "call" : "calls"}`];
  if (files.size > 0) {
    parts.push(`${files.size} ${files.size === 1 ? "file" : "files"} edited`);
  }
  return parts.join(" · ");
}

/** User turns, with handoff dividers sitting on their own row. */
export function groupTurns(blocks: Block[]): Block[][] {
  const turns: Block[][] = [];
  let current: Block[] = [];
  for (const block of blocks) {
    if (block.role === "handoff") {
      if (current.length > 0) turns.push(current);
      turns.push([block]);
      current = [];
      continue;
    }
    if (block.role === "user" && current.length > 0) {
      turns.push(current);
      current = [];
    }
    current.push(block);
  }
  if (current.length > 0) turns.push(current);
  return turns;
}

/**
 * Zen folds a turn's whole working process — tool calls and the prose between
 * them — into one activity group, leaving the final answer standing alone.
 */
export function groupTurnItems(blocks: Block[], zen = false): TurnItem[] {
  const visible = blocks.filter(
    (block) => !isIgnoredTurnBlock(block, zen) && !isHiddenTool(block),
  );
  // Zen off: nothing folds, so every prose block counts as final.
  const finalStart = zen ? finalResponseStart(visible) : 0;
  const items: TurnItem[] = [];
  let activity: Block[] = [];
  const flush = () => {
    if (activity.length > 0) {
      items.push({ type: "activity", blocks: activity });
    }
    activity = [];
  };
  visible.forEach((block, index) => {
    if (
      isActivityBlock(block, zen) ||
      (index < finalStart && isProseBlock(block))
    ) {
      activity.push(block);
      return;
    }
    flush();
    items.push({ type: "block", block });
  });
  flush();
  return items;
}

function isIgnoredTurnBlock(block: Block, zen: boolean): boolean {
  // Zen keeps thinking as a ticker line, so a long think does not read as the
  // agent having stalled. Everywhere else it stays out of the transcript.
  if (block.role === "reasoning") return !zen || !block.text.trim();
  return block.role === "assistant" && !block.text.trim();
}

/** Markdown the user actually reads: assistant prose plus any plan, not tool chrome. */
export function turnCopyText(blocks: Block[]): string {
  return blocks
    .filter((block) => block.role === "assistant" || block.role === "plan")
    .map((block) => block.text.replace(/\r\n?/g, "\n").trim())
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Rows for the live stack, split around the line the ticker is holding:
 * `hidden` is what it has already rolled past, `latest` is on screen now.
 * The index defaults to the newest row; the ticker passes its own while it
 * catches up, so a burst of fast tool calls still reads one line at a time.
 */
export function splitActivityRows(
  blocks: Block[],
  index?: number,
): {
  latest?: Block;
  pending: Block[];
  hidden: Block[];
  completed: Block[];
} {
  const pending = blocks.filter(needsApproval);
  const completed = blocks.filter((block) => !needsApproval(block));
  const at = Math.max(
    0,
    Math.min(index ?? completed.length - 1, completed.length - 1),
  );
  const latest = completed[at];
  return {
    latest,
    pending,
    hidden: latest ? completed.slice(0, at) : completed,
    completed,
  };
}

/** How long a ticker line holds before the next one rolls up. */
export const TICKER_DWELL_MS = 700;

/** How far behind the ticker may fall before it skips straight to the live row. */
export const TICKER_MAX_LAG = 3;

/**
 * Where the ticker moves next: one line at a time so every tool call and note
 * gets a beat on screen, or a jump to the front when the agent has run away
 * from it.
 */
export function nextTickerIndex(index: number, count: number): number {
  const last = count - 1;
  if (last < 0) return 0;
  if (index >= last) return last;
  if (last - index > TICKER_MAX_LAG) return last;
  return index + 1;
}

/**
 * The activity group a settled zen turn hangs its "Worked for" line on: the
 * last one, which sits where the ticker was, right above the final answer.
 */
export function lastActivityIndex(items: TurnItem[]): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (items[index].type === "activity") return index;
  }
  return -1;
}

export type ActivityGroupView = "summary" | "zen-expanded" | "live";

/**
 * How many "previous" rows the live disclosure claims. Zen keeps that chrome
 * on from the first step so Working does not sit under a hole and then jump
 * when the ticker finally has something behind it; the live row still counts
 * as one so the label is never "+0".
 */
export function activityPreviousCount(
  hidden: number,
  hasLatest: boolean,
  fromFirstStep = false,
): number {
  if (hidden > 0) return hidden;
  return fromFirstStep && hasLatest ? 1 : 0;
}

export function activityPreviousLabel(count: number, zen: boolean): string {
  if (zen) {
    return `+${count} previous ${count === 1 ? "step" : "steps"}`;
  }
  return `+${count} previous ${count === 1 ? "tool call" : "tool calls"}`;
}

/**
 * Zen's settled summary is gated on its own open flag, not the live
 * "+N previous" disclosure. Sharing that flag kept expanded history
 * from folding when a turn settled or zen was turned on.
 */
export function activityGroupView(
  collapsed: boolean,
  pendingCount: number,
  zenOpen: boolean,
): ActivityGroupView {
  if (!collapsed) return "live";
  if (zenOpen) return "zen-expanded";
  if (pendingCount > 0) return "live";
  return "summary";
}
