import type { GitChangedFile, GitRepoInfo } from "@/modules/ai/lib/native";
import type { CheckpointFile } from "./checkpoint";
import { forEachConcurrent } from "./concurrent";
import { isEqualOrInside, joinPath, parentPath, pathKey } from "./paths";

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
