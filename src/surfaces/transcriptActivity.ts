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
  const calls = blocks.length;
  const files = new Set(
    blocks
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

export function groupTurnItems(blocks: Block[], zen = false): TurnItem[] {
  const items: TurnItem[] = [];
  let activity: Block[] = [];
  const flush = () => {
    if (activity.length > 0) {
      items.push({ type: "activity", blocks: activity });
    }
    activity = [];
  };
  for (const block of blocks) {
    if (isIgnoredTurnBlock(block)) continue;
    if (isHiddenTool(block)) continue;
    if (isActivityBlock(block, zen)) {
      activity.push(block);
      continue;
    }
    flush();
    items.push({ type: "block", block });
  }
  flush();
  return items;
}

function isIgnoredTurnBlock(block: Block): boolean {
  if (block.role === "reasoning") return true;
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

export function splitActivityRows(blocks: Block[]): {
  latest?: Block;
  pending: Block[];
  hidden: Block[];
} {
  const pending = blocks.filter(needsApproval);
  const completed = blocks.filter((block) => !needsApproval(block));
  const latest = completed[completed.length - 1];
  return {
    latest,
    pending,
    hidden: latest ? completed.slice(0, -1) : completed,
  };
}
