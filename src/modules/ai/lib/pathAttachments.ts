import type { FileAttachment } from "@/modules/ai/lib/composer";
import { fileReadCacheKey } from "@/modules/ai/lib/filesystemCacheKey";
import { MAX_TEXT_INLINE } from "@/modules/ai/lib/browserAttachments";
import { isWindowsNativePath, type WorkspaceEnv } from "@/modules/workspace";

let pendingReads = 0;
let nativeClient: Promise<typeof import("@/modules/ai/lib/native")> | null =
  null;

function loadNativeClient() {
  if (nativeClient) return nativeClient;
  const pending = import("@/modules/ai/lib/native").catch((error) => {
    if (nativeClient === pending) nativeClient = null;
    throw error;
  });
  nativeClient = pending;
  return pending;
}

export async function readPathAttachment(
  path: string,
  workspace: WorkspaceEnv,
  isCurrent: () => boolean,
): Promise<FileAttachment | null> {
  if (
    !isCurrent() ||
    pendingReads >= 16 ||
    path.length > 32768 ||
    /[\x00-\x1f\x7f]/.test(path) ||
    (!path.startsWith("/") && !isWindowsNativePath(path))
  )
    return null;
  const captured = structuredClone(workspace);
  pendingReads++;
  try {
    const { native } = await loadNativeClient();
    if (!isCurrent()) return null;
    const result = await native.readFile(path, captured);
    if (
      !isCurrent() ||
      result.kind !== "text" ||
      result.size > MAX_TEXT_INLINE ||
      result.content.length > MAX_TEXT_INLINE
    )
      return null;
    return {
      id: `path-${fileReadCacheKey(path, captured)}`,
      name: path.split(/[/\\]/).pop() || path,
      kind: "text",
      mediaType: "text/plain",
      text: result.content,
      size: result.size,
    };
  } catch {
    return null;
  } finally {
    pendingReads--;
  }
}
