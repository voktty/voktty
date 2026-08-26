import type { WorkspaceEnv } from "@/modules/workspace";

export type WorkspaceSearchOptions = {
  query: string;
  regex: boolean;
  caseSensitive: boolean;
  wholeWord: boolean;
  include: string;
  exclude: string;
};

export type WorkspaceSearchHit = {
  path: string;
  rel: string;
  line: number;
  column: number;
  matchLength: number;
  previewColumn: number;
  text: string;
};

export type WorkspaceSearchResponse = {
  hits: WorkspaceSearchHit[];
  truncated: boolean;
  filesScanned: number;
};

export type WorkspaceSearchRequest = {
  pattern: string;
  root: string;
  include: string[];
  exclude: string[];
  caseSensitive: boolean;
  regex: boolean;
  wholeWord: boolean;
  showHidden: boolean;
  maxResults: number;
  workspace: WorkspaceEnv;
};

export type WorkspaceSearchFileGroup = {
  path: string;
  rel: string;
  hits: WorkspaceSearchHit[];
};

export type WorkspaceReplaceSpec = {
  pattern: string;
  replacement: string;
  regex: boolean;
  caseSensitive: boolean;
  wholeWord: boolean;
};

export type WorkspaceReplaceOccurrence = {
  line: number;
  column: number;
  before: string;
  matched: string;
  replacement: string;
  after: string;
};

export type WorkspaceReplaceFilePreview = {
  path: string;
  mtime: number;
  hash: string;
  replacements: number;
  occurrences: WorkspaceReplaceOccurrence[];
  previewTruncated: boolean;
};

export type WorkspaceReplacePreview = {
  files: WorkspaceReplaceFilePreview[];
  totalReplacements: number;
};

export type WorkspaceReplaceTarget = {
  path: string;
  expectedMtime: number;
  expectedHash: string;
  expectedReplacements: number;
};

export type WorkspaceReplaceOutcome =
  | { status: "applied"; files: number; replacements: number }
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
