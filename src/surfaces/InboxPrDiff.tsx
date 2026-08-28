import {
  ChevronDown,
  ChevronRight,
  FoldVertical,
  UnfoldVertical,
} from "lucide-react";
import { useMemo, useState } from "react";
import { FileTypeIcon } from "../chrome/FileTypeIcon";
import { basename } from "../lib/fs";
import type { GithubPrDiff } from "../lib/githubTasks";
import {
  mergePrDiff,
  parsePrPatch,
  type PrDiffFile,
  type PrDiffLine,
} from "../lib/prDiff";

const MAX_DISPLAY_LINES = 2000;

const KEYWORDS = new Set([
  "import",
  "export",
  "from",
  "type",
  "interface",
  "const",
  "let",
  "var",
  "function",
  "return",
  "if",
  "else",
  "for",
  "while",
  "switch",
  "case",
  "class",
  "struct",
  "enum",
  "extends",
  "implements",
  "new",
  "async",
  "await",
  "try",
  "catch",
  "throw",
  "true",
  "false",
  "null",
  "undefined",
  "this",
  "in",
  "of",
  "as",
  "is",
  "void",
  "public",
  "private",
  "protected",
  "static",
  "default",
  "package",
  "def",
  "func",
]);

type Props = {
  diff: GithubPrDiff;
};

export function InboxPrDiff({ diff }: Props) {
  const files = useMemo(
    () => mergePrDiff(diff.files, parsePrPatch(diff.patch)),
    [diff],
  );
  const [open, setOpen] = useState<Set<string>>(() => {
    const next = new Set<string>();
    if (files[0]) next.add(files[0].path);
    return next;
  });

  if (files.length === 0) {
    return <p className="text-[13px] text-content/45">No file changes</p>;
  }

  const fileLabel = files.length === 1 ? "1 file" : `${files.length} files`;

  return (
    <div className="inbox-pr-diff flex flex-col gap-3">
      <div className="flex items-center gap-3 text-[12px]">
        <span className="text-content/70">{fileLabel}</span>
        <DiffCounts additions={diff.additions} deletions={diff.deletions} />
        <span className="ml-auto flex items-center gap-0.5">
          <button
            type="button"
            title="Expand all files"
            aria-label="Expand all files"
            onClick={() => setOpen(new Set(files.map((file) => file.path)))}
            className="grid size-7 place-items-center rounded-md text-content/45 hover:bg-content/10 hover:text-content"
          >
            <UnfoldVertical className="size-3.5" strokeWidth={1.75} />
          </button>
          <button
            type="button"
            title="Collapse all files"
            aria-label="Collapse all files"
            disabled={open.size === 0}
            onClick={() => setOpen(new Set())}
            className="grid size-7 place-items-center rounded-md text-content/45 hover:bg-content/10 hover:text-content disabled:opacity-40"
          >
            <FoldVertical className="size-3.5" strokeWidth={1.75} />
          </button>
        </span>
      </div>
      {diff?.truncated ? (
        <p className="text-[12px] text-content/45">
          Diff is too large to display in full. File list is shown without patches.
        </p>
      ) : null}
      <div className="flex flex-col gap-2">
        {files.map((file) => (
          <PrFileCard
            key={file.path}
            file={file}
            expanded={open.has(file.path)}
            onToggle={() => {
              setOpen((current) => {
                const next = new Set(current);
                if (next.has(file.path)) next.delete(file.path);
                else next.add(file.path);
                return next;
              });
            }}
          />
        ))}
      </div>
    </div>
  );
}

function PrFileCard({
  file,
  expanded,
  onToggle,
}: {
  file: PrDiffFile;
  expanded: boolean;
  onToggle: () => void;
}) {
  const Chevron = expanded ? ChevronDown : ChevronRight;
  const name = basename(file.path);
  const label =
    file.status === "renamed" && file.previousPath
      ? `${file.previousPath} → ${file.path}`
      : file.path;

  return (
    <div className="overflow-hidden rounded-md border border-content/10">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-content/5"
      >
        <Chevron className="size-3.5 shrink-0 text-content/45" strokeWidth={1.75} />
        <FileTypeIcon name={name} isDir={false} size={16} />
        <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-content/85" title={label}>
          {label}
        </span>
        <DiffCounts additions={file.additions} deletions={file.deletions} />
      </button>
      {expanded ? <PrFileBody file={file} /> : null}
    </div>
  );
}

