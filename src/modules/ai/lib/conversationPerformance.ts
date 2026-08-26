import type { UIMessage } from "ai";

export const CHAT_VIRTUALIZE_AFTER = 24;
export const CHAT_VIRTUALIZE_AFTER_CHARS = 60_000;
export const CHAT_VIRTUAL_OVERSCAN = 4;

export type ConversationEstimateState = {
  sessionId: string;
  source: readonly UIMessage[];
  refs: readonly UIMessage[];
  chars: readonly number[];
  totalChars: number;
};

function serializedLength(value: unknown): number {
  if (value == null) return 0;
  try {
    return JSON.stringify(value).length;
  } catch {
    return 0;
  }
}

export function estimateMessageChars(message: UIMessage): number {
  let chars = 0;
  for (const part of message.parts) {
    if (part.type === "text" || part.type === "reasoning") {
      chars += (part as { text?: string }).text?.length ?? 0;
      continue;
    }
    if (
      part.type === "dynamic-tool" ||
      (typeof part.type === "string" && part.type.startsWith("tool-"))
    ) {
      const tool = part as unknown as { input?: unknown; output?: unknown };
      chars += serializedLength(tool.input) + serializedLength(tool.output);
    }
  }
  return chars;
}

function rebuildEstimate(
  sessionId: string,
  messages: readonly UIMessage[],
  estimate: (message: UIMessage) => number,
): ConversationEstimateState {
  const chars = messages.map(estimate);
  return {
    sessionId,
    source: messages,
    refs: [...messages],
    chars,
    totalChars: chars.reduce((total, value) => total + value, 0),
  };
}

/**
 * AI SDK conversations are append-only while streaming: only the trailing
 * message is replaced. That lets token estimation update in O(1) per chunk.
 * Structural edits, compaction and session changes fall back to a full scan.
 */
export function updateConversationEstimate(
  previous: ConversationEstimateState | null,
  sessionId: string,
  messages: readonly UIMessage[],
  estimate: (message: UIMessage) => number = estimateMessageChars,
): ConversationEstimateState {
  if (!previous || previous.sessionId !== sessionId) {
    return rebuildEstimate(sessionId, messages, estimate);
  }
  if (previous.source === messages) return previous;

  const previousLength = previous.refs.length;
  const nextLength = messages.length;
  if (
    nextLength === previousLength + 1 &&
    (previousLength === 0 ||
      previous.refs[previousLength - 1] === messages[previousLength - 1])
  ) {
    const appended = messages[nextLength - 1];
    if (!appended) return rebuildEstimate(sessionId, messages, estimate);
    const appendedChars = estimate(appended);
    return {
      sessionId,
      source: messages,
      refs: [...previous.refs, appended],
      chars: [...previous.chars, appendedChars],
      totalChars: previous.totalChars + appendedChars,
    };
  }

  const lastIndex = nextLength - 1;
  const samePrefix =
    nextLength === previousLength &&
    (nextLength <= 1 ||
      previous.refs[lastIndex - 1] === messages[lastIndex - 1]);
  const sameTrailingId =
    lastIndex >= 0 && previous.refs[lastIndex]?.id === messages[lastIndex]?.id;
  if (samePrefix && sameTrailingId) {
    const trailing = messages[lastIndex];
    if (!trailing) return rebuildEstimate(sessionId, messages, estimate);
    const trailingChars = estimate(trailing);
    const refs = [...previous.refs];
    const chars = [...previous.chars];
    refs[lastIndex] = trailing;
    const previousChars = chars[lastIndex] ?? 0;
    chars[lastIndex] = trailingChars;
    return {
      sessionId,
      source: messages,
      refs,
      chars,
      totalChars: previous.totalChars - previousChars + trailingChars,
    };
  }

  return rebuildEstimate(sessionId, messages, estimate);
}

export function estimatedTokens(state: ConversationEstimateState): number {
  return Math.ceil(state.totalChars / 4);
}

export function shouldVirtualizeConversation(
  messageCount: number,
  totalChars: number,
): boolean {
  return (
    messageCount > CHAT_VIRTUALIZE_AFTER ||
    (messageCount > 4 && totalChars > CHAT_VIRTUALIZE_AFTER_CHARS)
  );
}

export function estimateMessageHeight(
  message: UIMessage,
  characterCount: number,
): number {
  let explicitLines = 0;
  let toolParts = 0;
  for (const part of message.parts) {
    if (part.type === "text" || part.type === "reasoning") {
      explicitLines +=
        ((part as { text?: string }).text?.match(/\n/g)?.length ?? 0) + 1;
    } else if (
      part.type === "dynamic-tool" ||
      (typeof part.type === "string" && part.type.startsWith("tool-"))
    ) {
      toolParts += 1;
    }
  }
  const wrappedLines = Math.ceil(characterCount / 58);
  const contentLines = Math.min(Math.max(explicitLines, wrappedLines), 1_600);
  const base = message.role === "user" ? 52 : 76;
  return base + contentLines * 18 + Math.min(toolParts, 20) * 44;
}

export type ConversationScrollSnapshot = {
  scrollTop: number;
  atBottom: boolean;
};

const scrollSnapshots = new Map<string, ConversationScrollSnapshot>();
const MAX_SCROLL_SNAPSHOTS = 20;

export function saveConversationScroll(
  sessionId: string,
  snapshot: ConversationScrollSnapshot,
): void {
  scrollSnapshots.delete(sessionId);
  scrollSnapshots.set(sessionId, snapshot);
  while (scrollSnapshots.size > MAX_SCROLL_SNAPSHOTS) {
    const oldest = scrollSnapshots.keys().next().value;
    if (typeof oldest !== "string") break;
    scrollSnapshots.delete(oldest);
  }
}

export function loadConversationScroll(
  sessionId: string,
): ConversationScrollSnapshot | null {
  return scrollSnapshots.get(sessionId) ?? null;
}

export function clearConversationScrollForTests(): void {
  scrollSnapshots.clear();
}
