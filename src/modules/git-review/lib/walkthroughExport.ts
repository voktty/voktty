import type { WalkthroughDocument } from "../types";

export function exportWalkthroughToMarkdown(doc: WalkthroughDocument): string {
  const lines: string[] = [];
  lines.push(`# ${doc.title}`);
  lines.push("");
  lines.push(
    `> **Coverage:** ${Math.round(doc.coverageRatio * 100)}% (${
      doc.totalChangedFiles - doc.unmentionedFiles.length
    }/${doc.totalChangedFiles} changed files referenced)`,
  );
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(doc.summary);
  lines.push("");
  lines.push("## Changes by Intent");
  lines.push("");

  for (const section of doc.sections) {
    lines.push(`### ${section.title}`);
    lines.push(`*Intent:* ${section.intent}`);
    lines.push("");
    lines.push(section.description);
    lines.push("");

    if (section.references.length > 0) {
      lines.push("**Key References:**");
      for (const ref of section.references) {
        const mark = ref.status === "valid" ? "✓" : "⚠";
        const label = ref.label ? ` — *${ref.label}*` : "";
        lines.push(`- \`${ref.path}#L${ref.startLine}-L${ref.endLine}\` ${mark}${label}`);
      }
      lines.push("");
    }

    if (section.risks && section.risks.length > 0) {
      lines.push("**Considerations & Risks:**");
      for (const risk of section.risks) {
        lines.push(`- ${risk}`);
      }
      lines.push("");
    }
  }

  if (doc.unmentionedFiles.length > 0) {
    lines.push("## Unmentioned Files");
    lines.push("");
    for (const f of doc.unmentionedFiles) {
      lines.push(`- \`${f}\``);
    }
    lines.push("");
  }

  return lines.join("\n");
}
