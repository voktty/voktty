import type {
  WorkspaceReplaceFilePreview,
  WorkspaceReplaceSpec,
  WorkspaceReplaceTarget,
  WorkspaceSearchOptions,
} from "@/modules/workspace-search/types";

export function workspaceReplaceSpec(
  options: WorkspaceSearchOptions,
  replacement: string,
): WorkspaceReplaceSpec {
  return {
    pattern: options.query,
    replacement,
    regex: options.regex,
    caseSensitive: options.caseSensitive,
    wholeWord: options.wholeWord,
  };
}

export function workspaceReplaceTargets(
  files: WorkspaceReplaceFilePreview[],
  selected: ReadonlySet<string>,
): WorkspaceReplaceTarget[] {
  return files
    .filter((file) => selected.has(file.path))
    .map((file) => ({
      path: file.path,
      expectedMtime: file.mtime,
      expectedHash: file.hash,
      expectedReplacements: file.replacements,
    }));
}

export function normalizeWorkspacePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "").toLocaleLowerCase();
}
