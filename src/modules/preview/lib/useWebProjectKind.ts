import { native } from "@/modules/ai/lib/native";
import { isPathWithinRemoteRoot } from "@/modules/remote";
import { LOCAL_WORKSPACE, type WorkspaceEnv } from "@/modules/workspace";
import { useEffect, useState } from "react";
import { webProjectDocroot } from "./remoteServer";
import {
  detectWebProject,
  isLocalProjectRoot,
  type WebProjectKind,
} from "./webProject";

export type WebProjectInfo = {
  kind: WebProjectKind;
  docroot: "public" | ".";
};

/**
 * A remote folder can be listed only inside its session's root; reading
 * anything else is rejected by the host, so those folders are not probed.
 */
export function canProbeProjectRoot(
  root: string | null | undefined,
  workspace: WorkspaceEnv,
): root is string {
  if (!root) return false;
  if (workspace.kind === "ssh") {
    return (
      workspace.sessionId !== undefined &&
      root.startsWith("/") &&
      isPathWithinRemoteRoot(workspace, root)
    );
  }
  return workspace.kind === "local" && isLocalProjectRoot(root);
}

/** Web project in `root` (local or over SSH), or null while unknown or not a web project. */
export function useWebProjectKind(
  root: string | null | undefined,
  workspace: WorkspaceEnv = LOCAL_WORKSPACE,
): WebProjectInfo | null {
  const sessionKey =
    workspace.kind === "ssh" ? `${workspace.connection.id}:${workspace.sessionId}` : workspace.kind;
  const [state, setState] = useState<{
    key: string;
    info: WebProjectInfo | null;
  } | null>(null);
  const key = `${sessionKey}|${root ?? ""}`;

  useEffect(() => {
    if (!canProbeProjectRoot(root, workspace)) {
      setState(null);
      return;
    }
    let current = true;
    let pollTimer: number | null = null;

    const probe = async () => {
      try {
        const entries = await native.readDir(root, workspace);
        if (!current) return;
        let kind = detectWebProject(entries);
        let docroot: "public" | "." = webProjectDocroot(entries);
        if (
          !kind &&
          entries.some(
            (e) => e.name.toLowerCase() === "public" && e.kind === "dir",
          )
        ) {
          const sep = root.includes("\\") ? "\\" : "/";
          const publicPath =
            root.endsWith("/") || root.endsWith("\\")
              ? `${root}public`
              : `${root}${sep}public`;
          try {
            const publicEntries = await native.readDir(publicPath, workspace);
            const publicKind = detectWebProject(publicEntries);
            if (publicKind) {
              kind = publicKind;
              docroot = "public";
            }
          } catch {
            // public folder not readable
          }
        }
        if (!current) return;
        setState((prev) => {
          const nextInfo: WebProjectInfo | null = kind
            ? { kind, docroot }
            : null;
          if (
            prev &&
            prev.key === key &&
            prev.info?.kind === nextInfo?.kind &&
            prev.info?.docroot === nextInfo?.docroot
          ) {
            return prev;
          }
          return { key, info: nextInfo };
        });
      } catch {
        if (current) {
          setState((prev) =>
            prev?.key === key && prev?.info === null
              ? prev
              : { key, info: null },
          );
        }
      }
    };

    void probe();

    const onFsEvent = () => {
      void probe();
    };

    window.addEventListener("voktty:file-saved", onFsEvent);
    window.addEventListener("voktty:remote-file-saved", onFsEvent);
    window.addEventListener("voktty:git-refresh", onFsEvent);
    window.addEventListener("monocode-git-changed", onFsEvent);
    window.addEventListener("focus", onFsEvent);
    document.addEventListener("visibilitychange", onFsEvent);

    const schedulePoll = () => {
      if (!current) return;
      pollTimer = window.setTimeout(async () => {
        await probe();
        schedulePoll();
      }, 2500);
    };
    schedulePoll();

    return () => {
      current = false;
      if (pollTimer != null) window.clearTimeout(pollTimer);
      window.removeEventListener("voktty:file-saved", onFsEvent);
      window.removeEventListener("voktty:remote-file-saved", onFsEvent);
      window.removeEventListener("voktty:git-refresh", onFsEvent);
      window.removeEventListener("monocode-git-changed", onFsEvent);
      window.removeEventListener("focus", onFsEvent);
      document.removeEventListener("visibilitychange", onFsEvent);
    };
    // The workspace object is identified by `key`; it is rebuilt freely upstream.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return state && state.key === key ? state.info : null;
}
