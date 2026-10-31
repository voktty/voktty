export function supportsClaudeMemoryReplay(output: string): boolean {
  if (output.length > 256) return false;
  const match = /^(\d+)\.(\d+)\.(\d+)(?: \(Claude Code\))?$/.exec(
    output.trim(),
  );
  if (!match) return false;
  const [major, minor, patch] = match.slice(1).map(Number);
  if (![major, minor, patch].every(Number.isSafeInteger)) return false;
  return (
    major > 2 || (major === 2 && (minor > 1 || (minor === 1 && patch >= 312)))
  );
}

export function buildClaudeMemoryInput(
  message: Record<string, unknown>,
  prefix: string | null,
  uuid: string,
  sessionId: string,
): Record<string, unknown> {
  const original = message.message as { role: string; content: unknown[] };
  return {
    ...message,
    uuid,
    session_id: sessionId,
    client_composed: true,
    origin: { kind: "human" },
    message: {
      ...original,
      content: prefix
        ? [{ type: "text", text: prefix }, ...original.content]
        : original.content,
    },
  };
}

function sameJson(expected: unknown, actual: unknown): boolean {
  if (expected === actual) return true;
  if (
    !expected ||
    !actual ||
    typeof expected !== "object" ||
    typeof actual !== "object"
  )
    return false;
  if (Array.isArray(expected))
    return (
      Array.isArray(actual) &&
      expected.length === actual.length &&
      expected.every((value, index) => sameJson(value, actual[index]))
    );
  if (Array.isArray(actual)) return false;
  const keys = Object.keys(expected);
  const actualKeys = Object.keys(actual);
  return (
    keys.length === actualKeys.length &&
    keys.every(
      (key) =>
        actualKeys.includes(key) &&
        sameJson(
          (expected as Record<string, unknown>)[key],
          (actual as Record<string, unknown>)[key],
        ),
    )
  );
}

export function isClaudeMemoryEcho(
  record: Record<string, unknown>,
  expected: Record<string, unknown>,
): boolean {
  return (
    record.type === "user" &&
    record.isReplay === true &&
    (record.isSynthetic === undefined || record.isSynthetic === false) &&
    record.parent_tool_use_id === null &&
    record.uuid === expected.uuid &&
    record.session_id === expected.session_id &&
    (record.client_composed === undefined || record.client_composed === true) &&
    sameJson(expected.origin, record.origin) &&
    sameJson(expected.message, record.message)
  );
}
