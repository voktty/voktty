import {
  PROJECT_MEMORY_FILE,
  LEGACY_PROJECT_MEMORY_FILE,
} from "@/lib/identity";
import type { AiFileRootContext } from "@/modules/ai/lib/aiFileContext";
import type { ReadResult } from "@/modules/ai/lib/native";
import { fileReadCacheKey } from "@/modules/ai/lib/filesystemCacheKey";
import { checkReadable, checkWorkspacePath } from "@/modules/ai/lib/security";
import type { WorkspaceEnv } from "@/modules/workspace";

type Io = {
  canonicalize: (path: string, workspace: WorkspaceEnv) => Promise<string>;
  readFile: (path: string, workspace: WorkspaceEnv) => Promise<ReadResult>;
};
const MAX_CHARACTERS = 32 * 1024;
const TTL_MS = 30_000;

function clipped(content: string): string {
  const result = content.slice(0, MAX_CHARACTERS);
  const last = result.charCodeAt(result.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? result.slice(0, -1) : result;
}

export function createProjectMemoryReader(
  io: Io,
  options: { limit?: number; cacheSize?: number; now?: () => number } = {},
) {
  const limit = options.limit ?? 16;
  const cacheSize = options.cacheSize ?? 32;
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 16 ||
    !Number.isSafeInteger(cacheSize) ||
    cacheSize < 1 ||
    cacheSize > 32
  )
    throw new Error("Invalid project memory capacity.");
  const { canonicalize, readFile } = io;
  const now = options.now ?? Date.now;
  const cache = new Map<string, { content: string | null; savedAt: number }>();
  const publications = new Map<string, object>();
  let pending = 0;

  const load = async (target: AiFileRootContext, assertCurrent: () => void) => {
    const { root, workspace } = target;
    assertCurrent();
    let canonicalRoot: string;
    try {
      canonicalRoot = await canonicalize(root, workspace);
    } catch {
      assertCurrent();
      return null;
    }
    assertCurrent();
    if (
      !checkReadable(canonicalRoot).ok ||
      !checkWorkspacePath(canonicalRoot, canonicalRoot).ok
    )
      return null;
    const separator = root.includes("\\") && !root.includes("/") ? "\\" : "/";
    for (const filename of [PROJECT_MEMORY_FILE, LEGACY_PROJECT_MEMORY_FILE]) {
      assertCurrent();
      const path = `${root.endsWith(separator) ? root : root + separator}${filename}`;
      if (!checkReadable(path).ok) continue;
      try {
        const canonical = await canonicalize(path, workspace);
        assertCurrent();
        if (
          !checkReadable(canonical).ok ||
          !checkWorkspacePath(canonical, canonicalRoot).ok
        )
          continue;
        const result = await readFile(canonical, workspace);
        assertCurrent();
        if (result.kind === "text") return clipped(result.content);
      } catch {
        assertCurrent();
      }
    }
    return null;
  };

  return {
    async read(
      source: AiFileRootContext | null,
      assertCurrent: () => void,
    ): Promise<string | null> {
      assertCurrent();
      if (
        !source ||
        source.root.length > 32768 ||
        source.root.startsWith("remote://") ||
        !checkReadable(source.root).ok ||
        !checkWorkspacePath(source.root, source.root).ok ||
        (source.workspace.kind !== "local" &&
          source.workspace.kind !== "wsl" &&
          source.workspace.kind !== "ssh") ||
        (source.workspace.kind !== "local" &&
          (!source.root.startsWith("/") || source.root.startsWith("//")))
      )
        return null;
      const target = structuredClone(source);
      const key = fileReadCacheKey(target.root, target.workspace);
      if (key.length > 65536) return null;
      const existing = cache.get(key);
      if (existing && now() - existing.savedAt < TTL_MS) {
        cache.delete(key);
        cache.set(key, existing);
        return existing.content;
      }
      cache.delete(key);
      if (pending >= limit)
        throw new Error("Too many pending project memory reads.");
      const publication = {};
      publications.set(key, publication);
      pending++;
      try {
        const content = await load(target, assertCurrent);
        assertCurrent();
        if (publications.get(key) === publication) {
          cache.delete(key);
          cache.set(key, { content, savedAt: now() });
          while (cache.size > cacheSize) {
            const oldest = cache.keys().next();
            if (oldest.done) break;
            cache.delete(oldest.value);
          }
        }
        return content;
      } finally {
        pending--;
        if (publications.get(key) === publication) publications.delete(key);
      }
    },
  };
}
