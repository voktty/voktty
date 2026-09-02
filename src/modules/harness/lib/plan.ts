/** First markdown heading, or the first non-empty prose line. */
export function planTitle(text: string): string {
  const heading = text.match(/^\s{0,3}#{1,6}\s+(.+)$/m);
  if (heading) return unwrapMarkdown(heading[1]);
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("```") || trimmed === "---") continue;
    return unwrapMarkdown(trimmed).slice(0, 80) || "Plan";
  }
  return "Plan";
}

/** First prose paragraph that is not the title heading. */
export function planSummary(text: string): string {
  const title = planTitle(text);
  const parts: string[] = [];
  let inFence = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence || /^\s{0,3}#{1,6}\s+/.test(line)) continue;
    const trimmed = line.trim();
    if (!trimmed || trimmed === "---") continue;
    const next = unwrapMarkdown(trimmed.replace(/^[-*+]\s+/, ""));
    if (!next || next === title) continue;
    parts.push(next);
    if (parts.join(" ").length >= 140) break;
  }
  const summary = parts.join(" ");
  if (!summary) return "";
  return summary.length > 140 ? `${summary.slice(0, 139)}…` : summary;
}

export function planMeta(text: string): string[] {
  const parts: string[] = ["Plan"];
  const headings = text.match(/^\s{0,3}#{1,6}\s+/gm)?.length ?? 0;
  if (headings > 1) parts.push(`${headings} sections`);
  if (/```\s*mermaid\b/i.test(text)) parts.push("diagram");
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  if (words > 0) parts.push(`${words} words`);
  return parts;
}

function unwrapMarkdown(value: string): string {
  return value
    .replace(/!\[[^\]]*]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/[*_`]+/g, "")
    .trim();
}
