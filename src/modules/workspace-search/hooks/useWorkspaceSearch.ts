import { usePreferencesStore } from "@/modules/settings/preferences";
import { type WorkspaceEnv, workspaceScopeKey } from "@/modules/workspace";
import { createWorkspaceSearchRequest } from "@/modules/workspace-search/lib/query";
import {
  cancelWorkspaceSearch,
  searchWorkspace,
} from "@/modules/workspace-search/lib/service";
import type {
  WorkspaceSearchOptions,
  WorkspaceSearchResponse,
} from "@/modules/workspace-search/types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const DEBOUNCE_MS = 220;

type SearchState = WorkspaceSearchResponse & {
  scope: string | null;
  loading: boolean;
  error: string | null;
};

export type WorkspaceSearchState = WorkspaceSearchResponse & {
  loading: boolean;
  error: string | null;
  supported: boolean;
  retry: () => void;
  searchNow: () => void;
};

const EMPTY_RESPONSE: WorkspaceSearchResponse = {
  hits: [],
  truncated: false,
  filesScanned: 0,
};

export function useWorkspaceSearch(
  root: string | null,
  workspace: WorkspaceEnv,
  options: WorkspaceSearchOptions,
  active: boolean,
): WorkspaceSearchState {
  const showHidden = usePreferencesStore((state) => state.showHidden);
  const [attempt, setAttempt] = useState(0);
  const handledAttempt = useRef(0);
  const requestSequence = useRef(0);
  const cancelQueue = useRef<Promise<void>>(Promise.resolve());
  const queueCancellation = useCallback((target: WorkspaceEnv) => {
    const pending = cancelQueue.current
      .catch(() => undefined)
      .then(() => cancelWorkspaceSearch(target))
      .catch(() => undefined);
    cancelQueue.current = pending;
    return pending;
  }, []);
  const supported = workspace.kind !== "serial" && workspace.kind !== "docker";
  const scope = root ? `${workspaceScopeKey(workspace)}:${root}` : null;
  const request = useMemo(
    () =>
      root
        ? createWorkspaceSearchRequest(root, workspace, options, showHidden)
        : null,
    [options, root, showHidden, workspace],
  );
  const [state, setState] = useState<SearchState>({
    ...EMPTY_RESPONSE,
    scope: null,
    loading: false,
    error: null,
  });
  const stateScopeRef = useRef(state.scope);
  const stateLoadingRef = useRef(state.loading);
  stateScopeRef.current = state.scope;
  stateLoadingRef.current = state.loading;
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  const searchNow = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    if (!active || !supported || !scope || !request) {
      requestSequence.current += 1;
      if (active && stateScopeRef.current !== scope) {
        setState({
          ...EMPTY_RESPONSE,
          scope,
          loading: false,
          error: null,
        });
      } else if (!request && stateLoadingRef.current) {
        setState((current) => ({ ...current, loading: false, error: null }));
      }
      void queueCancellation(workspace);
      return;
    }

    const sequence = ++requestSequence.current;
    const sameScope = stateScopeRef.current === scope;
    setState((current) => ({
      ...(sameScope ? current : { ...EMPTY_RESPONSE, scope }),
      loading: true,
      error: null,
    }));
    const immediate = attempt !== handledAttempt.current;
    handledAttempt.current = attempt;
    const delay = immediate ? 0 : DEBOUNCE_MS;
    const timeout = window.setTimeout(() => {
      void cancelQueue.current
        .then(() => {
          if (requestSequence.current !== sequence) return undefined;
          return searchWorkspace(request);
        })
        .then((response) => {
          if (!response) return;
          if (requestSequence.current !== sequence) return;
          setState({ ...response, scope, loading: false, error: null });
        })
        .catch((error) => {
          if (requestSequence.current !== sequence) return;
          setState((current) => ({
            ...current,
            scope,
            loading: false,
            error: error instanceof Error ? error.message : String(error),
          }));
        });
    }, delay);

    return () => {
      window.clearTimeout(timeout);
      requestSequence.current += 1;
      void queueCancellation(workspace);
    };
  }, [
    active,
    attempt,
    queueCancellation,
    request,
    scope,
    supported,
    workspace,
  ]);

  if (state.scope !== scope) {
    return {
      ...EMPTY_RESPONSE,
      loading: active && supported && Boolean(request),
      error: null,
      supported,
      retry,
      searchNow,
    };
  }
  return { ...state, supported, retry, searchNow };
}
