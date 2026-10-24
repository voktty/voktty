import { invoke } from "@tauri-apps/api/core";
import { LOCAL_WORKSPACE, type WorkspaceEnv } from "@/modules/workspace";

export type VaultTarget = { path: string; workspace: WorkspaceEnv };

export function vaultPath(root: string, ...segments: string[]): string {
  return `${root.replace(/\\/g, "/").replace(/\/+$/, "")}/${segments.join("/")}`;
}

export function vaultAvailable(
  target: VaultTarget | null | undefined,
): boolean {
  if (!target?.path || /[\x00-\x1f\x7f]/.test(target.path)) return false;
  if (target.workspace.kind === "docker" || target.workspace.kind === "serial")
    return false;
  return /^(?:remote:\/\/[^/]+\/|\/|[A-Za-z]:[/\\]|\\\\)/.test(target.path);
}

export function requireVaultCurrent(current: () => boolean): void {
  if (!current()) throw new Error("Vault request was retired");
}

export function vaultFilesystem(
  cwd: string,
  workspace: WorkspaceEnv = LOCAL_WORKSPACE,
  current: () => boolean = () => true,
) {
  const target = { path: cwd, workspace: structuredClone(workspace) };
  if (!vaultAvailable(target))
    throw new Error("Vault filesystem is unavailable");
  const env = target.workspace;
  const namespace = cwd.startsWith("remote://");
  const preparedDirectories = new Set<string>();
  return {
    async list(path: string): Promise<{ name: string; isDir: boolean }[]> {
      requireVaultCurrent(current);
      if (namespace || env.kind === "local") {
        const { listDir } = await import("@/modules/harness/lib/fs");
        requireVaultCurrent(current);
        return listDir(path);
      }
      if (env.kind === "ssh") {
        const { remoteReadDir } = await import("@/modules/remote/filesystem");
        requireVaultCurrent(current);
        return (await remoteReadDir(env, path)).map((entry) => ({
          name: entry.name,
          isDir: entry.kind === "dir",
        }));
      }
      const entries = await invoke<{ name: string; kind: string }[]>(
        "fs_read_dir",
        {
          path,
          workspace: env,
          showHidden: true,
        },
      );
      return entries.map((entry) => ({
        name: entry.name,
        isDir: entry.kind === "dir",
      }));
    },
    async read(path: string): Promise<string> {
      requireVaultCurrent(current);
      if (namespace || env.kind === "local") {
        const { readTextFile } = await import("@/modules/harness/lib/fs");
        requireVaultCurrent(current);
        return readTextFile(path);
      }
      if (env.kind === "ssh") {
        const { remoteReadFile } = await import("@/modules/remote/filesystem");
        requireVaultCurrent(current);
        return (await remoteReadFile(env, path)).content;
      }
      const result = await invoke<{ kind: string; content?: string }>(
        "fs_read_file",
        { path, workspace: env },
      );
      if (result.kind !== "text" || typeof result.content !== "string")
        throw new Error("Vault file is not text");
      return result.content;
    },
    async write(column: string, name: string, content: string): Promise<void> {
      const path = vaultPath(cwd, ".voktty", "tasks", column, name);
      requireVaultCurrent(current);
      if (namespace || env.kind === "local") {
        const { writeTextFile, createPath, listDir } = await import(
          "@/modules/harness/lib/fs"
        );
        let parent = cwd;
        for (const segment of [".voktty", "tasks", column]) {
          requireVaultCurrent(current);
          const next = vaultPath(parent, segment);
          if (preparedDirectories.has(next)) {
            parent = next;
            continue;
          }
          try {
            await createPath(parent, segment, true);
          } catch {
            requireVaultCurrent(current);
            await listDir(next);
          }
          preparedDirectories.add(next);
          parent = next;
        }
        requireVaultCurrent(current);
        await writeTextFile(path, content);
        return;
      }
      const parents = [
        vaultPath(cwd, ".voktty"),
        vaultPath(cwd, ".voktty", "tasks"),
        vaultPath(cwd, ".voktty", "tasks", column),
      ];
      if (env.kind === "ssh") {
        const { remoteCreateDir, remoteStat, remoteWriteFile } = await import(
          "@/modules/remote/filesystem"
        );
        for (const parent of parents) {
          requireVaultCurrent(current);
          if (preparedDirectories.has(parent)) continue;
          try {
            await remoteCreateDir(env, parent);
          } catch {
            requireVaultCurrent(current);
            if ((await remoteStat(env, parent)).kind !== "dir")
              throw new Error("Vault directory is unavailable");
          }
          preparedDirectories.add(parent);
        }
        requireVaultCurrent(current);
        await remoteWriteFile(env, path, content);
      } else {
        for (const parent of parents) {
          requireVaultCurrent(current);
          if (preparedDirectories.has(parent)) continue;
          try {
            await invoke("fs_create_dir", { path: parent, workspace: env });
          } catch {
            requireVaultCurrent(current);
            const stat = await invoke<{ kind: string }>("fs_stat", {
              path: parent,
              workspace: env,
            });
            if (stat.kind !== "dir")
              throw new Error("Vault directory is unavailable");
          }
          preparedDirectories.add(parent);
        }
        requireVaultCurrent(current);
        await invoke("fs_write_file", {
          path,
          workspace: env,
          content,
          source: "kanban-vault",
        });
      }
    },
  };
}
