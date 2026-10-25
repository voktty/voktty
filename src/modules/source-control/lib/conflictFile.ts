import { invoke } from "@tauri-apps/api/core";
import type { ReadResult } from "@/modules/ai/lib/native";
import { remoteReadFile, remoteWriteFile } from "@/modules/remote";
import { workspaceForNativeFs, type WorkspaceEnv } from "@/modules/workspace";

export const MAX_CONFLICT_BYTES = 2 * 1024 * 1024;
export type ConflictFileTarget = Readonly<{
  path: string;
  relative: string;
  filesystem: string;
  kind: "native" | "ssh" | "namespace";
}>;

export function conflictFileTarget(
  root: string,
  relative: string,
  workspace: WorkspaceEnv,
): ConflictFileTarget | null {
  if (
    !root ||
    !relative ||
    root.length + relative.length > 32768 ||
    /[\x00-\x1f\x7f]/.test(root + relative)
  )
    return null;
  const folder = root.replace(/\\/g, "/");
  const path = relative.replace(/\\/g, "/");
  if (
    path.startsWith("/") ||
    /^[a-zA-Z]:\//.test(path) ||
    /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(path) ||
    path.split("/").some((part) => !part || part === "." || part === "..")
  )
    return null;
  if (folder.split("/").some((part) => part === "." || part === ".."))
    return null;
  const absolute = `${folder.replace(/\/+$/, "")}/${path}`;
  if (/^remote:\/\/voktty-ssh-[^/]+\//.test(folder))
    return {
      path: absolute,
      relative: path,
      filesystem: JSON.stringify(workspace),
      kind: "namespace",
    };
  if (
    /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(folder) ||
    workspace.kind === "docker" ||
    workspace.kind === "serial"
  )
    return null;
  if (workspace.kind === "ssh") {
    if (!folder.startsWith("/") || folder.startsWith("//")) return null;
    return {
      path: absolute,
      relative: path,
      filesystem: JSON.stringify(workspace),
      kind: "ssh",
    };
  }
  if (!folder.startsWith("/") && !/^[a-zA-Z]:\//.test(folder)) return null;
  if (folder.startsWith("//") && !/^\/\/[^/]+\/[^/]+/.test(folder)) return null;
  return {
    path: absolute,
    relative: path,
    filesystem: JSON.stringify(workspaceForNativeFs(workspace, absolute)),
    kind: "native",
  };
}

export async function readConflictFile(
  target: ConflictFileTarget,
): Promise<ReadResult> {
  if (target.kind === "namespace") {
    const { readTextFile } = await import("@/modules/harness/lib/fs");
    const content = await readTextFile(target.path);
    return {
      kind: "text",
      content,
      size: new TextEncoder().encode(content).byteLength,
    };
  }
  const workspace: WorkspaceEnv = JSON.parse(target.filesystem);
  if (target.kind === "ssh" && workspace.kind === "ssh")
    return { kind: "text", ...(await remoteReadFile(workspace, target.path)) };
  return invoke<ReadResult>("fs_read_file", {
    path: target.path,
    workspace,
    force: false,
  });
}

export async function writeConflictFile(
  target: ConflictFileTarget,
  content: string,
  expectedContent: string,
): Promise<void> {
  if (target.kind === "namespace") {
    const { writeTextFile } = await import("@/modules/harness/lib/fs");
    await writeTextFile(target.path, content, expectedContent);
    return;
  }
  const workspace: WorkspaceEnv = JSON.parse(target.filesystem);
  if (target.kind === "ssh" && workspace.kind === "ssh") {
    await remoteWriteFile(workspace, target.path, content);
    return;
  }
  await invoke("fs_write_file", { path: target.path, content, workspace });
}
