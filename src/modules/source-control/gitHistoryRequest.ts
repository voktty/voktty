import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import type { WorkspaceEnv } from "@/modules/workspace";

export const GIT_HISTORY_EVENT = "voktty:open-git-graph";
export type GitHistoryInput = Readonly<{
  repoRoot: string;
  workspaceEnv: WorkspaceEnv;
  branch?: string | null;
}>;
type Request = Readonly<{ input: GitHistoryInput; isCurrent: () => boolean }>;
const requests = new WeakMap<object, Request>();

export function readGitHistoryRequest(detail: unknown): Request | undefined {
  return detail !== null && typeof detail === "object"
    ? requests.get(detail)
    : undefined;
}

export function takeGitHistoryRequest(detail: unknown): Request | undefined {
  const request = readGitHistoryRequest(detail);
  if (request && detail !== null && typeof detail === "object")
    requests.delete(detail);
  return request;
}

export function useGitHistoryRequest({
  repoRoot,
  workspaceEnv,
  branch,
}: {
  repoRoot?: string | null;
  workspaceEnv: WorkspaceEnv;
  branch?: string | null;
}) {
  const workspaceKey = JSON.stringify(workspaceEnv);
  const binding = useMemo(
    () => ({ repoRoot, branch, workspaceKey }),
    [repoRoot, branch, workspaceKey],
  );
  const owner = useRef<{ binding: typeof binding; live: boolean } | null>(null);
  useLayoutEffect(() => {
    const receipt = { binding, live: true };
    owner.current = receipt;
    return () => {
      receipt.live = false;
    };
  }, [binding]);
  return useCallback(() => {
    const receipt = owner.current;
    const isCurrent = () =>
      !!receipt?.live &&
      owner.current === receipt &&
      receipt.binding === binding;
    if (
      !isCurrent() ||
      !repoRoot?.trim() ||
      repoRoot.length > 32768 ||
      /[\x00-\x1f\x7f]/.test(repoRoot) ||
      (branch != null &&
        (branch.length > 4096 || /[\x00-\x1f\x7f]/.test(branch)))
    )
      return false;
    const input = Object.freeze({
      repoRoot,
      branch,
      workspaceEnv: structuredClone(workspaceEnv),
    });
    const key = {};
    requests.set(key, { input, isCurrent });
    try {
      window.dispatchEvent(new CustomEvent(GIT_HISTORY_EVENT, { detail: key }));
    } finally {
      requests.delete(key);
    }
    return true;
  }, [binding, repoRoot, branch, workspaceEnv]);
}
