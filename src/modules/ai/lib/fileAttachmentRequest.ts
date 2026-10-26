import {
  isWindowsNativePath,
  workspaceForDocumentPath,
  type WorkspaceEnv,
} from "@/modules/workspace";
import { IS_WINDOWS } from "@/lib/platform";
import {
  captureProjectAttachment,
  type ProjectAttachmentSource,
} from "@/modules/ai/lib/projectAttachmentSource";

export const FILE_ATTACHMENT_EVENT = "voktty:ai-attach-file";
export type FileAttachmentHandler = (
  path: string,
  workspace: WorkspaceEnv,
  isCurrent?: () => boolean,
) => void;
type Request = {
  path: string;
  workspace: WorkspaceEnv;
  isCurrent: () => boolean;
  projectSource?: ProjectAttachmentSource;
};
const requests = new WeakMap<object, Request>();

export function canRequestFileAttachment(
  path: string,
  workspace: WorkspaceEnv,
): boolean {
  if (
    !path ||
    path.length > 32768 ||
    /[\x00-\x1f\x7f]/.test(path) ||
    !workspace
  )
    return false;
  if (isWindowsNativePath(path)) return true;
  if (path.startsWith("remote://"))
    return captureProjectAttachment(path) !== null;
  return (
    path.startsWith("/") &&
    (workspace.kind === "local" ||
      workspace.kind === "ssh" ||
      (workspace.kind === "wsl" && IS_WINDOWS))
  );
}

export function requestFileAttachment(
  path: string,
  workspace: WorkspaceEnv,
  isCurrent: () => boolean = () => true,
): boolean {
  if (
    typeof window === "undefined" ||
    !isCurrent() ||
    !canRequestFileAttachment(path, workspace)
  )
    return false;
  const projectSource = path.startsWith("remote://")
    ? captureProjectAttachment(path)
    : undefined;
  if (projectSource === null) return false;
  const key = {};
  const owner = isWindowsNativePath(path)
    ? workspaceForDocumentPath(workspace, path)
    : workspace;
  requests.set(key, {
    path,
    workspace: structuredClone(owner),
    isCurrent,
    ...(projectSource ? { projectSource } : {}),
  });
  try {
    window.dispatchEvent(
      new CustomEvent(FILE_ATTACHMENT_EVENT, { detail: key }),
    );
    return !requests.has(key);
  } finally {
    requests.delete(key);
  }
}

export function takeFileAttachmentRequest(
  detail: unknown,
): Request | undefined {
  if (detail === null || typeof detail !== "object") return;
  const request = requests.get(detail);
  if (!request?.isCurrent()) return;
  requests.delete(detail);
  return request;
}
