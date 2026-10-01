import { useMemo } from "react";

export function splitMarkdownFrontmatter(text: string): {
  metadata: string | null;
  body: string;
} {
  const opening = text.match(/^\uFEFF?---[ \t]*\r?\n/);
  if (!opening) return { metadata: null, body: text };

  const remaining = text.slice(opening[0].length);
  const closing = /^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/m.exec(remaining);
  if (!closing) return { metadata: null, body: text };

  return {
    metadata: remaining.slice(0, closing.index).replace(/\r?\n$/, ""),
    body: remaining.slice(closing.index + closing[0].length),
  };
}

function renderSimpleMarkdown(body: string) {
  const lines = body.split(/\r?\n/);
  return lines.map((line, idx) => {
    if (line.startsWith("# ")) {
      return (
        <h1 key={idx} className="text-xl font-bold text-white mb-2">
          {line.slice(2)}
        </h1>
      );
    }
    if (line.startsWith("## ")) {
      return (
        <h2 key={idx} className="text-lg font-semibold text-white mb-1.5">
          {line.slice(3)}
        </h2>
      );
    }
    if (!line.trim()) {
      return <div key={idx} className="h-2" />;
    }
    return (
      <p key={idx} className="text-neutral-300 mb-1">
        {line}
      </p>
    );
  });
}

/** Keep the skill's YAML header readable without interpreting it as Markdown. */
export function SkillDocumentPreview({
  text,
  metadataLabel = "Skill metadata",
}: {
  text: string;
  metadataLabel?: string;
}) {
  const document = useMemo(() => splitMarkdownFrontmatter(text), [text]);

  return (
    <div className="flex flex-col gap-4 font-sans text-sm text-neutral-200">
      {document.metadata !== null ? (
        <details className="rounded-lg border border-white/10 bg-white/5 overflow-hidden">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2 text-[12px] font-medium text-neutral-400 hover:text-white transition-colors">
            <span className="text-[10px]">▶</span>
            {metadataLabel}
          </summary>
          <pre className="whitespace-pre-wrap break-words border-t border-white/10 bg-black/40 px-3 py-2 font-mono text-[12px] leading-5 text-neutral-300">
            {document.metadata}
          </pre>
        </details>
      ) : null}
      <div className="prose prose-invert max-w-none">
        {renderSimpleMarkdown(document.body)}
      </div>
    </div>
  );
}
