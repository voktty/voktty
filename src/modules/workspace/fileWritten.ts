import { isWindowsNativePath, type WorkspaceEnv } from "@/modules/workspace";

export type FileWriteFilesystem =
  | { kind: "local" }
  | { kind: "wsl"; distro: string };
export type FileWrittenEvent = {
  path: string;
  source?: string;
  filesystem: FileWriteFilesystem;
};

function boundedText(value: unknown, max: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= max &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

export function parseFileWritten(value: unknown): FileWrittenEvent | null {
  if (!value || typeof value !== "object") return null;
  const payload = value as Record<string, unknown>;
  if (
    !boundedText(payload.path, 32768) ||
    !payload.filesystem ||
    typeof payload.filesystem !== "object"
  )
    return null;
  const scope = payload.filesystem as Record<string, unknown>;
  let filesystem: FileWriteFilesystem;
  if (scope.kind === "local") filesystem = { kind: "local" };
  else if (scope.kind === "wsl" && boundedText(scope.distro, 255))
    filesystem = { kind: "wsl", distro: scope.distro };
  else return null;
  if (payload.source !== undefined && !boundedText(payload.source, 128))
    return null;
  return {
    path: payload.path,
    filesystem,
    ...(payload.source === undefined
      ? {}
      : { source: payload.source as string }),
  };
}

export function fileWrittenOnFilesystem(
  event: FileWrittenEvent,
  path: string,
  workspace: WorkspaceEnv,
): boolean {
  if (path.startsWith("remote://")) return false;
  if (isWindowsNativePath(path)) return event.filesystem.kind === "local";
  if (workspace.kind === "local") return event.filesystem.kind === "local";
  return (
    workspace.kind === "wsl" &&
    event.filesystem.kind === "wsl" &&
    event.filesystem.distro === workspace.distro
  );
}

function eventPath(path: string): string {
  return isWindowsNativePath(path)
    ? path.replace(/\\/g, "/").toLowerCase()
    : path;
}

export function fileWrittenMatches(
  event: FileWrittenEvent,
  path: string,
  workspace: WorkspaceEnv,
): boolean {
  return (
    fileWrittenOnFilesystem(event, path, workspace) &&
    eventPath(event.path) === eventPath(path)
  );
}

export function fileWrittenWithin(
  event: FileWrittenEvent,
  root: string,
  workspace: WorkspaceEnv,
): boolean {
  if (!root || !fileWrittenOnFilesystem(event, root, workspace)) return false;
  const parent = eventPath(root).replace(/\/+$/, "");
  const path = eventPath(event.path);
  return path === parent || path.startsWith(`${parent}/`);
}
