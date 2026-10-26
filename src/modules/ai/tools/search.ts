import { capturedFileTool } from "@/modules/ai/tools/capturedFileTool";
import { z } from "zod";
import {
  checkCanonicalWorkspacePath,
  checkReadable,
  checkReadableCanonical,
  checkWorkspacePath,
} from "../lib/security";
import { resolvePath, type ToolContext } from "./context";

function resolveRoot(
  rawRoot: string | undefined,
  captured: { directory: string; root: string },
): { ok: true; path: string } | { ok: false; error: string } {
  if (rawRoot && rawRoot.trim().length > 0) {
    try {
      return { ok: true, path: resolvePath(rawRoot, captured.directory) };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }
  return { ok: true, path: captured.root };
}

const MAX_LINE_LEN = 160;

function clipLine(s: string): string {
  if (s.length <= MAX_LINE_LEN) return s;
  return `${s.slice(0, MAX_LINE_LEN)}…[+${s.length - MAX_LINE_LEN}]`;
}

function pathForSafety(path: string, root: string): string {
  if (path.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(path)) return path;
  const sep = root.includes("\\") && !root.includes("/") ? "\\" : "/";
  return root.endsWith(sep) ? `${root}${path}` : `${root}${sep}${path}`;
}

function isReadableSearchHit(path: string, root: string): boolean {
  const resolved = pathForSafety(path, root);
  return checkReadable(resolved).ok && checkWorkspacePath(resolved, root).ok;
}

export function buildSearchTools(ctx: ToolContext) {
  return {
    grep: capturedFileTool(ctx, "grep", {
      description:
        "Search file contents in the workspace using a regular expression. Honors .gitignore. Returns up to `max_results` (default 30, max 500) `{path, line, text}` hits, with a `truncated` flag when more existed. Long match lines are clipped to 160 chars. Use this for code navigation — do NOT brute-force read_file across the tree. Narrow with `glob` when you can; raise `max_results` only if the first batch truly isn't enough.",
      inputSchema: z.object({
        pattern: z
          .string()
          .describe(
            "Regex pattern (Rust ripgrep dialect). Anchor and escape literal characters as needed.",
          ),
        root: z
          .string()
          .optional()
          .describe(
            "Root to search under. Defaults to the captured workspace root.",
          ),
        glob: z
          .array(z.string())
          .optional()
          .describe(
            "Optional include-globs over relative paths, e.g. ['**/*.ts', 'src/**/*.tsx'].",
          ),
        case_insensitive: z.boolean().optional(),
        max_results: z.number().int().min(1).max(500).optional(),
      }),
      execute: async (
        { pattern, root, glob, case_insensitive, max_results },
        captured,
      ) => {
        const r = resolveRoot(root, captured);
        if (!r.ok) return { error: r.error };
        const safety = await checkReadableCanonical(
          r.path,
          captured.io.canonicalize,
        );
        if (!safety.ok) return { error: safety.reason, root: r.path };
        r.path = safety.canonical;
        const boundary = await checkCanonicalWorkspacePath(
          r.path,
          captured.root,
          captured.io.canonicalize,
        );
        if (!boundary.ok) return { error: boundary.reason, root: r.path };
        const cap = Math.min(max_results ?? 30, 500);
        try {
          const res = await captured.io.grep({
            pattern,
            root: r.path,
            glob,
            caseInsensitive: case_insensitive,
            maxResults: cap,
          });
          const hits = res.hits.filter((h) =>
            isReadableSearchHit(h.path, r.path),
          );
          return {
            root: r.path,
            hits: hits.map((h) => ({
              path: h.path,
              rel: h.rel,
              line: h.line,
              text: clipLine(h.text),
            })),
            truncated: res.truncated,
            files_scanned: res.files_scanned,
          };
        } catch (e) {
          return { error: String(e), root: r.path };
        }
      },
    }),

    glob: capturedFileTool(ctx, "glob", {
      description:
        "Find files by path pattern (gitignore-aware). Use over `list_directory` when you want all matches recursively. Patterns use globset syntax: `**/*.ts`, `src/**/test_*.py`. Returns up to `max_results` matches.",
      inputSchema: z.object({
        pattern: z.string().describe("Glob pattern over relative paths."),
        root: z.string().optional(),
        max_results: z.number().int().min(1).max(2000).optional(),
      }),
      execute: async ({ pattern, root, max_results }, captured) => {
        const r = resolveRoot(root, captured);
        if (!r.ok) return { error: r.error };
        const safety = await checkReadableCanonical(
          r.path,
          captured.io.canonicalize,
        );
        if (!safety.ok) return { error: safety.reason, root: r.path };
        r.path = safety.canonical;
        const boundary = await checkCanonicalWorkspacePath(
          r.path,
          captured.root,
          captured.io.canonicalize,
        );
        if (!boundary.ok) return { error: boundary.reason, root: r.path };
        try {
          const res = await captured.io.glob({
            pattern,
            root: r.path,
            maxResults: max_results,
          });
          return {
            root: r.path,
            hits: res.hits.filter((h) => isReadableSearchHit(h.path, r.path)),
            truncated: res.truncated,
          };
        } catch (e) {
          return { error: String(e), root: r.path };
        }
      },
    }),
  } as const;
}
