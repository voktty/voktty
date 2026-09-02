import { useMemo } from "react";
import type { GithubPrDiff } from "../lib/githubTasks";
import { mergePrDiff, parsePrPatch, type PrDiffFile } from "../lib/prDiff";
import { blocksFromLines, type UnifiedLine } from "../lib/unifiedDiff";
import {
  UnifiedDiffView,
  type UnifiedDiffFileModel,
} from "./UnifiedDiffView";

const MAX_DISPLAY_LINES = 2000;

type Props = {
  diff: GithubPrDiff;
};

export function InboxPrDiff({ diff }: Props) {
  const files = useMemo(() => {
    const parsed = mergePrDiff(diff.files, parsePrPatch(diff.patch));
    return parsed.map((file) => toModel(file));
  }, [diff]);

  return (
    <UnifiedDiffView
      files={files}
      truncated={diff.truncated}
      totals={{ additions: diff.additions, deletions: diff.deletions }}
      fill={false}
    />
  );
}

function toModel(file: PrDiffFile): UnifiedDiffFileModel {
  const lines = file.lines.slice(0, MAX_DISPLAY_LINES).map(toUnifiedLine);
  return {
    id: file.path,
    path: file.path,
    label:
      file.status === "renamed" && file.previousPath
        ? `${file.previousPath} → ${file.path}`
        : file.path,
    binary: file.binary,
    emptyMessage:
      !file.binary && file.lines.length === 0 ? "No textual diff" : undefined,
    additions: file.additions,
    deletions: file.deletions,
    blocks: blocksFromLines(lines),
  };
}

function toUnifiedLine(line: PrDiffFile["lines"][number]): UnifiedLine {
  return {
    kind: line.kind,
    text: line.text,
    oldNumber: line.oldNumber,
    newNumber: line.newNumber,
  };
}
