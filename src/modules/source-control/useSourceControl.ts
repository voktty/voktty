import {
  native,
  type GitRepoInfo,
  type GitStatusSnapshot,
} from "@/modules/ai/lib/native";
import { useWorkspaceEnvStore, workspaceScopeKey } from "@/modules/workspace";
import { t as translate } from "@/modules/i18n";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const AUTO_FETCH_THROTTLE_MS = 5 * 60_000;
const AUTO_FETCH_LRU_LIMIT = 16;
const FOCUS_REFRESH_MIN_INTERVAL_MS = 1500;
// Skip the context-change refetch when the data is this fresh and the new path
// is still inside the loaded repo (cd-within-repo produces identical status).
const SC_STATUS_TTL_MS = 2000;

export type SourceControlRefreshMode = "auto" | "always" | "never";
export type SourceControlRemoteAction = "fetch" | "pull" | "push" | "publish";
export type SourceControlRemoteActionMode =
  | "contextual"
  | SourceControlRemoteAction;

export type SourceControlRemoteActionResult = {
  ok: boolean;
  action: SourceControlRemoteAction | null;
  error?: string;
  blocked?: "diverged" | "missing-upstream" | "no-repo";
};

export type SourceControlSummary = {
  contextPath: string | null;
  repo: GitRepoInfo | null;
  status: GitStatusSnapshot | null;
  changedCount: number;
  upstream: string | null;
  ahead: number;
  behind: number;
  hasRepo: boolean;
  isLoading: boolean;
  localError: string | null;
  dubiousOwnershipPath: string | null;
  busyAction: SourceControlRemoteAction | null;
  lastRemoteError: string | null;
  applyStatus: (
    updater: (status: GitStatusSnapshot) => GitStatusSnapshot,
  ) => void;
  refresh: (options?: {
    remote?: SourceControlRefreshMode;
  }) => Promise<void>;
  trustRepository: (path?: string) => Promise<void>;
  initRepository: (path?: string) => Promise<void>;
  undoCommit: () => Promise<void>;
  runRemoteAction: (
    mode?: SourceControlRemoteActionMode,
  ) => Promise<SourceControlRemoteActionResult>;
};

export type SourceControlRemoteIndicator = {
  visible: boolean;
  label: string;
  title: string;
  disabled: boolean;
  action: SourceControlRemoteAction | null;
};

type SourceControlSummaryState = {
  contextPath: string | null;
  repo: GitRepoInfo | null;
  status: GitStatusSnapshot | null;
  hasRepo: boolean;
  isLoading: boolean;
  localError: string | null;
  dubiousOwnershipPath: string | null;
  busyAction: SourceControlRemoteAction | null;
  lastRemoteError: string | null;
};

type RefreshableSourceControlState = Pick<
  SourceControlSummaryState,
  | "contextPath"
  | "repo"
  | "status"
  | "hasRepo"
  | "isLoading"
  | "localError"
  | "lastRemoteError"
>;

type InflightRefresh = {
  contextKey: string;
  mode: SourceControlRefreshMode;
  promise: Promise<void>;
};

function sourceControlContextKey(
  workspaceKey: string,
  contextPath: string | null,
): string {
  return `${workspaceKey}\0${contextPath ?? ""}`;
}

function normalizedContextPath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  if (normalized === "/" || /^[A-Za-z]:\/$/.test(normalized)) {
    return normalized;
  }
  return normalized.replace(/\/+$/, "");
}

