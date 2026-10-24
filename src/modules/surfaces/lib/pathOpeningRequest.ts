import {
  LOCAL_WORKSPACE,
  workspaceForDocumentPath,
  type WorkspaceEnv,
} from "@/modules/workspace";

export const PATH_OPENING_EVENT = "voktty:open-dropped-path";
export type PathOpeningRequest = Readonly<{
  path: string;
  workspace: WorkspaceEnv;
  kind: "file" | "unknown";
}>;
const requests = new WeakMap<object, PathOpeningRequest>();

export function pathOpeningRequest(
  path: string,
  workspace: WorkspaceEnv,
  kind: PathOpeningRequest["kind"] = "unknown",
): PathOpeningRequest {
  if (!path || path.length > 32768 || /[\x00-\x1f\x7f]/.test(path))
    throw new Error("Invalid path opening request");
  const target = path.startsWith("remote://")
    ? LOCAL_WORKSPACE
    : workspace.kind === "docker" || workspace.kind === "serial"
      ? workspace
      : workspaceForDocumentPath(workspace, path);
  return Object.freeze({ path, workspace: structuredClone(target), kind });
}

export function requestPathOpening(
  path: string,
  workspace: WorkspaceEnv,
  kind: PathOpeningRequest["kind"] = "file",
): void {
  const request = pathOpeningRequest(path, workspace, kind);
  const key = {};
  requests.set(key, request);
  try {
    window.dispatchEvent(new CustomEvent(PATH_OPENING_EVENT, { detail: key }));
  } finally {
    requests.delete(key);
  }
}

export function readPathOpeningRequest(
  detail: unknown,
): PathOpeningRequest | undefined {
  return detail !== null && typeof detail === "object"
    ? requests.get(detail)
    : undefined;
}
