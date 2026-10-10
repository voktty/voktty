import type {
  GitBranchComparison,
  GitDiffResult,
} from "@/modules/ai/lib/native";
import { forEachConcurrent } from "./concurrent";
import type { GitRangeContext } from "./fs";
import { limitSection } from "./jsonText";

const PR_CONTEXT_COMMIT_LIMIT = 20;
const PR_CONTEXT_DIFF_LIMIT = 4_000;
const PR_CONTEXT_PATCH_LIMIT = 12_000;

/** Build bounded PR text context from native Git data for one branch range. */
export async function buildSessionPullRequestContext(
  base: string,
  head: string,
  comparison: GitBranchComparison,
  readCommitDiff: (sha: string) => Promise<GitDiffResult>,
): Promise<GitRangeContext> {
  const commitSummary = comparison.ahead
    .map((commit) => `- ${commit.shortSha} ${commit.subject}`)
    .join("\n");
  const diffSummary = comparison.files
    .map(
      (file) =>
        `- ${file.statusLabel} ${file.path} (+${file.added}/-${file.removed})`,
    )
    .join("\n");
  const commits = comparison.ahead.slice(0, PR_CONTEXT_COMMIT_LIMIT);
  const patches = new Array<string>(commits.length).fill("");
  let unavailableDiffs = 0;
  let diffTruncated = false;

  await forEachConcurrent(commits, 3, async (commit, index) => {
    let diff: GitDiffResult;
    try {
      diff = await readCommitDiff(commit.sha);
    } catch {
      unavailableDiffs += 1;
      return;
    }
    diffTruncated ||= diff.truncated;
    if (!diff.diffText.trim()) return;
    patches[index] =
      `--- ${commit.shortSha} ${commit.subject} ---\n${limitSection(
        diff.diffText,
        PR_CONTEXT_DIFF_LIMIT,
      )}`;
  });

  const notices: string[] = [];
  if (comparison.ahead.length > commits.length) {
    notices.push(
      `[Patch omitted for ${comparison.ahead.length - commits.length} additional commits.]`,
    );
  }
  if (diffTruncated)
    notices.push("[One or more commit diffs were truncated by Git.]");
  if (unavailableDiffs > 0) {
    notices.push(
      `[Git could not provide diffs for ${unavailableDiffs} ${unavailableDiffs === 1 ? "commit" : "commits"}; commit summaries remain available.]`,
    );
  }
  const patch = [notices.join("\n"), patches.filter(Boolean).join("\n\n")]
    .filter(Boolean)
    .join("\n\n");

  return {
    base,
    head,
    commitSummary: limitSection(commitSummary, 12_000),
    diffSummary: limitSection(diffSummary, 12_000),
    diffPatch: limitSection(patch, PR_CONTEXT_PATCH_LIMIT),
  };
}
