export type CompletionContextSymbol = {
  name: string;
  kind: string;
  line: number;
};

export type CompletionContextDiagnostic = {
  severity: string;
  message: string;
  line: number;
};

export type CompletionContext = {
  currentBlock: string;
  neighborBefore: string;
  neighborAfter: string;
  symbols: string[];
  diagnostics: string[];
};

type Input = {
  content: string;
  cursor: number;
  symbols?: CompletionContextSymbol[];
  diagnostics?: CompletionContextDiagnostic[];
};

const MAX_BLOCK_CHARS = 6_000;
const NEIGHBOR_LINES = 20;

function lineBounds(content: string, cursor: number) {
  const start = content.lastIndexOf("\n", Math.max(0, cursor - 1)) + 1;
  const next = content.indexOf("\n", cursor);
  return { start, end: next === -1 ? content.length : next };
}

function enclosingBraceRange(
  content: string,
  cursor: number,
): { start: number; end: number } | null {
  const stack: number[] = [];
  let quote: string | null = null;
  let escaped = false;
  for (let index = 0; index < cursor; index += 1) {
    const char = content[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote && char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = quote === char ? null : quote ? quote : char;
      continue;
    }
    if (quote) continue;
    if (char === "{") stack.push(index);
    else if (char === "}") stack.pop();
  }
  const open = stack[stack.length - 1];
  if (open === undefined) return null;

  let depth = 1;
  quote = null;
  escaped = false;
  for (let index = open + 1; index < content.length; index += 1) {
    const char = content[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote && char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = quote === char ? null : quote ? quote : char;
      continue;
    }
    if (quote) continue;
    if (char === "{") depth += 1;
    else if (char === "}") depth -= 1;
    if (depth === 0) {
      const signatureStart = content.lastIndexOf("\n", open) + 1;
      return { start: signatureStart, end: index + 1 };
    }
  }
  return { start: content.lastIndexOf("\n", open) + 1, end: content.length };
}

function boundedBlock(content: string, cursor: number) {
  const line = lineBounds(content, cursor);
  const range = enclosingBraceRange(content, cursor) ?? line;
  if (range.end - range.start <= MAX_BLOCK_CHARS) return range;
  return {
    start: Math.max(range.start, cursor - Math.floor(MAX_BLOCK_CHARS / 2)),
    end: Math.min(range.end, cursor + Math.ceil(MAX_BLOCK_CHARS / 2)),
  };
}

function takeLines(value: string, count: number, fromEnd: boolean): string {
  const lines = value.split("\n");
  return (fromEnd ? lines.slice(-count) : lines.slice(0, count)).join("\n");
}

function finiteLine(value: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.trunc(value)) : 1;
}

export function buildCompletionContext({
  content,
  cursor,
  symbols = [],
  diagnostics = [],
}: Input): CompletionContext {
  const safeCursor = Number.isFinite(cursor)
    ? Math.max(0, Math.min(content.length, Math.trunc(cursor)))
    : 0;
  const block = boundedBlock(content, safeCursor);
  return {
    currentBlock: content.slice(block.start, block.end),
    neighborBefore: takeLines(content.slice(0, block.start), NEIGHBOR_LINES, true),
    neighborAfter: takeLines(content.slice(block.end), NEIGHBOR_LINES, false),
    symbols: symbols.slice(0, 12).map(({ name, kind, line }) =>
      `${String(kind).slice(0, 40)} ${String(name).slice(0, 120)} (line ${finiteLine(line)})`.slice(
        0,
        180,
      ),
    ),
    diagnostics: diagnostics
      .slice(0, 6)
      .map(({ severity, message, line }) =>
        `${String(severity).slice(0, 24)} line ${finiteLine(line)}: ${String(message).slice(0, 180)}`.slice(
          0,
          240,
        ),
      ),
  };
}
