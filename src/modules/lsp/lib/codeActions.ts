export const MAX_CODE_ACTIONS = 100;
export const MAX_WORKSPACE_EDIT_CHANGES = 5_000;
export const MAX_CODE_ACTION_DIAGNOSTICS = 1_000;
const MAX_ACTION_PAYLOAD_LENGTH = 128 * 1024;
const MAX_DIAGNOSTIC_CONTEXT_LENGTH = 512 * 1024;
const MAX_ACTION_TITLE_LENGTH = 300;
const MAX_ACTION_KIND_LENGTH = 120;
const MAX_DISABLED_REASON_LENGTH = 500;
const MAX_INSERTED_TEXT_LENGTH = 4 * 1024 * 1024;

export type LspPosition = { line: number; character: number };
export type LspRange = { start: LspPosition; end: LspPosition };
export type LspTextEdit = { range: LspRange; newText: string };

export type LspCommand = {
  title: string;
  command: string;
  arguments?: unknown[];
};

export type LspWorkspaceEdit = {
  changes?: Record<string, unknown>;
  documentChanges?: unknown[];
};

export type RawCodeActionDiagnostic = Record<string, unknown> & {
  range: LspRange;
  message: string;
};

export type NativeCodeAction = {
  id: string;
  title: string;
  kind: string | null;
  preferred: boolean;
  disabledReason: string | null;
  edit: LspWorkspaceEdit | null;
  command: LspCommand | null;
  needsResolve: boolean;
  payload: Record<string, unknown>;
};

export type PreparedWorkspaceEdit =
  | { kind: "none" }
  | { kind: "invalid" }
  | { kind: "requires-preview"; uris: string[] }
  | {
      kind: "applicable";
      changes: Array<{ from: number; to: number; insert: string }>;
    };

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function boundedString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

function isBoundedPayload(value: unknown): boolean {
  try {
    return JSON.stringify(value).length <= MAX_ACTION_PAYLOAD_LENGTH;
  } catch {
    return false;
  }
}

function readCommand(value: unknown, fallbackTitle?: string): LspCommand | null {
  const command = asRecord(value);
  if (!command) return null;
  const id = boundedString(command.command, MAX_ACTION_KIND_LENGTH);
  const title =
    boundedString(command.title, MAX_ACTION_TITLE_LENGTH) ?? fallbackTitle;
  if (!id || !title) return null;
  return {
    title,
    command: id,
    ...(Array.isArray(command.arguments)
      ? { arguments: command.arguments }
      : {}),
  };
}

function readWorkspaceEdit(value: unknown): LspWorkspaceEdit | null {
  const edit = asRecord(value);
  if (!edit) return null;
  if (!("changes" in edit) && !("documentChanges" in edit)) return null;
  return edit as LspWorkspaceEdit;
}

export function normalizeCodeActions(
  value: unknown,
): NativeCodeAction[] {
  if (!Array.isArray(value)) return [];
  const actions: NativeCodeAction[] = [];
  for (let index = 0; index < value.length; index += 1) {
    if (actions.length >= MAX_CODE_ACTIONS) break;
    const payload = asRecord(value[index]);
    if (!payload || !isBoundedPayload(payload)) continue;
    const title = boundedString(payload.title, MAX_ACTION_TITLE_LENGTH);
    if (!title) continue;

    const isCommand = typeof payload.command === "string";
    const command = isCommand
      ? readCommand(payload, title)
      : readCommand(payload.command, title);
    if (isCommand && !command) continue;
    const edit = isCommand ? null : readWorkspaceEdit(payload.edit);
    const disabled = asRecord(payload.disabled);
    actions.push({
      id: `${index}:${title}`,
      title,
      kind: boundedString(payload.kind, MAX_ACTION_KIND_LENGTH),
      preferred: payload.isPreferred === true,
      disabledReason: boundedString(
        disabled?.reason,
        MAX_DISABLED_REASON_LENGTH,
      ),
      edit,
      command,
      needsResolve:
        !isCommand && !edit && payload.data !== undefined && !disabled,
      payload,
    });
  }
  return actions.sort(
    (a, b) =>
      Number(b.preferred) - Number(a.preferred) ||
      a.title.localeCompare(b.title),
  );
}

function isPosition(value: unknown): value is LspPosition {
  const position = asRecord(value);
  return (
    !!position &&
    Number.isInteger(position.line) &&
    Number.isInteger(position.character) &&
    Number(position.line) >= 0 &&
    Number(position.character) >= 0
  );
}

function comparePosition(a: LspPosition, b: LspPosition): number {
  return a.line - b.line || a.character - b.character;
}

