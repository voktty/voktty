import { native } from "@/modules/ai/lib/native";
import type { AgentDiffFile, AgentDiffStat } from "./types";

export function parseGitDiffStats(diffText: string): {
  additions: number;
  deletions: number;
  filesChanged: number;
  files: AgentDiffFile[];
} {
  if (!diffText || !diffText.trim()) {
    return { additions: 0, deletions: 0, filesChanged: 0, files: [] };
  }

  const lines = diffText.split(/\r?\n/);
  let totalAdd = 0;
  let totalDel = 0;
  const filesMap = new Map<
    string,
    { additions: number; deletions: number; status: "modified" | "added" | "deleted" }
  >();
  let currentFile: string | null = null;

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      const match = line.match(/diff --git a\/(.+) b\/(.+)/);
      if (match) {
        currentFile = match[2];
        if (!filesMap.has(currentFile)) {
          filesMap.set(currentFile, {
            additions: 0,
            deletions: 0,
            status: "modified",
          });
        }
      }
    } else if (line.startsWith("+++ b/")) {
      currentFile = line.substring(6).trim();
      if (!filesMap.has(currentFile)) {
        filesMap.set(currentFile, {
          additions: 0,
          deletions: 0,
          status: "modified",
        });
      }
    } else if (line.startsWith("new file mode")) {
      if (currentFile && filesMap.has(currentFile)) {
        filesMap.get(currentFile)!.status = "added";
      }
    } else if (line.startsWith("deleted file mode")) {
      if (currentFile && filesMap.has(currentFile)) {
        filesMap.get(currentFile)!.status = "deleted";
      }
    } else if (line.startsWith("+") && !line.startsWith("+++")) {
      totalAdd++;
      if (currentFile && filesMap.has(currentFile)) {
        filesMap.get(currentFile)!.additions++;
      }
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      totalDel++;
      if (currentFile && filesMap.has(currentFile)) {
        filesMap.get(currentFile)!.deletions++;
      }
    }
  }

  const files: AgentDiffFile[] = Array.from(filesMap.entries()).map(
    ([path, stat]) => ({
      path,
      additions: stat.additions,
      deletions: stat.deletions,
      status: stat.status,
    }),
  );

  return {
    additions: totalAdd,
    deletions: totalDel,
    filesChanged: files.length,
    files,
  };
}

export async function getAgentRunDiffStat(
  cwd: string | null | undefined,
): Promise<AgentDiffStat | null> {
  if (!cwd) return null;
  try {
    const repoInfo = await native.gitResolveRepo(cwd);
    if (!repoInfo) return null;
    const repoRoot = repoInfo.repoRoot;
    const diff = await native.gitDiff(repoRoot, null, false);
    const parsed = parseGitDiffStats(diff.diffText || "");
    const status = await native.gitStatus(repoRoot).catch(() => null);

    if (status?.changedFiles) {
      for (const cf of status.changedFiles) {
        if (cf.untracked && !parsed.files.some((f) => f.path === cf.path)) {
          parsed.files.push({
            path: cf.path,
            additions: 0,
            deletions: 0,
            status: "added",
          });
          parsed.filesChanged++;
        }
      }
    }

    if (
      parsed.filesChanged === 0 &&
      parsed.additions === 0 &&
      parsed.deletions === 0
    ) {
      return null;
    }

    return {
      ...parsed,
      repoRoot,
      cwd,
    };
  } catch {
    return null;
  }
}
