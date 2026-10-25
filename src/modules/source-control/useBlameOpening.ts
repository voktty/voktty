import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { native } from "@/modules/ai/lib/native";
import type { WorkspaceEnv } from "@/modules/workspace";

export type BlameTarget = {
  repoRoot: string;
  path: string;
  workspace: WorkspaceEnv;
};

export function canOpenNativeBlame(
  path: string,
  workspace: WorkspaceEnv,
): boolean {
  if (!path || path.length > 32768 || /[\x00-\x1f\x7f]/.test(path))
    return false;
  const normalized = path.replace(/\\/g, "/");
  if (workspace.kind === "local")
    return normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized);
  if (workspace.kind !== "wsl" && workspace.kind !== "ssh") return false;
  return normalized.startsWith("/") && !normalized.startsWith("//");
}

export function useBlameOpening({
  scope,
  workspace,
  open,
  onMissing,
  onError,
}: {
  scope: object;
  workspace: WorkspaceEnv;
  open?: (target: BlameTarget) => void;
  onMissing: () => void;
  onError: (error: unknown) => void;
}) {
  const filesystem = JSON.stringify(workspace);
  const binding = useMemo(
    () => ({ scope, filesystem, open, onMissing, onError }),
    [scope, filesystem, open, onMissing, onError],
  );
  const current = useRef<{
    binding: typeof binding;
    latest: object | null;
  } | null>(null);
  const unsettled = useRef(new Set<object>());
  useLayoutEffect(() => {
    const owner = { binding, latest: null };
    current.current = owner;
    return () => {
      if (current.current === owner) current.current = null;
    };
  }, [binding]);
  return useCallback(
    async (path: string) => {
      const owner = current.current;
      if (
        !owner ||
        owner.binding !== binding ||
        !binding.open ||
        unsettled.current.size >= 256
      )
        return;
      const workspace: WorkspaceEnv = JSON.parse(binding.filesystem);
      if (!canOpenNativeBlame(path, workspace)) return;
      const request = {};
      owner.latest = request;
      unsettled.current.add(request);
      const isCurrent = () =>
        current.current === owner && owner.latest === request;
      try {
        const repo = await native.gitResolveRepo(path, workspace);
        if (!isCurrent()) return;
        if (!repo) {
          binding.onMissing();
          return;
        }
        if (!canOpenNativeBlame(repo.repoRoot, workspace)) return;
        binding.open({ repoRoot: repo.repoRoot, path, workspace });
      } catch (error) {
        if (isCurrent()) binding.onError(error);
      } finally {
        unsettled.current.delete(request);
      }
    },
    [binding],
  );
}
