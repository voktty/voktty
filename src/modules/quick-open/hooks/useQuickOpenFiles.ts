import { remoteReadDir } from "@/modules/remote";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { type WorkspaceEnv, workspaceScopeKey } from "@/modules/workspace";
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import { indexRemoteFiles } from "../lib/remoteFileIndex";
import { quickOpenScope } from "../lib/quickOpen";

type ListFilesResult = { files: string[]; truncated: boolean };

type CacheEntry = ListFilesResult & { fetchedAt: number };

type IndexedState = Omit<QuickOpenFilesState, "retry"> & {
  scope: string | null;
};

export type QuickOpenFilesState = ListFilesResult & {
  loading: boolean;
  error: string | null;
  retry: () => void;
};

const CACHE_TTL_MS = 30_000;
const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<CacheEntry>>();

function fetchWorkspaceFiles(
  root: string,
  workspace: WorkspaceEnv,
  showHidden: boolean,
): Promise<CacheEntry> {
  const scope = `${quickOpenScope(root, workspaceScopeKey(workspace))}:${showHidden}`;
  const running = inflight.get(scope);
  if (running) return running;

  const request = (
    workspace.kind === "ssh"
      ? indexRemoteFiles(root, (path) => remoteReadDir(workspace, path), {
          showHidden,
        })
      : invoke<ListFilesResult>("fs_list_files", {
          root,
          limit: 10_000,
          maxDepth: 16,
          showHidden,
          workspace,
        })
  )
    .then((result) => ({ ...result, fetchedAt: Date.now() }))
    .then((entry) => {
      cache.set(scope, entry);
      return entry;
    })
    .finally(() => inflight.delete(scope));

  inflight.set(scope, request);
  return request;
}

export function useQuickOpenFiles(
  root: string | null,
  workspace: WorkspaceEnv,
  enabled: boolean,
): QuickOpenFilesState {
  const showHidden = usePreferencesStore((state) => state.showHidden);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<IndexedState>({
    scope: null,
    files: [],
    truncated: false,
    loading: false,
    error: null,
  });
  const scope = root
    ? `${quickOpenScope(root, workspaceScopeKey(workspace))}:${showHidden}`
    : null;
  const retry = useCallback(() => {
    if (scope) cache.delete(scope);
    setAttempt((value) => value + 1);
  }, [scope]);

  useEffect(() => {
    if (
      !enabled ||
      !root ||
      workspace.kind === "serial" ||
      workspace.kind === "docker"
    ) {
      if (enabled) {
        setState({
          scope,
          files: [],
          truncated: false,
          loading: false,
          error: null,
        });
      }
      return;
    }

    const cached = scope ? cache.get(scope) : undefined;
    if (cached) {
      setState({ scope, ...cached, loading: false, error: null });
      if (Date.now() - cached.fetchedAt < CACHE_TTL_MS) return;
    } else {
      setState({
        scope,
        files: [],
        truncated: false,
        loading: true,
        error: null,
      });
    }

    let cancelled = false;
    if (cached) {
      setState((current) => ({ ...current, loading: true, error: null }));
    }
    fetchWorkspaceFiles(root, workspace, showHidden)
      .then((entry) => {
        if (cancelled) return;
        if (attempt !== 0) setAttempt(0);
        setState({ scope, ...entry, loading: false, error: null });
      })
      .catch((error) => {
        if (cancelled) return;
        setState((current) => ({
          ...current,
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        }));
      });
    return () => {
      cancelled = true;
    };
  }, [attempt, enabled, root, scope, showHidden, workspace]);

  if (state.scope !== scope) {
    return {
      files: [],
      truncated: false,
      loading:
        enabled &&
        Boolean(root) &&
        workspace.kind !== "serial" &&
        workspace.kind !== "docker",
      error: null,
      retry,
    };
  }
  return { ...state, retry };
}
