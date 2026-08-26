export type WorkspaceTextEditPosition = {
  line: number;
  character: number;
};

export type WorkspaceTextEditRange = {
  start: WorkspaceTextEditPosition;
  end: WorkspaceTextEditPosition;
};

export type WorkspaceTextEdit = {
  range: WorkspaceTextEditRange;
  newText: string;
};

export type WorkspaceTextDocumentEdit = {
  path: string;
  edits: WorkspaceTextEdit[];
};

export type WorkspaceTextEditOccurrence = {
  line: number;
  column: number;
  before: string;
  replaced: string;
  replacement: string;
  after: string;
};

export type WorkspaceTextEditFilePreview = {
  path: string;
  mtime: number;
  hash: string;
  resultHash: string;
  edits: number;
  occurrences: WorkspaceTextEditOccurrence[];
  previewTruncated: boolean;
};

export type WorkspaceTextEditPreview = {
  files: WorkspaceTextEditFilePreview[];
  totalEdits: number;
};

export type WorkspaceTextEditTarget = WorkspaceTextDocumentEdit & {
  expectedMtime: number;
  expectedHash: string;
  expectedResultHash: string;
  expectedEdits: number;
};

export type WorkspaceTextEditRequest = {
  root: string;
  sourcePath: string;
  previousName: string;
  newName: string;
  documents: WorkspaceTextDocumentEdit[];
  totalEdits: number;
};

export type WorkspaceTextEditOutcome =
  | { status: "applied"; files: number; edits: number }
  | {
      status: "conflict";
      conflicts: string[];
      rolledBack: boolean;
      rollbackFailures: string[];
    }
  | {
      status: "failed";
      error: string;
      rolledBack: boolean;
      rollbackFailures: string[];
    };

export type NormalizedLspWorkspaceEdit =
  | {
      kind: "ready";
      documents: WorkspaceTextDocumentEdit[];
      totalEdits: number;
    }
  | { kind: "empty" }
  | {
      kind: "unsupported";
      reason: "resource-operation" | "non-file-uri" | "outside-workspace";
    }
  | {
      kind: "invalid";
      reason: "ambiguous-payload" | "invalid-edit" | "limit-exceeded";
    };
