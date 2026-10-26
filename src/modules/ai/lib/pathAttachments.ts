import type { FileAttachment } from "@/modules/ai/lib/composer";
import { fileReadCacheKey } from "@/modules/ai/lib/filesystemCacheKey";
import { MAX_TEXT_INLINE } from "@/modules/ai/lib/browserAttachments";
import { isWindowsNativePath, type WorkspaceEnv } from "@/modules/workspace";
import {
  captureProjectAttachment,
  isCapturedProjectAttachment,
  type ProjectAttachmentSource,
} from "@/modules/ai/lib/projectAttachmentSource";
import { checkReadable } from "@/modules/ai/lib/security";

let pendingReads = 0;
let nativeClient: Promise<typeof import("@/modules/ai/lib/native")> | null =
  null;
let projectClient: Promise<
  typeof import("@/modules/remote/projectDocument")
> | null = null;

function loadProjectClient() {
  if (projectClient) return projectClient;
  const pending = import("@/modules/remote/projectDocument").catch((error) => {
    if (projectClient === pending) projectClient = null;
    throw error;
  });
  projectClient = pending;
  return pending;
}

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
  projectSource?: ProjectAttachmentSource,
): Promise<FileAttachment | null> {
  if (
    !isCurrent() ||
    pendingReads >= 16 ||
    path.length > 32768 ||
    /[\x00-\x1f\x7f]/.test(path) ||
    (!path.startsWith("/") &&
      !isWindowsNativePath(path) &&
      !path.startsWith("remote://"))
  )
    return null;
  const captured = structuredClone(workspace);
  const namespace = path.startsWith("remote://");
  const source = namespace
    ? (projectSource ?? captureProjectAttachment(path))
    : null;
  if (namespace && (!source || !isCapturedProjectAttachment(source, path)))
    return null;
  if (!namespace && projectSource) return null;
  pendingReads++;
  try {
    if (source) {
      const { createProjectDocument } = await loadProjectClient();
      if (!isCurrent()) return null;
      const document = createProjectDocument(path, source.project, [
        source.profile,
      ]);
      const result = await document.readReference(
        isCurrent,
        (canonical) => checkReadable(canonical).ok,
        MAX_TEXT_INLINE,
      );
      if (
        !isCurrent() ||
        !result ||
        result.kind !== "text" ||
        result.size > MAX_TEXT_INLINE ||
        result.content.length > MAX_TEXT_INLINE
      )
        return null;
      return {
        id: `path-${source.key}`,
        name: path.split("/").pop() || path,
        kind: "text",
        mediaType: "text/plain",
        text: result.content,
        size: result.size,
      };
    }
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
