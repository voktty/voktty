import { invoke } from "@tauri-apps/api/core";
import * as fs from "@/modules/harness/lib/fs";
export type { FsEntry } from "@/modules/harness/lib/fs";

async function remote<T>(
  operation: string,
  path: string,
  content?: string,
): Promise<T> {
  const { remoteTeamFile } = await import(
    "@/modules/teams/lib/remoteTeamTransport"
  );
  return remoteTeamFile<T>(operation, path, content);
}

export async function readTextFile(path: string): Promise<string> {
  if (!path.startsWith("remote://")) return fs.readTextFile(path);
  return (await remote<{ content: string }>("read", path)).content;
}

export async function writeTextFile(
  path: string,
  content: string,
): Promise<void> {
  if (!path.startsWith("remote://")) return fs.writeTextFile(path, content);
  await remote("write", path, content);
}

export async function ensureDirectory(path: string): Promise<void> {
  if (!path.startsWith("remote://")) return invoke("fs_create_dir", { path });
  await remote("mkdir", path);
}

export async function listDir(path: string): Promise<fs.FsEntry[]> {
  if (!path.startsWith("remote://")) return fs.listDir(path);
  const { entries } = await remote<{
    entries: { name: string; isDir: boolean }[];
  }>("list", path);
  return entries.map((entry) => ({
    ...entry,
    path: `${path}/${entry.name}`,
    ignored: false,
  }));
}

export async function nativeProjectPath(projectPath: string): Promise<string> {
  if (!projectPath.startsWith("remote://")) return projectPath;
  const { root } = await remote<{ root: string }>("identity", projectPath);
  const namespace = projectPath.slice(
    0,
    projectPath.indexOf("/", "remote://".length),
  );
  return `${namespace}${root}`;
}

/** True when a local or remote read failed because the file does not exist. */
export function isNotFoundError(err: unknown): boolean {
  if (!err) return false;
  if (typeof err === "object") {
    const errorObj = err as { code?: string; message?: string };
    if (errorObj.code === "ENOENT" || errorObj.code === "not_found") {
      return true;
    }
    const msg = errorObj.message || "";
    if (
      // The remote helper reports `not_found: <detail>`.
      /^not_found(:|$)/.test(msg) ||
      msg.includes("ENOENT") ||
      msg.includes("not found") ||
      msg.includes("No such file") ||
      msg.includes("os error 2")
    ) {
      return true;
    }
  }
  if (typeof err === "string") {
    return (
      /^not_found(:|$)/.test(err) ||
      err.includes("ENOENT") ||
      err.includes("not found") ||
      err.includes("No such file") ||
      err.includes("os error 2")
    );
  }
  return false;
}
