import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { t } from "@/modules/i18n";

export async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Best-effort; ignore in environments without clipboard permission.
  }
}

export function relativePath(rootPath: string, path: string): string {
  if (path === rootPath) return ".";
  if (path.startsWith(`${rootPath}/`)) return path.slice(rootPath.length + 1);
  return path;
}

export async function revealInFinder(path: string): Promise<void> {
  try {
    await revealItemInDir(path);
  } catch (e) {
    console.error("revealItemInDir failed:", e);
  }
}

export async function downloadRemoteFileOrFolder(
  connection: import("@/modules/remote").RemoteSshConnection,
  remotePath: string,
): Promise<void> {
  return downloadRemoteFilesOrFolders(connection, [remotePath]);
}

export async function downloadRemoteFilesOrFolders(
  connection: import("@/modules/remote").RemoteSshConnection,
  remotePaths: string[],
): Promise<void> {
  if (remotePaths.length === 0) return;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const { toast } = await import("sonner");
    const destDir = await invoke<string | null>("fs_pick_folder");
    if (!destDir) return;

    const label =
      remotePaths.length === 1
        ? remotePaths[0].replace(/\\/g, "/").split("/").pop() || "file"
        : `${remotePaths.length} items`;
    const toastId = toast.loading(
      t("feedback.downloadStarting", { label, host: connection.host }),
    );

    await invoke("ssh_download_files", {
      connection,
      remoteSources: remotePaths,
      localDestDir: destDir,
    });

    toast.success(t("feedback.downloadSuccess", { label, dir: destDir }), {
      id: toastId,
    });
  } catch (err) {
    const { toast } = await import("sonner");
    toast.error(t("feedback.downloadFailed", { error: String(err) }));
  }
}
