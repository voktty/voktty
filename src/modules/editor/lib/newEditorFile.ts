import { invoke } from "@tauri-apps/api/core";
import type { WorkspaceEnv } from "@/modules/workspace";

export function newEditorFileTarget(root: string | null, rawName: string) {
  const name = rawName.trim().replace(/\\/g, "/");
  if (!name) return { error: "nameRequired" as const };
  if (
    name.length > 4096 ||
    /[\x00-\x1f\x7f:]/.test(name) ||
    name.startsWith("/") ||
    name
      .split("/")
      .some(
        (part) => !part || part === "." || part === ".." || part.length > 255,
      )
  )
    return { error: "pathMustBeRelative" as const };
  if (!root) return { error: "noWorkspaceRoot" as const };
  return {
    root,
    name,
    path: `${root.replace(/[\\/]+$/, "").replace(/\\/g, "/")}/${name}`,
  };
}

export async function createEditorFile(
  root: string,
  name: string,
  workspace: WorkspaceEnv,
  isCurrent: () => boolean,
): Promise<string | null> {
  const target = newEditorFileTarget(root, name);
  if (target.error || !isCurrent()) return null;
  if (root.replace(/\\/g, "/").startsWith("remote://")) {
    const { createPath } = await import("@/modules/harness/lib/fs");
    if (!isCurrent()) return null;
    return createPath(root, target.name, false);
  }
  if (workspace.kind === "ssh") {
    const { remoteCreateFile } = await import("@/modules/remote/filesystem");
    if (!isCurrent()) return null;
    await remoteCreateFile(workspace, target.path);
  } else if (workspace.kind === "local") {
    return invoke<string>("create_path", {
      parent: root,
      name: target.name,
      isDir: false,
    });
  } else {
    if (workspace.kind !== "wsl")
      throw new Error("File creation is unavailable in this workspace.");
    if (!isCurrent()) return null;
    await invoke("fs_create_file", { path: target.path, workspace });
  }
  return target.path;
}
