import type {
  GitChangedFile,
  GitDiffResult,
  GitRepoInfo,
} from "@/modules/ai/lib/native";
import type { CheckpointFile } from "./checkpoint";
import { forEachConcurrent } from "./concurrent";
import type { GitStagedContext } from "./fs";
import { limitSection } from "./jsonText";
import { isEqualOrInside, joinPath, parentPath, pathKey } from "./paths";

const COMMIT_CONTEXT_FILE_LIMIT = 20;
const COMMIT_CONTEXT_DIFF_LIMIT = 4_000;
const COMMIT_CONTEXT_PATCH_LIMIT = 12_000;

export type SessionCommitRepository = {
  repoRoot: string;
  files: CheckpointFile[];
};

export type SessionCommitRepositoryResolution = {
  repositories: SessionCommitRepository[];
  unresolvedFiles: CheckpointFile[];
};

export type SessionCommitCandidate = {
  path: string;
  relative: string;
  sessionFile: CheckpointFile | null;
  statusLabel: string | null;
};

export type SessionCommitNotice = {
  message: string;
  kind: "success" | "warning";
};

/** Merge session-owned paths with every changed path reported by Git. */
export function mergeSessionCommitCandidates(
  repoRoot: string,
  sessionFiles: readonly CheckpointFile[],
  changedFiles: readonly GitChangedFile[],
  sharedFiles: readonly CheckpointFile[] = [],
): SessionCommitCandidate[] {
  const candidates = new Map<string, SessionCommitCandidate>();
  const sharedByPath = new Map(
    sharedFiles.map((file) => [pathKey(file.path), file]),
  );
  for (const file of sessionFiles) {
    candidates.set(pathKey(file.path), {
      path: file.path,
      relative: file.relative,
      sessionFile: file,
      statusLabel: null,
    });
  }

  for (const changed of changedFiles) {
    const path = joinPath(repoRoot, changed.path);
    const key = pathKey(path);
    const existing = candidates.get(key);
    if (existing) {
      existing.statusLabel = changed.statusLabel;
    } else {
      const sharedFile = sharedByPath.get(key);
      candidates.set(key, {
        path: sharedFile?.path ?? path,
        relative: sharedFile?.relative ?? changed.path,
        sessionFile: sharedFile ?? null,
        statusLabel: changed.statusLabel,
      });
    }
  }

  return [...candidates.values()];
}

/** Build bounded commit text context from selected paths in the active repo. */
export async function buildSessionCommitMessageContext(
  branch: string | null,
  files: readonly SessionCommitCandidate[],
  readDiff: (
    path: string,
    staged: boolean,
  ) => Promise<GitDiffResult>,
): Promise<GitStagedContext> {
  const summary = files
    .map(
      (file) =>
        `- ${file.statusLabel ?? file.sessionFile?.status ?? "Changed"} ${file.relative}`,
    )
    .join("\n");
  const contextFiles = files.slice(0, COMMIT_CONTEXT_FILE_LIMIT);
  const patches = new Array<string>(contextFiles.length).fill("");
  let diffTruncated = false;
  let unavailableDiffs = 0;

  await forEachConcurrent(contextFiles, 3, async (file, index) => {
    const filePatches: string[] = [];
    for (const staged of [true, false]) {
      let diff: GitDiffResult | null;
      try {
        diff = await readDiff(file.path, staged);
      } catch {
        diff = null;
      }
      if (!diff) {
        unavailableDiffs += 1;
        continue;
      }
      diffTruncated ||= diff.truncated;
      if (!diff.diffText.trim()) continue;
      const kind = staged ? "staged" : "unstaged";
      filePatches.push(
        `--- ${file.relative} (${kind}) ---\n${limitSection(
          diff.diffText,
          COMMIT_CONTEXT_DIFF_LIMIT,
        )}`,
      );
    }
    patches[index] = filePatches.join("\n");
  });

  if (files.length > contextFiles.length) {
    patches.push(
      `[Patch omitted for ${files.length - contextFiles.length} additional selected files.]`,
    );
  }
  if (diffTruncated) patches.push("[One or more selected diffs were truncated by Git.]");
  if (unavailableDiffs > 0) {
    patches.push(
      `[Git could not provide ${unavailableDiffs} selected ${unavailableDiffs === 1 ? "file diff" : "file diffs"}; their paths and statuses remain in the summary.]`,
    );
  }

  return {
    branch,
    summary: limitSection(summary, 6_000),
    patch: limitSection(
      patches.filter(Boolean).join("\n\n"),
      COMMIT_CONTEXT_PATCH_LIMIT,
    ),
  };
}

/** Group exact session-owned files by their containing Git repository. */
export async function resolveSessionCommitRepositories(
  files: readonly CheckpointFile[],
  resolveRepo: (directory: string) => Promise<GitRepoInfo | null>,
): Promise<SessionCommitRepositoryResolution> {
  const repositories = new Map<string, SessionCommitRepository>();
  const unresolvedFiles: CheckpointFile[] = [];
  const directoryLookups = new Map<string, Promise<GitRepoInfo | null>>();

  await forEachConcurrent(
    files.filter((file) => file.exact),
    4,
    async (file) => {
      const directory = parentPath(file.path);
      const directoryKey = pathKey(directory);
      try {
        let lookup = directoryLookups.get(directoryKey);
        if (!lookup) {
          lookup = Promise.resolve().then(() => resolveRepo(directory));
          directoryLookups.set(directoryKey, lookup);
        }
        const repo = await lookup;
        if (!repo || !isEqualOrInside(file.path, repo.repoRoot)) {
          unresolvedFiles.push(file);
          return;
        }

        const repoKey = pathKey(repo.repoRoot);
        const existing = repositories.get(repoKey);
        if (existing) {
          existing.files.push(file);
        } else {
          repositories.set(repoKey, { repoRoot: repo.repoRoot, files: [file] });
        }
      } catch {
        unresolvedFiles.push(file);
      }
    },
  );

  return {
    repositories: [...repositories.values()].sort((a, b) =>
      a.repoRoot.localeCompare(b.repoRoot),
    ),
    unresolvedFiles,
  };
}
