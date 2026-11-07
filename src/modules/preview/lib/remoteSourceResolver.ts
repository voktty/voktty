import type { GrepResponse } from "@/modules/ai/lib/native";
import { remoteSearchGrep } from "@/modules/ai/lib/remoteSearch";
import type { RemoteWorkspaceEnv } from "@/modules/remote";

export type RemoteElementQuery = {
  tagName: string;
  idAttr?: string | null;
  classList?: string[] | null;
  innerText?: string | null;
};

export type RemoteSourceMatch = {
  file_path: string;
  relative_path: string;
  line_number: number;
  column_number: number;
  framework: string;
  matched_by: string;
};

type Grep = (
  env: RemoteWorkspaceEnv,
  params: { root: string; pattern: string; glob?: string[]; maxResults?: number },
) => Promise<GrepResponse>;

const SOURCE_GLOBS = [
  "*.php",
  "*.html",
  "*.htm",
  "*.twig",
  "*.vue",
  "*.jsx",
  "*.tsx",
  "*.css",
  "*.scss",
];
const IDENT = /^[A-Za-z_][\w-]{0,63}$/;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Patterns for the element, most specific first. The id is unique in a page,
 * so it wins; a class or the visible text only narrow the search.
 */
export function remoteSourcePatterns(
  query: RemoteElementQuery,
): { pattern: string; matchedBy: string }[] {
  const patterns: { pattern: string; matchedBy: string }[] = [];
  if (query.idAttr && IDENT.test(query.idAttr)) {
    patterns.push({
      pattern: `id\\s*=\\s*["']${escapeRegex(query.idAttr)}["']`,
      matchedBy: "id",
    });
  }
  for (const cls of (query.classList ?? []).filter((c) => IDENT.test(c)).slice(0, 2)) {
    patterns.push({
      pattern: `class\\s*=\\s*["'][^"']*\\b${escapeRegex(cls)}\\b`,
      matchedBy: "class",
    });
  }
  const text = (query.innerText ?? "").trim().split(/\s*\n\s*/)[0] ?? "";
  if (text.length >= 4 && text.length <= 60) {
    patterns.push({ pattern: escapeRegex(text), matchedBy: "text" });
  }
  return patterns;
}

function frameworkOf(path: string): string {
  if (/\.blade\.php$/i.test(path)) return "laravel";
  if (/\.php$/i.test(path)) return "php";
  return "dom-generic";
}

/**
 * Finds where an inspected element is written in a remote project, using the
 * host's own search so no file is copied locally.
 */
export async function resolveRemoteElementSource(
  query: RemoteElementQuery,
  target: { env: RemoteWorkspaceEnv; root: string },
  grep: Grep = remoteSearchGrep,
): Promise<RemoteSourceMatch | null> {
  for (const { pattern, matchedBy } of remoteSourcePatterns(query)) {
    const result = await grep(target.env, {
      root: target.root,
      pattern,
      glob: SOURCE_GLOBS,
      maxResults: 20,
    });
    const hit =
      result.hits.find((candidate) => !/(^|\/)(vendor|node_modules|storage|cache)\//.test(candidate.rel)) ??
      null;
    if (hit) {
      return {
        file_path: hit.path,
        relative_path: hit.rel,
        line_number: hit.line,
        column_number: 1,
        framework: frameworkOf(hit.path),
        matched_by: matchedBy,
      };
    }
  }
  return null;
}
