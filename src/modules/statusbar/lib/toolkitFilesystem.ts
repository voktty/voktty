import { invoke } from "@tauri-apps/api/core";
import type { WorkspaceEnv } from "@/modules/workspace";

export type ToolkitFileTarget = { path: string; workspace: WorkspaceEnv };

function requireFilesystem(target: ToolkitFileTarget) {
  if (target.workspace.kind === "docker" || target.workspace.kind === "serial")
    throw new Error("Toolkit filesystem is unavailable");
}

function requireCurrent(current: () => boolean) {
  if (!current()) throw new Error("Toolkit request was retired");
}

export async function toolkitStat(
  target: ToolkitFileTarget,
  current: () => boolean = () => true,
): Promise<void> {
  requireCurrent(current);
  requireFilesystem(target);
  if (target.path.startsWith("remote://")) {
    const { statFiles } = await import("@/modules/harness/lib/fs");
    requireCurrent(current);
    const [stat] = await statFiles([target.path]);
    if (stat?.mtimeMs == null) throw new Error("Toolkit file is unavailable");
  } else if (target.workspace.kind === "ssh") {
    const { remoteStat } = await import("@/modules/remote/filesystem");
    requireCurrent(current);
    await remoteStat(target.workspace, target.path);
  } else {
    await invoke("fs_stat", { path: target.path, workspace: target.workspace });
  }
}

export async function toolkitRead(
  target: ToolkitFileTarget,
  current: () => boolean = () => true,
): Promise<string> {
  requireCurrent(current);
  requireFilesystem(target);
  if (target.path.startsWith("remote://")) {
    const { readTextFile } = await import("@/modules/harness/lib/fs");
    requireCurrent(current);
    return readTextFile(target.path);
  }
  if (target.workspace.kind === "ssh") {
    const { remoteReadFile } = await import("@/modules/remote/filesystem");
    requireCurrent(current);
    return (await remoteReadFile(target.workspace, target.path)).content;
  }
  const result = await invoke<{ kind: string; content?: string }>(
    "fs_read_file",
    target,
  );
  if (result.kind !== "text" || typeof result.content !== "string")
    throw new Error("Toolkit file is not text");
  return result.content;
}

export async function toolkitWrite(
  target: ToolkitFileTarget,
  content: string,
  current: () => boolean = () => true,
): Promise<void> {
  requireCurrent(current);
  requireFilesystem(target);
  if (target.path.startsWith("remote://")) {
    const { writeTextFile } = await import("@/modules/harness/lib/fs");
    requireCurrent(current);
    await writeTextFile(target.path, content);
  } else if (target.workspace.kind === "ssh") {
    const { remoteWriteFile } = await import("@/modules/remote/filesystem");
    requireCurrent(current);
    await remoteWriteFile(target.workspace, target.path, content);
  } else {
    await invoke("fs_write_file", {
      ...target,
      content,
      source: "tools-config",
    });
  }
}

export async function toolkitCreateDir(
  target: ToolkitFileTarget,
  current: () => boolean = () => true,
): Promise<void> {
  requireCurrent(current);
  requireFilesystem(target);
  if (target.path.startsWith("remote://")) {
    const { createPath } = await import("@/modules/harness/lib/fs");
    const { parentPath } = await import("@/modules/explorer/lib/path");
    requireCurrent(current);
    await createPath(
      parentPath(target.path),
      target.path.split("/").pop() ?? "",
      true,
    );
  } else if (target.workspace.kind === "ssh") {
    const { remoteCreateDir } = await import("@/modules/remote/filesystem");
    requireCurrent(current);
    await remoteCreateDir(target.workspace, target.path);
  } else {
    await invoke("fs_create_dir", target);
  }
}

export async function toolkitReadDir(
  target: ToolkitFileTarget,
): Promise<{ name: string }[]> {
  requireFilesystem(target);
  if (target.path.startsWith("remote://")) {
    const { invokeWorkspace } = await import("@/modules/harness/lib/fs");
    return invokeWorkspace("list_dir", { path: target.path });
  }
  if (target.workspace.kind === "ssh") {
    const { remoteReadDir } = await import("@/modules/remote/filesystem");
    return remoteReadDir(target.workspace, target.path);
  }
  return invoke("fs_read_dir", { ...target, showHidden: true });
}
