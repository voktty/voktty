import { IS_WINDOWS } from "@/lib/platform";
import { fileReadCacheKey } from "@/modules/ai/lib/filesystemCacheKey";
import type { FileCitationSource } from "@/modules/ai/store/chatStore";
import { resolveAiFileRootContext } from "@/modules/ai/lib/aiFileContext";
import type { WorkspaceEnv } from "@/modules/workspace";

export type CitationFileIndex = { files: string[]; truncated: boolean };
export type CitationFileTarget = { root: string; workspace: WorkspaceEnv };

export function citationFileTarget(
  source: FileCitationSource,
): CitationFileTarget | null {
  if (source.kind !== "local") return null;
  const target = resolveAiFileRootContext(source.root, source.workspace);
  return target?.workspace.kind === "wsl" && !IS_WINDOWS ? null : target;
}

export function isCitationRelativePath(path: string): boolean {
  return (
    path.length > 0 &&
    path.length <= 32768 &&
    !/[\\:\x00-\x1f\x7f]/.test(path) &&
    path
      .split("/")
      .every((part) => part !== "" && part !== "." && part !== "..")
  );
}

export function createCitationFileIndex(
  read: (target: CitationFileTarget) => Promise<CitationFileIndex>,
) {
  const cache = new Map<string, { value: CitationFileIndex; at: number }>();
  const pending = new Map<string, Promise<CitationFileIndex>>();
  let callers = 0;
  return {
    load(target: CitationFileTarget): Promise<CitationFileIndex> {
      const captured = structuredClone(target);
      const key = fileReadCacheKey(captured.root, captured.workspace);
      const cached = cache.get(key);
      if (cached && Date.now() - cached.at < 60_000) {
        cache.delete(key);
        cache.set(key, cached);
        return Promise.resolve(cached.value);
      }
      if (callers >= 256)
        return Promise.reject(new Error("File search is busy"));
      const running = pending.get(key);
      if (running) {
        callers++;
        return running.finally(() => {
          callers--;
        });
      }
      if (pending.size >= 16)
        return Promise.reject(new Error("File search is busy"));
      callers++;
      const request = Promise.resolve()
        .then(() => read(captured))
        .then((result) => {
          if (result.files.length > 10_000)
            throw new Error("File index exceeds its limit");
          let characters = 0;
          for (const path of result.files) {
            characters += path.length;
            if (!isCitationRelativePath(path) || characters > 4 * 1024 * 1024)
              throw new Error("Invalid file index");
          }
          const value = {
            files: [...new Set(result.files)],
            truncated: result.truncated,
          };
          cache.delete(key);
          cache.set(key, { value, at: Date.now() });
          while (cache.size > 16) {
            const oldest = cache.keys().next().value;
            if (oldest === undefined) break;
            cache.delete(oldest);
          }
          return value;
        })
        .finally(() => {
          callers--;
          if (pending.get(key) === request) pending.delete(key);
        });
      pending.set(key, request);
      return request;
    },
  };
}
