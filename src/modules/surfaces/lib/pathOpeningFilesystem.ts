import { invoke } from "@tauri-apps/api/core";
import type { PathOpeningRequest } from "@/modules/surfaces/lib/pathOpeningRequest";

export async function pathOpeningKind(
  request: PathOpeningRequest,
  current: () => boolean,
): Promise<"file" | "dir"> {
  const { path, workspace } = request;
  if (path.startsWith("remote://")) {
    const { listDir } = await import("@/modules/harness/lib/fs");
    if (!current()) throw new Error("Path opening retired");
    try {
      await listDir(path);
      return "dir";
    } catch {
      if (!current()) throw new Error("Path opening retired");
    }
    const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
    const parent = normalized.slice(0, normalized.lastIndexOf("/") + 1);
    const entries = await listDir(parent);
    const name = normalized.slice(normalized.lastIndexOf("/") + 1);
    const entry = entries.find((entry) => entry.name === name);
    if (!entry) throw new Error("Path opening target unavailable");
    return entry.isDir ? "dir" : "file";
  }
  if (workspace.kind === "ssh") {
    const { remoteStat } = await import("@/modules/remote/filesystem");
    if (!current()) throw new Error("Path opening retired");
    return (await remoteStat(workspace, path)).kind;
  }
  if (workspace.kind !== "local" && workspace.kind !== "wsl")
    throw new Error("Path opening filesystem unavailable");
  const stat = await invoke<{ kind: string }>("fs_stat", { path, workspace });
  if (stat.kind === "symlink") return "file";
  if (stat.kind !== "file" && stat.kind !== "dir")
    throw new Error("Path opening target unavailable");
  return stat.kind;
}
