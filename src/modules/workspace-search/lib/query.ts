import type { WorkspaceEnv } from "@/modules/workspace";
import type {
  WorkspaceSearchOptions,
  WorkspaceSearchRequest,
} from "@/modules/workspace-search/types";

export const WORKSPACE_SEARCH_MIN_QUERY = 1;
export const WORKSPACE_SEARCH_MAX_RESULTS = 2_000;

export const DEFAULT_WORKSPACE_SEARCH_OPTIONS: WorkspaceSearchOptions = {
  query: "",
  regex: false,
  caseSensitive: false,
  wholeWord: false,
  include: "",
  exclude: "",
};

export function splitGlobList(value: string): string[] {
  const patterns: string[] = [];
  let current = "";
  let braceDepth = 0;
  let escaped = false;

  for (const character of value) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (character === "\\") {
      current += character;
      escaped = true;
      continue;
    }
    if (character === "{") braceDepth += 1;
    if (character === "}" && braceDepth > 0) braceDepth -= 1;
    if (character === "," && braceDepth === 0) {
      const pattern = current.trim();
      if (pattern) patterns.push(pattern);
      current = "";
      continue;
    }
    current += character;
  }

  const pattern = current.trim();
  if (pattern) patterns.push(pattern);
  return [...new Set(patterns)];
}

export function createWorkspaceSearchRequest(
  root: string,
  workspace: WorkspaceEnv,
  options: WorkspaceSearchOptions,
  showHidden: boolean,
): WorkspaceSearchRequest | null {
  const pattern = options.query.trim();
  if (pattern.length < WORKSPACE_SEARCH_MIN_QUERY) return null;
  return {
    pattern,
    root,
    include: splitGlobList(options.include),
    exclude: splitGlobList(options.exclude),
    caseSensitive: options.caseSensitive,
    regex: options.regex,
    wholeWord: options.wholeWord,
    showHidden,
    maxResults: WORKSPACE_SEARCH_MAX_RESULTS,
    workspace,
  };
}
