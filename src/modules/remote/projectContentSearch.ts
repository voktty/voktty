import type { ProjectSearchResult } from "@/modules/harness/lib/search";

export function parseProjectContentSearch(
  value: unknown,
  namespaceRoot: string,
): ProjectSearchResult {
  const fail = () => new Error("Invalid remote content search result.");
  if (!value || typeof value !== "object" || Array.isArray(value)) throw fail();
  const { hits, truncated, cancelled } = value as Record<string, unknown>;
  if (
    !Array.isArray(hits) ||
    hits.length > 500 ||
    typeof truncated !== "boolean" ||
    (cancelled !== undefined && typeof cancelled !== "boolean")
  )
    throw fail();
  if (cancelled) throw new Error("Remote content search was cancelled.");
  let characters = 0;
  const root = namespaceRoot.replace(/\/+$/, "");
  const matches = hits.map((hit) => {
    if (!hit || typeof hit !== "object" || Array.isArray(hit)) throw fail();
    const { rel, text, line, column } = hit as Record<string, unknown>;
    if (
      typeof rel !== "string" ||
      !rel ||
      rel.length > 32768 ||
      /[\\:\x00-\x1f\x7f]/.test(rel) ||
      rel.split("/").some((part) => !part || part === "." || part === "..") ||
      typeof text !== "string" ||
      text.length > 8192 ||
      typeof line !== "number" ||
      !Number.isSafeInteger(line) ||
      line < 1 ||
      typeof column !== "number" ||
      !Number.isSafeInteger(column) ||
      column < 1
    )
      throw fail();
    const path = `${root}/${rel}`;
    characters += path.length + rel.length + text.length;
    if (characters > 4 * 1024 * 1024) throw fail();
    return { path, relative: rel, line, column, preview: text };
  });
  return { matches, truncated };
}
