/** How many recent stderr lines a child keeps for its exit message. */
export const STDERR_TAIL_LINES = 20;

/** Appends a stderr line to a bounded tail, skipping blank lines. */
export function pushStderrLine(tail: string[], line: string): void {
  const trimmed = line.trim();
  if (!trimmed) return;
  tail.push(trimmed.slice(0, 400));
  if (tail.length > STDERR_TAIL_LINES) tail.shift();
}

const NOISE = [
  /^Node\.js v\d/, // trailer Node prints after an uncaught error
  /^at\s/, // stack frames
  /^[{}[\]]+,?$/, // lone braces of a printed error object
  /^\^+$/, // caret line under the failing source
];
const ERROR_LINE = /(?:^|\s)(?:[A-Z]\w*)?Error\b:?|\berror\b:/;

/**
 * The line that explains why a child exited. A Node launcher that crashes
 * ends its stderr with "Node.js vX", stack frames and braces, so the last
 * line alone says nothing; prefer the last line that names an error.
 */
export function meaningfulStderr(tail: readonly string[]): string {
  const lines = tail.filter((line) => !NOISE.some((noise) => noise.test(line)));
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (ERROR_LINE.test(lines[index])) return lines[index];
  }
  return lines[lines.length - 1] ?? "";
}
