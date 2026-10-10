import type { GitRepoInfo } from "@/modules/ai/lib/native";
import type { CheckpointFile } from "./checkpoint";
import { forEachConcurrent } from "./concurrent";
import { isEqualOrInside, parentPath, pathKey } from "./paths";

export type SessionCommitRepository = {
  repoRoot: string;
  files: CheckpointFile[];
};

export type SessionCommitRepositoryResolution = {
  repositories: SessionCommitRepository[];
  unresolvedFiles: CheckpointFile[];
};

export type SessionCommitNotice = {
  message: string;
  kind: "success" | "warning";
};

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
