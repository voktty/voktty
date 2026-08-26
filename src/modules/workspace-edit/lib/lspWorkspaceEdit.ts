import { workspaceRelativePath } from "@/modules/quick-open";
import { fileUriToPath } from "@/modules/lsp/lib/uri";
import type {
  NormalizedLspWorkspaceEdit,
  WorkspaceTextDocumentEdit,
  WorkspaceTextEdit,
  WorkspaceTextEditPosition,
} from "../types";

export const MAX_WORKSPACE_TEXT_EDIT_FILES = 200;
export const MAX_WORKSPACE_TEXT_EDITS = 5_000;
const MAX_INSERTED_TEXT_BYTES = 4 * 1024 * 1024;

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function position(value: unknown): WorkspaceTextEditPosition | null {
  if (!isRecord(value)) return null;
  const { line, character } = value;
  return Number.isSafeInteger(line) &&
    Number(line) >= 0 &&
    Number.isSafeInteger(character) &&
    Number(character) >= 0
    ? { line: Number(line), character: Number(character) }
    : null;
}

function textEdit(value: unknown): WorkspaceTextEdit | null {
  if (!isRecord(value) || typeof value.newText !== "string") return null;
  if (!isRecord(value.range)) return null;
  const start = position(value.range.start);
  const end = position(value.range.end);
  if (!start || !end) return null;
  if (
    end.line < start.line ||
    (end.line === start.line && end.character < start.character)
  ) {
    return null;
  }
  return { range: { start, end }, newText: value.newText };
}

function relativeDocumentPath(
  workspaceRoot: string,
  uri: string,
): string | "non-file-uri" | "outside-workspace" {
  let path: string | null;
  try {
    path = fileUriToPath(uri);
  } catch {
    return "non-file-uri";
  }
  if (!path) return "non-file-uri";
  const relative = workspaceRelativePath(workspaceRoot, path);
  if (!relative) return "outside-workspace";
  return relative.replace(/\\/g, "/");
}

export function normalizeLspWorkspaceEdit(
  workspaceRoot: string,
  value: unknown,
): NormalizedLspWorkspaceEdit {
  if (!isRecord(value)) return { kind: "invalid", reason: "invalid-edit" };
  const hasChanges = Object.prototype.hasOwnProperty.call(value, "changes");
  const hasDocumentChanges = Object.prototype.hasOwnProperty.call(
    value,
    "documentChanges",
  );
  if (hasChanges && hasDocumentChanges) {
    return { kind: "invalid", reason: "ambiguous-payload" };
  }

  const byPath = new Map<string, WorkspaceTextEdit[]>();
  let totalEdits = 0;
  let insertedTextBytes = 0;

  const add = (
    uri: unknown,
    rawEdits: unknown,
  ):
    | null
    | "non-file-uri"
    | "outside-workspace"
    | "invalid-edit"
    | "limit-exceeded" => {
    if (typeof uri !== "string" || !Array.isArray(rawEdits)) {
      return "invalid-edit";
    }
    const path = relativeDocumentPath(workspaceRoot, uri);
    if (path === "non-file-uri" || path === "outside-workspace") return path;
    const edits = byPath.get(path) ?? [];
    for (const rawEdit of rawEdits) {
      const edit = textEdit(rawEdit);
      if (!edit) return "invalid-edit";
      totalEdits += 1;
      insertedTextBytes += new TextEncoder().encode(edit.newText).byteLength;
      if (
        totalEdits > MAX_WORKSPACE_TEXT_EDITS ||
        insertedTextBytes > MAX_INSERTED_TEXT_BYTES
      ) {
        return "limit-exceeded";
      }
      edits.push(edit);
    }
    if (edits.length > 0) byPath.set(path, edits);
    if (byPath.size > MAX_WORKSPACE_TEXT_EDIT_FILES) return "limit-exceeded";
    return null;
  };

  if (hasChanges) {
    if (!isRecord(value.changes)) {
      return { kind: "invalid", reason: "invalid-edit" };
    }
    for (const [uri, edits] of Object.entries(value.changes)) {
      const error = add(uri, edits);
      if (error) return normalizeFailure(error);
    }
  } else if (hasDocumentChanges) {
    if (!Array.isArray(value.documentChanges)) {
      return { kind: "invalid", reason: "invalid-edit" };
    }
    for (const change of value.documentChanges) {
      if (!isRecord(change)) {
        return { kind: "invalid", reason: "invalid-edit" };
      }
      if (typeof change.kind === "string") {
        return { kind: "unsupported", reason: "resource-operation" };
      }
      if (!isRecord(change.textDocument)) {
        return { kind: "invalid", reason: "invalid-edit" };
      }
      const error = add(change.textDocument.uri, change.edits);
      if (error) return normalizeFailure(error);
    }
  }

  if (totalEdits === 0) return { kind: "empty" };
  const documents: WorkspaceTextDocumentEdit[] = [...byPath.entries()]
    .map(([path, edits]) => ({ path, edits }))
    .sort((left, right) => left.path.localeCompare(right.path));
  return { kind: "ready", documents, totalEdits };
}

function normalizeFailure(
  reason:
    | "non-file-uri"
    | "outside-workspace"
    | "invalid-edit"
    | "limit-exceeded",
): NormalizedLspWorkspaceEdit {
  return reason === "non-file-uri" || reason === "outside-workspace"
    ? { kind: "unsupported", reason }
    : { kind: "invalid", reason };
}
