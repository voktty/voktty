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
    if (!canProbeProjectRoot(root, workspace)) return;
    let current = true;
    void native
      .readDir(root, workspace)
      .then((entries) => {
        if (!current) return;
        const kind = detectWebProject(entries);
        setState({
          key,
          info: kind ? { kind, docroot: webProjectDocroot(entries) } : null,
        });
      })
      .catch(() => {
        if (current) setState({ key, info: null });
      });
    return () => {
      current = false;
    };
    // The workspace object is identified by `key`; it is rebuilt freely upstream.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return state && state.key === key ? state.info : null;
}