export function repositoryContainsContext(
  repoRoot: string | null,
  contextPath: string | null,
): boolean {
  if (!repoRoot || !contextPath) return false;
  let root = normalizedContextPath(repoRoot);
  let context = normalizedContextPath(contextPath);
  const windowsPaths =
    (/^[A-Za-z]:\//.test(root) && /^[A-Za-z]:\//.test(context)) ||
    (root.startsWith("//") && context.startsWith("//"));
  if (windowsPaths) {
    root = root.toLowerCase();
    context = context.toLowerCase();
  }
  const prefix = root.endsWith("/") ? root : `${root}/`;
  return context === root || context.startsWith(prefix);
}

export function beginSourceControlRefresh<
  T extends RefreshableSourceControlState,
>(current: T, contextPath: string, reuseCurrentRepository: boolean): T {
  return {
    ...current,
    contextPath,
    repo: reuseCurrentRepository ? current.repo : null,
    status: reuseCurrentRepository ? current.status : null,
    hasRepo: reuseCurrentRepository ? current.hasRepo : false,
    isLoading: true,
    localError: null,
    lastRemoteError: reuseCurrentRepository ? current.lastRemoteError : null,
  };
}

export function repositoryInfoFromStatus(
  status: GitStatusSnapshot,
): GitRepoInfo {
  return {
    repoRoot: status.repoRoot,
    branch: status.branch,
    upstream: status.upstream,
    isDetached: status.isDetached,
  };
}

function normalizeError(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "Unknown source control error";
}

function getContextualAction(
  status: GitStatusSnapshot | null,
): SourceControlRemoteAction | null {
  if (!status) return null;
  if (!status.upstream) {
    return status.isDetached ? null : "publish";
  }
  if (status.ahead > 0 && status.behind > 0) return null;
  if (status.behind > 0) return "pull";
  if (status.ahead > 0) return "push";
  return "fetch";
}

export function getSourceControlRemoteIndicator(
  summary: Pick<
    SourceControlSummary,
    "hasRepo" | "upstream" | "ahead" | "behind" | "busyAction" | "status"
  >,
): SourceControlRemoteIndicator {
  if (!summary.hasRepo) {
    return { visible: false, label: "", title: "", disabled: true, action: null };
  }
  if (!summary.upstream && !summary.status?.isDetached) {
    return {
      visible: true,
      label: translate("git.remoteIndicator.publish"),
      title: translate("git.remoteIndicator.publishTooltip"),
      disabled: summary.busyAction !== null,
      action: "publish",
    };
  }
  if (summary.ahead > 0 && summary.behind > 0) {
    return {
      visible: true,
      label: `↑${summary.ahead} ↓${summary.behind}`,
      title: translate("git.remoteIndicator.diverged"),
      disabled: true,
      action: null,
    };
  }
  if (summary.behind > 0) {
    return {
      visible: true,
      label: `↓${summary.behind}`,
      title: translate("git.remoteIndicator.pull", { count: summary.behind }),
      disabled: summary.busyAction !== null,
      action: "pull",
    };
  }
  if (summary.ahead > 0) {
    return {
      visible: true,
      label: `↑${summary.ahead}`,
      title: translate("git.remoteIndicator.push", { count: summary.ahead }),
      disabled: summary.busyAction !== null,
      action: "push",
    };
  }
  return {
    visible: true,
    label: translate("git.remoteIndicator.sync"),
    title: translate("git.remoteIndicator.fetch"),
    disabled: summary.busyAction !== null,
    action: "fetch",
  };
}

function touchAutoFetch(map: Map<string, number>, key: string): void {
  map.delete(key);
  map.set(key, Date.now());
  while (map.size > AUTO_FETCH_LRU_LIMIT) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}

function extractDubiousOwnershipPath(
  error: unknown,
  fallbackContextPath: string | null,
): string | null {
  const msg =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : "";
  const lower = msg.toLowerCase();
  if (
    lower.includes("dubious ownership") ||
    lower.includes("safe.directory") ||
    lower.includes("outside the authorized workspace") ||
    lower.includes("not in the list of safe directories") ||
    lower.includes("unsafe repository") ||
    lower.includes("unauthorized")
  ) {
    const match = msg.match(/(?:repository\s+at|workspace:)\s+('[^']+'|"[^"]+"|[^\s,]+)/i);
    if (match) {
      const extracted = match[1].replace(/^['"]|['"]$/g, "").trim();
      if (extracted.length > 0) return extracted;
    }
    return fallbackContextPath;
  }
  return null;
}

export function useSourceControl(
  contextPath: string | null,
  enabled: boolean = true,
): SourceControlSummary {
  const workspaceEnv = useWorkspaceEnvStore((s) => s.env);
  const workspaceKey = workspaceScopeKey(workspaceEnv);
  const [state, setState] = useState<SourceControlSummaryState>({
    contextPath: null,
    repo: null,
    status: null,
    hasRepo: false,
    isLoading: false,
    localError: null,
    dubiousOwnershipPath: null,
    busyAction: null,
    lastRemoteError: null,
  });
  const stateRef = useRef(state);
  const requestIdRef = useRef(0);
  const lastRefreshAtRef = useRef(0);
  const autoFetchByRepoRef = useRef<Map<string, number>>(new Map());
  const inflightRef = useRef<InflightRefresh | null>(null);

  const contextKey = useMemo(
    () => sourceControlContextKey(workspaceKey, contextPath),
    [workspaceKey, contextPath],
  );
  const contextKeyRef = useRef(contextKey);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    contextKeyRef.current = contextKey;
  }, [contextKey]);

  const applyStatus = useCallback(
    (updater: (status: GitStatusSnapshot) => GitStatusSnapshot) => {
      setState((current) => {
        if (!current.status) return current;
        const nextStatus = updater(current.status);
        return {
          ...current,
          status: nextStatus,
          repo: current.repo
            ? {
                ...current.repo,
                branch: nextStatus.branch,
                upstream: nextStatus.upstream,
                isDetached: nextStatus.isDetached,
              }
            : null,
        };
      });
    },
    [],
  );

  const doRefresh = useCallback(
    async (remoteMode: SourceControlRefreshMode = "auto") => {
      const activeContextPath = contextPath;
      const activeContextKey = contextKey;
      const requestId = ++requestIdRef.current;

      if (!enabled || !activeContextPath) {
        inflightRef.current = null;
        setState({
          contextPath: null,
          repo: null,
          status: null,
          hasRepo: false,
          isLoading: false,
          localError: null,
          dubiousOwnershipPath: null,
          busyAction: null,
          lastRemoteError: null,
        });
        return;
      }

      if (
        inflightRef.current &&
        inflightRef.current.contextKey === activeContextKey
      ) {
        if (
          inflightRef.current.mode === "always" ||
          inflightRef.current.mode === remoteMode
        ) {
          return inflightRef.current.promise;
        }
      }

      const current = stateRef.current;
      const canReuseRepo = repositoryContainsContext(
        current.repo?.repoRoot ?? null,
        activeContextPath,
      );

      setState((s) => beginSourceControlRefresh(s, activeContextPath, canReuseRepo));

      const isCurrentContext = () =>
        requestId === requestIdRef.current &&
        activeContextKey === contextKeyRef.current;

      const refreshPromise = (async () => {
        try {
          let repo: GitRepoInfo | null = null;
          let status: GitStatusSnapshot | null = null;

          if (canReuseRepo && current.repo) {
            const reusableRoot = current.repo.repoRoot;
            if (remoteMode === "always") {
              try {
                await native.gitFetch(reusableRoot, workspaceEnv);
                touchAutoFetch(autoFetchByRepoRef.current, reusableRoot);
              } catch (err) {
                if (isCurrentContext()) {
                  setState((s) => ({
                    ...s,
                    lastRemoteError: normalizeError(err),
                  }));
                }
              }
            }
            status = await native.gitStatus(reusableRoot, workspaceEnv);
            repo = repositoryInfoFromStatus(status);
          } else {
            const resolved = await native.gitResolveRepo(
              activeContextPath,
              workspaceEnv,
            );
            if (!resolved) {
              if (isCurrentContext()) {
                setState((s) => ({
                  ...s,
                  contextPath: activeContextPath,
                  repo: null,
                  status: null,
                  hasRepo: false,
                  isLoading: false,
                  localError: null,
                  dubiousOwnershipPath: null,
                }));
                lastRefreshAtRef.current = Date.now();
              }
              return;
            }
            repo = resolved;

            const shouldAutoFetch =
              remoteMode === "always" ||
              (remoteMode === "auto" &&
                repo.upstream !== null &&
                Date.now() -
                  (autoFetchByRepoRef.current.get(repo.repoRoot) ?? 0) >=
                  AUTO_FETCH_THROTTLE_MS);

            if (shouldAutoFetch) {
              try {
                await native.gitFetch(repo.repoRoot, workspaceEnv);
                touchAutoFetch(autoFetchByRepoRef.current, repo.repoRoot);
              } catch (err) {
                if (isCurrentContext()) {
                  setState((s) => ({
                    ...s,
                    lastRemoteError: normalizeError(err),
                  }));
                }
              }
            }

            status = await native.gitStatus(repo.repoRoot, workspaceEnv);
            repo = repositoryInfoFromStatus(status);
          }

          if (isCurrentContext()) {
            setState((s) => ({
              ...s,
              contextPath: activeContextPath,
              repo,
              status,
              hasRepo: true,
              isLoading: false,
              localError: null,
              dubiousOwnershipPath: null,
            }));
            lastRefreshAtRef.current = Date.now();
          }
        } catch (error) {
          if (!isCurrentContext()) return;
          const msg = normalizeError(error);
          const dubiousPath = extractDubiousOwnershipPath(
            error,
            activeContextPath,
          );
          setState((s) => ({
            ...s,
            contextPath: activeContextPath,
            repo: null,
            status: null,
            hasRepo: false,
            isLoading: false,
            localError: dubiousPath ? null : msg,
            dubiousOwnershipPath: dubiousPath,
          }));
          lastRefreshAtRef.current = Date.now();
        } finally {
          if (inflightRef.current?.contextKey === activeContextKey) {
            inflightRef.current = null;
          }
        }
      })();

      inflightRef.current = {
        contextKey: activeContextKey,
        mode: remoteMode,
        promise: refreshPromise,
      };

      return refreshPromise;
    },
    [contextPath, contextKey, enabled, workspaceEnv],
  );

  const refresh = useCallback(
    async (options?: { remote?: SourceControlRefreshMode }) => {
      await doRefresh(options?.remote ?? "auto");
    },
    [doRefresh],
  );

  const trustRepository = useCallback(
    async (path?: string) => {
      const pathToTrust =
        path ?? stateRef.current.dubiousOwnershipPath ?? contextPath;
      if (!pathToTrust) return;
      const trustedContextKey = contextKeyRef.current;
      await native.workspaceAuthorize(pathToTrust).catch(() => {});
      await native.gitAddSafeDirectory(pathToTrust, workspaceEnv);
      if (trustedContextKey !== contextKeyRef.current) return;

      const requestId = ++requestIdRef.current;
      inflightRef.current = null;
      setState((current) => ({
        ...current,
        contextPath,
        repo: null,
        status: null,
        hasRepo: false,
        isLoading: true,
        localError: null,
        dubiousOwnershipPath: null,
      }));

      try {
        const resolved = await native.gitResolveRepo(pathToTrust, workspaceEnv);
        if (
          requestId !== requestIdRef.current ||
          trustedContextKey !== contextKeyRef.current
        ) {
          return;
        }
        if (!resolved) {
          setState((current) => ({
            ...current,
            repo: null,
            status: null,
            hasRepo: false,
            isLoading: false,
            localError: null,
            dubiousOwnershipPath: null,
          }));
          return;
        }
        const status = await native.gitStatus(resolved.repoRoot, workspaceEnv);
        if (
          requestId !== requestIdRef.current ||
          trustedContextKey !== contextKeyRef.current
        ) {
          return;
        }
        setState((current) => ({
          ...current,
          repo: repositoryInfoFromStatus(status),
          status,
          hasRepo: true,
          isLoading: false,
          localError: null,
          dubiousOwnershipPath: null,
        }));
        lastRefreshAtRef.current = Date.now();
      } catch (error) {
        if (
          requestId !== requestIdRef.current ||
          trustedContextKey !== contextKeyRef.current
        ) {
          return;
        }
        setState((current) => ({
          ...current,
          repo: null,
          status: null,
          hasRepo: false,
          isLoading: false,
          localError: normalizeError(error),
          dubiousOwnershipPath: null,
        }));
      }
    },
    [contextKey, contextPath, workspaceEnv],
  );

  const initRepository = useCallback(
    async (targetPath?: string) => {
      const pathToInit = targetPath ?? contextPath;
      if (!pathToInit) return;
      await native.gitInit(pathToInit);
      window.dispatchEvent(new CustomEvent("voktty:git-refresh"));
      await doRefresh("never");
    },
    [contextPath, doRefresh],
  );

  const undoCommit = useCallback(async () => {
    const { repo } = stateRef.current;
    if (!repo) return;
    await native.gitUndoCommit(repo.repoRoot);
    window.dispatchEvent(new CustomEvent("voktty:git-refresh"));
    await doRefresh("never");
  }, [doRefresh]);

  useEffect(() => {
    const onGitRefresh = () => {
      void doRefresh("never");
    };
    window.addEventListener("voktty:git-refresh", onGitRefresh);
    window.addEventListener("monocode-git-changed", onGitRefresh);
    return () => {
      window.removeEventListener("voktty:git-refresh", onGitRefresh);
      window.removeEventListener("monocode-git-changed", onGitRefresh);
    };
  }, [doRefresh]);

  const runRemoteAction = useCallback(
    async (
      mode: SourceControlRemoteActionMode = "contextual",
    ): Promise<SourceControlRemoteActionResult> => {
      const { repo, status } = stateRef.current;
      if (!repo || !status) {
        return { ok: false, action: null, blocked: "no-repo" };
      }

      const action = mode === "contextual" ? getContextualAction(status) : mode;
      if (!action) {
        if (!status.upstream) {
          return { ok: false, action: null, blocked: "missing-upstream" };
        }
        return { ok: false, action: null, blocked: "diverged" };
      }

      setState((current) => ({ ...current, busyAction: action }));
      const actionContextKey = contextKeyRef.current;
      const isCurrentContext = () =>
        actionContextKey === contextKeyRef.current;

      try {
        if (action === "fetch") {
          await native.gitFetch(repo.repoRoot);
          touchAutoFetch(autoFetchByRepoRef.current, repo.repoRoot);
        } else if (action === "pull") {
          await native.gitFetch(repo.repoRoot);
          touchAutoFetch(autoFetchByRepoRef.current, repo.repoRoot);
          await native.gitPullFfOnly(repo.repoRoot);
        } else if (action === "publish") {
          await native.gitPublish(repo.repoRoot);
        } else {
          await native.gitPush(repo.repoRoot);
        }
        if (isCurrentContext()) {
          setState((current) => ({ ...current, lastRemoteError: null }));
          await refresh({ remote: "never" });
        }
        return { ok: true, action };
      } catch (error) {
        const message = normalizeError(error);
        if (isCurrentContext()) {
          setState((current) => ({ ...current, lastRemoteError: message }));
          await refresh({ remote: "never" }).catch(() => {});
        }
        return { ok: false, action, error: message };
      } finally {
        setState((current) => ({ ...current, busyAction: null }));
      }
    },
    [refresh],
  );

  useEffect(() => {
    if (!enabled) {
      requestIdRef.current++;
      setState({
        contextPath: null,
        repo: null,
        status: null,
        hasRepo: false,
        isLoading: false,
        localError: null,
        dubiousOwnershipPath: null,
        busyAction: null,
        lastRemoteError: null,
      });
      return;
    }
    setState((current) => ({ ...current, lastRemoteError: null }));
    const run = () => {
      const root = stateRef.current.repo?.repoRoot;
      const sameRepo = repositoryContainsContext(root ?? null, contextPath);
      const fresh = Date.now() - lastRefreshAtRef.current < SC_STATUS_TTL_MS;
      if (fresh && sameRepo && stateRef.current.hasRepo) {
        setState((current) =>
          current.contextPath === contextPath
            ? current
            : { ...current, contextPath },
        );
        return;
      }
      void refresh({ remote: "never" });
    };
    const idle =
      typeof window.requestIdleCallback === "function"
        ? window.requestIdleCallback(run, { timeout: 600 })
        : (window.setTimeout(run, 0) as unknown as number);
    return () => {
      if (typeof window.cancelIdleCallback === "function") {
        try {
          window.cancelIdleCallback(idle as number);
        } catch {
          /* noop */
        }
      } else {
        window.clearTimeout(idle as number);
      }
    };
  }, [refresh, contextPath, enabled]);

  useEffect(() => {
    if (!enabled) return;
    let timer = 0;
    const onFocus = () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = 0;
        const elapsed = Date.now() - lastRefreshAtRef.current;
        if (elapsed < FOCUS_REFRESH_MIN_INTERVAL_MS) return;
        void refresh({ remote: "never" });
      }, 400);
    };
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      if (timer) window.clearTimeout(timer);
    };
  }, [refresh, enabled]);

  return useMemo<SourceControlSummary>(
    () => ({
      contextPath: state.contextPath,
      repo: state.repo,
      status: state.status,
      changedCount: state.status?.changedFiles.length ?? 0,
      upstream: state.status?.upstream ?? state.repo?.upstream ?? null,
      ahead: state.status?.ahead ?? 0,
      behind: state.status?.behind ?? 0,
      hasRepo: state.hasRepo,
      isLoading: state.isLoading,
      localError: state.localError,
      dubiousOwnershipPath: state.dubiousOwnershipPath,
      busyAction: state.busyAction,
      lastRemoteError: state.lastRemoteError,
      applyStatus,
      refresh,
      trustRepository,
      initRepository,
      undoCommit,
      runRemoteAction,
    }),
    [
      state,
      applyStatus,
      refresh,
      trustRepository,
      initRepository,
      undoCommit,
      runRemoteAction,
    ],
  );
}
