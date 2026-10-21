import { invokeWorkspace } from "@/modules/harness/lib/fs";

export type ProjectSearchMatch = {
  path: string;
  relative: string;
  line: number;
  column: number;
  preview: string;
};

export type ProjectSearchResult = {
  matches: ProjectSearchMatch[];
  truncated: boolean;
};

export type ProjectSearchOptions = {
  cwd: string;
  query: string;
  caseSensitive?: boolean;
  wholeWord?: boolean;
  regex?: boolean;
  include?: string;
  exclude?: string;
};

export type EditorNavigation = {
  line: number;
  column?: number;
};

export type EditorNavigationTarget = EditorNavigation & {
  path: string;
  token: number;
};

export type FileOpenOptions = {
  /** The caller obtained this concrete path from the filesystem or file index. */
  exact?: boolean;
  /** The repository root the opened change list belongs to. A working-tree diff
   * must be resolved against it, not against the session folder, which can sit
   * below the repository or reach it through a different path. */
  repoRoot?: string;
};

export type OpenFileFn = (
  path: string,
  navigation?: EditorNavigation,
  options?: FileOpenOptions,
) => void;

export function normalizeEditorPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "") || path;
}

export function editorPathsEqual(a: string, b: string): boolean {
  return normalizeEditorPath(a) === normalizeEditorPath(b);
}

export function searchProject(
  options: ProjectSearchOptions,
): Promise<ProjectSearchResult> {
  return invokeWorkspace<ProjectSearchResult>("search_project", { options });
}
