import type { FileCitationSource } from "@/modules/ai/store/chatStore";
import { searchGuestFiles } from "@/modules/collab/lib/guestRuntime";
import { currentWorkspaceEnv } from "@/modules/workspace";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

export type WorkspaceFilesState = {
  files: string[];
  indexing: boolean;
  truncated: boolean;
  hasWorkspace: boolean;
  remote: boolean;
  error: string | null;
};

type ListFilesResult = { files: string[]; truncated: boolean };

type CacheEntry = {
  files: string[];
  truncated: boolean;
  fetchedAt: number;
};

const CACHE_TTL_MS = 60_000;
const REMOTE_RESULT_LIMIT = 30;
const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<CacheEntry>>();

function isFresh(entry: CacheEntry): boolean {
  return Date.now() - entry.fetchedAt < CACHE_TTL_MS;
}

function fetchLocalFiles(root: string): Promise<CacheEntry> {
  const existing = inflight.get(root);
  if (existing) return existing;
  const promise = invoke<ListFilesResult>("fs_list_files", {
    root,
    workspace: currentWorkspaceEnv(),
  })
    .then((result) => {
      const entry: CacheEntry = {
        files: result.files,
        truncated: result.truncated,
        fetchedAt: Date.now(),
      };
      cache.set(root, entry);
      return entry;
    })
    .finally(() => {
      inflight.delete(root);
    });
  inflight.set(root, promise);
  return promise;
}

const EMPTY_STATE: WorkspaceFilesState = {
  files: [],
  indexing: false,
  truncated: false,
  hasWorkspace: false,
  remote: false,
  error: null,
};

export function useWorkspaceFiles(
  source: FileCitationSource,
  query: string,
  enabled: boolean,
): WorkspaceFilesState {
  const kind = source.kind;
  const root = source.kind === "local" ? source.root : null;
  const leafId = source.kind === "collab" ? source.leafId : null;
  const remoteAvailable = source.kind === "collab" && source.available;
  const [state, setState] = useState<WorkspaceFilesState>(EMPTY_STATE);

  useEffect(() => {
    if (kind === "collab") {
      if (!remoteAvailable || leafId === null) {
        setState({ ...EMPTY_STATE, remote: true });
        return;
      }
      if (!enabled) {
        setState((current) => ({
          ...current,
          hasWorkspace: true,
          remote: true,
          error: null,
        }));
        return;
      }
      let cancelled = false;
      setState((current) => ({
        ...current,
        indexing: true,
        hasWorkspace: true,
        remote: true,
        error: null,
      }));
      searchGuestFiles(leafId, query, REMOTE_RESULT_LIMIT)
        .then((result) => {
          if (cancelled) return;
          setState({
            files: result.files,
            indexing: false,
            truncated: result.truncated,
            hasWorkspace: true,
            remote: true,
            error: null,
          });
        })
        .catch((error) => {
          if (cancelled) return;
          setState({
            files: [],
            indexing: false,
            truncated: false,
            hasWorkspace: true,
            remote: true,
            error: String(error),
          });
        });
      return () => {
        cancelled = true;
      };
    }

    if (!root) {
      setState(EMPTY_STATE);
      return;
    }
    const cached = cache.get(root);
    if (cached) {
      setState({
        files: cached.files,
        truncated: cached.truncated,
        indexing: false,
        hasWorkspace: true,
        remote: false,
        error: null,
      });
      if (isFresh(cached)) return;
    }
    if (!enabled) return;

    let cancelled = false;
    setState((current) => ({
      ...current,
      indexing: true,
      hasWorkspace: true,
      remote: false,
      error: null,
    }));
    fetchLocalFiles(root)
      .then((entry) => {
        if (cancelled) return;
        setState({
          files: entry.files,
          truncated: entry.truncated,
          indexing: false,
          hasWorkspace: true,
          remote: false,
          error: null,
        });
      })
      .catch((error) => {
        if (cancelled) return;
        setState((current) => ({
          ...current,
          indexing: false,
          error: String(error),
        }));
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, kind, leafId, query, remoteAvailable, root]);

  return state;
}