export function boundedCodeActionDiagnostics(
  value: unknown,
): RawCodeActionDiagnostic[] {
  if (!Array.isArray(value)) return [];
  const diagnostics: RawCodeActionDiagnostic[] = [];
  let payloadLength = 0;
  for (const candidate of value) {
    if (diagnostics.length >= MAX_CODE_ACTION_DIAGNOSTICS) break;
    const diagnostic = asRecord(candidate);
    const range = asRecord(diagnostic?.range);
    if (
      !diagnostic ||
      !range ||
      typeof diagnostic.message !== "string" ||
      !isPosition(range.start) ||
      !isPosition(range.end) ||
      comparePosition(range.end, range.start) < 0
    ) {
      continue;
    }
    let length: number;
    try {
      length = JSON.stringify(diagnostic).length;
    } catch {
      continue;
    }
    if (payloadLength + length > MAX_DIAGNOSTIC_CONTEXT_LENGTH) break;
    payloadLength += length;
    diagnostics.push(diagnostic as RawCodeActionDiagnostic);
  }
  return diagnostics;
}

export function diagnosticsOverlappingRange(
  diagnostics: readonly RawCodeActionDiagnostic[],
  range: LspRange,
): RawCodeActionDiagnostic[] {
  return diagnostics.filter(
    (diagnostic) =>
      comparePosition(diagnostic.range.start, range.end) <= 0 &&
      comparePosition(diagnostic.range.end, range.start) >= 0,
  );
}

function readTextEdit(value: unknown): LspTextEdit | null {
  const edit = asRecord(value);
  const range = asRecord(edit?.range);
  if (
    !edit ||
    !range ||
    typeof edit.newText !== "string" ||
    !isPosition(range.start) ||
    !isPosition(range.end)
  ) {
    return null;
  }
  return {
    range: { start: range.start, end: range.end },
    newText: edit.newText,
  };
}

function lineStarts(text: string): number[] {
  const starts = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10) starts.push(index + 1);
  }
  return starts;
}

function offsetAt(
  text: string,
  starts: readonly number[],
  position: LspPosition,
): number | null {
  const start = starts[position.line];
  if (start === undefined) return null;
  const next = starts[position.line + 1];
  const end = next === undefined ? text.length : next - 1;
  if (position.character > end - start) return null;
  return start + position.character;
}

export function prepareWorkspaceEditForDocument(
  snapshot: string,
  documentUri: string,
  value: unknown,
): PreparedWorkspaceEdit {
  const workspaceEdit = asRecord(value);
  if (!workspaceEdit) return { kind: "none" };

  const byUri = new Map<string, unknown[]>();
  const resourceOperations: unknown[] = [];
  const changes = asRecord(workspaceEdit.changes);
  if (changes) {
    for (const [uri, edits] of Object.entries(changes)) {
      if (!Array.isArray(edits)) return { kind: "invalid" };
      byUri.set(uri, [...(byUri.get(uri) ?? []), ...edits]);
    }
  } else if (workspaceEdit.changes !== undefined) {
    return { kind: "invalid" };
  }

  if (workspaceEdit.documentChanges !== undefined) {
    if (!Array.isArray(workspaceEdit.documentChanges)) {
      return { kind: "invalid" };
    }
    for (const change of workspaceEdit.documentChanges) {
      const record = asRecord(change);
      const textDocument = asRecord(record?.textDocument);
      if (
        record &&
        textDocument &&
        typeof textDocument.uri === "string" &&
        Array.isArray(record.edits)
      ) {
        const uri = textDocument.uri;
        byUri.set(uri, [...(byUri.get(uri) ?? []), ...record.edits]);
      } else {
        resourceOperations.push(change);
      }
    }
  }

  const uris = [...byUri.keys()];
  if (
    resourceOperations.length > 0 ||
    uris.some((uri) => uri !== documentUri)
  ) {
    return { kind: "requires-preview", uris };
  }

  const edits = byUri.get(documentUri) ?? [];
  if (edits.length === 0) return { kind: "none" };
  if (edits.length > MAX_WORKSPACE_EDIT_CHANGES) return { kind: "invalid" };

  const starts = lineStarts(snapshot);
  let insertedLength = 0;
  const prepared: Array<{ from: number; to: number; insert: string }> = [];
  for (const value of edits) {
    const edit = readTextEdit(value);
    if (!edit) return { kind: "invalid" };
    const from = offsetAt(snapshot, starts, edit.range.start);
    const to = offsetAt(snapshot, starts, edit.range.end);
    if (from === null || to === null || to < from) {
      return { kind: "invalid" };
    }
    insertedLength += edit.newText.length;
    if (insertedLength > MAX_INSERTED_TEXT_LENGTH) {
      return { kind: "invalid" };
    }
    prepared.push({ from, to, insert: edit.newText });
  }

  prepared.sort((a, b) => a.from - b.from || a.to - b.to);
  for (let index = 1; index < prepared.length; index += 1) {
    const previous = prepared[index - 1];
    const current = prepared[index];
    if (
      current.from < previous.to ||
      (current.from === previous.from && current.to === previous.to)
    ) {
      return { kind: "invalid" };
    }
  }
  return { kind: "applicable", changes: prepared };
}