function PrFileBody({ file }: { file: PrDiffFile }) {
  if (file.binary) {
    return (
      <p className="border-t border-content/10 px-3 py-3 text-[12px] text-content/45">
        Binary file changed
      </p>
    );
  }
  if (file.lines.length === 0) {
    return (
      <p className="border-t border-content/10 px-3 py-3 text-[12px] text-content/45">
        No textual diff
      </p>
    );
  }
  const lines = file.lines.slice(0, MAX_DISPLAY_LINES);
  const clipped = file.lines.length > lines.length;
  return (
    <div className="inbox-pr-diff overflow-x-auto border-t border-content/10">
      {lines.map((line, index) => (
        <DiffLineRow
          key={`${line.kind}-${line.oldNumber ?? ""}-${line.newNumber ?? ""}-${index}`}
          line={line}
        />
      ))}
      {clipped ? (
        <p className="px-3 py-2 text-[11px] text-content/40">
          Diff truncated after {MAX_DISPLAY_LINES.toLocaleString()} lines
        </p>
      ) : null}
    </div>
  );
}

function DiffLineRow({ line }: { line: PrDiffLine }) {
  if (line.kind === "hunk") {
    return (
      <div className="bg-content/5 px-3 py-0.5 font-mono text-[11px] text-content/40">
        {line.text}
      </div>
    );
  }
  const bg =
    line.kind === "add"
      ? "bg-teal-800/20"
      : line.kind === "del"
        ? "bg-rose-800/20"
        : "";
  const bar =
    line.kind === "add"
      ? "bg-teal-400"
      : line.kind === "del"
        ? "bg-rose-400"
        : "bg-transparent";
  const mark = line.kind === "add" ? "+" : line.kind === "del" ? "−" : " ";
  const markColor =
    line.kind === "add"
      ? "text-teal-400"
      : line.kind === "del"
        ? "text-rose-400"
        : "text-transparent";

  return (
    <div className={`relative flex min-w-max items-baseline ${bg}`}>
      <span className={`absolute inset-y-0 left-0 w-0.5 ${bar}`} />
      <span className="w-10 shrink-0 pr-1 text-right font-mono text-[10px] tabular-nums text-content/35">
        {line.oldNumber ?? ""}
      </span>
      <span className="w-10 shrink-0 pr-1 text-right font-mono text-[10px] tabular-nums text-content/35">
        {line.newNumber ?? ""}
      </span>
      <span className={`w-3 shrink-0 text-center font-mono text-[10px] font-bold ${markColor}`}>
        {mark}
      </span>
      <span className="whitespace-pre pr-3 font-mono text-[12px] leading-5">
        {highlight(line.text, line.kind === "context")}
      </span>
    </div>
  );
}

function DiffCounts({
  additions,
  deletions,
}: {
  additions: number;
  deletions: number;
}) {
  if (additions <= 0 && deletions <= 0) return null;
  return (
    <span className="flex shrink-0 items-center gap-1.5 font-mono text-[11px] font-semibold tabular-nums">
      {additions > 0 ? <span className="text-emerald-400">+{additions}</span> : null}
      {deletions > 0 ? <span className="text-red-400">-{deletions}</span> : null}
    </span>
  );
}

function highlight(text: string, dimmed: boolean) {
  const dim = dimmed ? "opacity-70" : "";
  const trimmed = text.trimStart();
  if (
    trimmed.startsWith("//") ||
    trimmed.startsWith("///") ||
    trimmed.startsWith("#")
  ) {
    return <span className={`text-content/45 ${dim}`}>{text}</span>;
  }

  const parts: { text: string; color: string }[] = [];
  const regex = /\b([A-Za-z_][A-Za-z0-9_]*)\b/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text))) {
    if (match.index > last) {
      parts.push({ text: text.slice(last, match.index), color: "" });
    }
    const token = match[1];
    const color = KEYWORDS.has(token)
      ? "text-teal-300"
      : /^[A-Z]/.test(token)
        ? "text-amber-200/90"
        : "";
    parts.push({ text: token, color });
    last = match.index + token.length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), color: "" });

  return (
    <span className={`text-content/80 ${dim}`}>
      {parts.map((part, index) =>
        part.color ? (
          <span key={index} className={part.color}>
            {part.text}
          </span>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </span>
  );
}
