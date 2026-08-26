export type SuggestionPart = "token" | "line";

export function partialSuggestionChunk(
  suggestion: string,
  part: SuggestionPart,
): string {
  if (!suggestion) return "";
  if (part === "line") {
    const newline = suggestion.indexOf("\n");
    return newline === -1 ? suggestion : suggestion.slice(0, newline + 1);
  }
  return (
    suggestion.match(/^\s*[\p{L}\p{N}_$]+/u)?.[0] ??
    suggestion.match(/^\s*[^\p{L}\p{N}\s_$]+/u)?.[0] ??
    suggestion.match(/^\s+/)?.[0] ??
    suggestion
  );
}
