import type { GitStatusSnapshot } from "@/modules/ai/lib/native";
import type { WorkspaceEnv } from "@/modules/workspace";
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  bubbleUpDirectoryStatuses,
  buildGitStatusMap,
  lookupGitStatus,
  normalizePath,
  repoRelativePath,
  type GitStatusCode,
} from "./gitStatusUtils";

const EMPTY = new Map<string, GitStatusCode>();

// Decorations ride the always-resident SC snapshot: no fetch, no watcher. When
// the shared status does not cover the explorer root, nothing is shown rather
// than triggering git work of our own.
export function useGitStatus(
  workspaceRoot: string | null,
  status: GitStatusSnapshot | null | undefined,
  enabled: boolean,
  workspace: WorkspaceEnv,
  statusWorkspace: WorkspaceEnv | undefined,
) {
  const filesystem = JSON.stringify(workspace);
  const statusFilesystem = JSON.stringify(statusWorkspace);
  const sameFilesystem = filesystem === statusFilesystem;
  const hasSnapshot = !!status;
  const binding = useMemo(
    () => ({
      workspaceRoot,
      filesystem,
      statusFilesystem,
      enabled,
      hasSnapshot,
    }),
    [workspaceRoot, filesystem, statusFilesystem, enabled, hasSnapshot],
  );
  const [canonical, setCanonical] = useState<{
    binding: typeof binding;
    path: string;
  } | null>(null);
  const unsettled = useRef(new Set<object>());
  const canonicalRoot = canonical?.binding === binding ? canonical.path : null;

  useEffect(() => {
    const captured: WorkspaceEnv = JSON.parse(filesystem);
    if (
      !enabled ||
      !hasSnapshot ||
      !sameFilesystem ||
      !workspaceRoot ||
      (!workspaceRoot.startsWith("/") &&
        !/^[A-Za-z]:[/\\]/.test(workspaceRoot)) ||
      (captured.kind === "wsl" && !workspaceRoot.startsWith("/")) ||
      (captured.kind !== "local" && captured.kind !== "wsl") ||
      unsettled.current.size >= 256
    ) {
      return;
    }
    const receipt = { active: true };
    unsettled.current.add(receipt);
    void invoke<string>("fs_canonicalize", {
      path: workspaceRoot,
      workspace: captured,
    })
      .then((c) => {
        if (receipt.active)
          setCanonical((previous) =>
            receipt.active ? { binding, path: c } : previous,
          );
      })
      .catch(() => {})
      .finally(() => {
        unsettled.current.delete(receipt);
      });
    return () => {
      receipt.active = false;
    };
  }, [
    binding,
    enabled,
    hasSnapshot,
    sameFilesystem,
    workspaceRoot,
    filesystem,
  ]);

  const aliases = useMemo(() => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const r of [workspaceRoot, canonicalRoot]) {
      if (!r) continue;
      const n = normalizePath(r);
      if (seen.has(n)) continue;
      seen.add(n);
      out.push(r);
    }
    return out;
  }, [workspaceRoot, canonicalRoot]);

  // The explorer root and the snapshot's repo overlap in either nesting
  // direction; lookups still return null for paths outside the repo.
  const repoRoot0 = status ? normalizePath(status.repoRoot) : null;
  const covers =
    enabled &&
    sameFilesystem &&
    !!status &&
    repoRoot0 !== null &&
    aliases.some((a) => {
      const t = normalizePath(a);
      return (
        (t === "" && a.startsWith("/") && repoRoot0.startsWith("/")) ||
        t === repoRoot0 ||
        t.startsWith(`${repoRoot0}/`) ||
        repoRoot0.startsWith(`${t}/`)
      );
    });

  const map = useMemo(() => {
    if (!covers || !status) return EMPTY;
    const m = buildGitStatusMap(status);
    bubbleUpDirectoryStatuses(m);
    return m;
  }, [covers, status]);
  const repoRoot = covers && status ? status.repoRoot : null;

  const lookup = useCallback(
    (path: string): GitStatusCode | null => {
      if (!repoRoot) return null;
      const direct = lookupGitStatus(map, repoRoot, path);
      if (direct || !workspaceRoot || !canonicalRoot) return direct;
      const relative = repoRelativePath(path, [workspaceRoot]);
      return relative === null
        ? null
        : lookupGitStatus(
            map,
            repoRoot,
            `${canonicalRoot.replace(/\/+$/, "")}/${relative}`,
          );
    },
    [repoRoot, map, workspaceRoot, canonicalRoot],
  );

  return { lookup };
}
