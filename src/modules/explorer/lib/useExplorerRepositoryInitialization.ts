import { useMemo } from "react";
import { native } from "@/modules/ai/lib/native";
import type { WorkspaceEnv } from "@/modules/workspace";
import { useExplorerGitInitialization } from "@/modules/explorer/lib/useExplorerGitInitialization";

export function canInitializeExplorerRepository(
  path: string | null,
  workspace: WorkspaceEnv,
): boolean {
  if (!path || path.length > 32768 || /[\x00-\x1f\x7f]/.test(path))
    return false;
  const normalized = path.replace(/\\/g, "/");
  if (normalized.startsWith("remote://")) {
    return /^remote:\/\/voktty-ssh-[^/]+\//.test(normalized);
  }
  if (workspace.kind === "docker" || workspace.kind === "serial") return false;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(normalized)) return false;
  if (workspace.kind === "local")
    return normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized);
  return normalized.startsWith("/") && !normalized.startsWith("//");
}

export function useExplorerRepositoryInitialization({
  scope,
  rootPath,
  workspace,
  onSuccess,
  onError,
}: {
  scope: object;
  rootPath: string | null;
  workspace: WorkspaceEnv;
  onSuccess: () => void;
  onError: (error: unknown) => void;
}) {
  const available = canInitializeExplorerRepository(rootPath, workspace);
  const initialize = useMemo(() => {
    if (!available) return undefined;
    const captured = structuredClone(workspace);
    return async (path: string) => {
      await native.gitInit(path, captured);
      return true;
    };
  }, [available, workspace]);
  const run = useExplorerGitInitialization({
    scope,
    rootPath,
    initialize,
    onSuccess: (isCurrent) => {
      window.dispatchEvent(new CustomEvent("voktty:git-refresh"));
      if (isCurrent()) onSuccess();
    },
    onError,
  });
  return { run, available };
}
