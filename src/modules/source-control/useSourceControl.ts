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
export type SourceControlRemoteAction = "fetch" | "pull" | "push";
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
  if (!status?.upstream) return null;
  if (status.ahead > 0 && status.behind > 0) return null;
  if (status.behind > 0) return "pull";
  if (status.ahead > 0) return "push";
  return "fetch";
}

export function getSourceControlRemoteIndicator(
  summary: Pick<
    SourceControlSummary,
    "hasRepo" | "upstream" | "ahead" | "behind" | "busyAction"
  >,
): SourceControlRemoteIndicator {
  if (!summary.hasRepo || !summary.upstream) {
    return { visible: false, label: "", title: "", disabled: true, action: null };
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
  if (!msg.toLowerCase().includes("dubious ownership")) return null;
  const match = msg.match(/repository\s+at\s+('[^']+'|"[^"]+")/i);
  if (match) {
    return match[1].replace(/^['"]|['"]$/g, "");
  }
  return fallbackContextPath;
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
  const inflightRef = useRef<InflightRefresh | null>(null);
  const autoFetchByRepoRef = useRef(new Map<string, number>());
  const enabledRef = useRef(enabled);
  const lastRefreshAtRef = useRef(0);
  const resetWorkspaceKeyRef = useRef(workspaceKey);
  const contextKey = sourceControlContextKey(workspaceKey, contextPath);
  const contextKeyRef = useRef(contextKey);
  contextKeyRef.current = contextKey;

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  useEffect(() => {
    if (resetWorkspaceKeyRef.current === workspaceKey) return;
    resetWorkspaceKeyRef.current = workspaceKey;
    requestIdRef.current++;
    inflightRef.current = null;
    autoFetchByRepoRef.current.clear();
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
  }, [workspaceKey]);

  const applyStatus = useCallback(
    (updater: (status: GitStatusSnapshot) => GitStatusSnapshot) => {
      setState((current) => {
        if (!current.status) return current;
        const next = updater(current.status);
        if (next === current.status) return current;
        return { ...current, status: next };
      });
    },
    [],
  );

  const doRefresh = useCallback(
    async (remoteMode: SourceControlRefreshMode): Promise<void> => {
      const refreshContextKey = contextKey;
      if (
        !enabledRef.current ||
        refreshContextKey !== contextKeyRef.current
      ) {
        return;
      }
      const requestId = ++requestIdRef.current;
      const isCurrentRequest = () =>
        requestId === requestIdRef.current &&
        refreshContextKey === contextKeyRef.current;

      if (!contextPath) {
        if (!isCurrentRequest()) return;
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

      const activeRoot = stateRef.current.repo?.repoRoot ?? null;
      const reusableRoot = repositoryContainsContext(activeRoot, contextPath)
        ? activeRoot
        : null;

      setState((current) =>
        beginSourceControlRefresh(current, contextPath, !!reusableRoot),
      );

      try {
        let repo: GitRepoInfo | null;
        let status: GitStatusSnapshot | null;

        if (reusableRoot) {
          try {
            repo = stateRef.current.repo ?? null;
            status = await native.gitStatus(reusableRoot);
            if (!isCurrentRequest()) return;
            if (!repo || repo.repoRoot !== reusableRoot) {
              repo = {
                repoRoot: reusableRoot,
                branch: status.branch,
                upstream: status.upstream,
                isDetached: status.isDetached,
              };
            }
          } catch {
            const snapshot = await native.gitPanelSnapshot(contextPath);
            if (!isCurrentRequest()) return;
            if (!snapshot.repo) {
              setState((current) => ({
                ...current,
                repo: null,
                status: null,
                hasRepo: false,
                isLoading: false,
                localError: null,
              }));
              return;
            }
            repo = snapshot.repo;
            status = snapshot.status ?? null;
          }
        } else {
          const snapshot = await native.gitPanelSnapshot(contextPath);
          if (!isCurrentRequest()) return;
          if (!snapshot.repo) {
            setState((current) => ({
              ...current,
              repo: null,
              status: null,
              hasRepo: false,
              isLoading: false,
              localError: null,
            }));
            return;
          }
          repo = snapshot.repo;
          status = snapshot.status ?? null;
        }

        if (!repo) {
          setState((current) => ({
            ...current,
            repo: null,
            status: null,
            hasRepo: false,
            isLoading: false,
            localError: null,
          }));
          return;
        }

        let nextRemoteError = stateRef.current.lastRemoteError;
        const shouldAutoFetch =
          repo.upstream &&
          remoteMode !== "never" &&
          (remoteMode === "always" ||
            Date.now() -
              (autoFetchByRepoRef.current.get(repo.repoRoot) ?? 0) >=
              AUTO_FETCH_THROTTLE_MS);

        if (shouldAutoFetch) {
          try {
            await native.gitFetch(repo.repoRoot);
            touchAutoFetch(autoFetchByRepoRef.current, repo.repoRoot);
            nextRemoteError = null;
            if (!isCurrentRequest()) return;
            status = await native.gitStatus(repo.repoRoot);
            if (!isCurrentRequest()) return;
          } catch (error) {
            nextRemoteError = normalizeError(error);
          }
        }

        if (!isCurrentRequest()) return;
        setState((current) => ({
          ...current,
          repo,
          status,
          hasRepo: true,
          isLoading: false,
          localError: null,
          dubiousOwnershipPath: null,
          lastRemoteError: nextRemoteError,
        }));
      } catch (error) {
        if (!isCurrentRequest()) return;
        const normalized = normalizeError(error);
        const dubiousPath = extractDubiousOwnershipPath(error, contextPath);
        setState((current) => ({
          ...current,
          repo: null,
          hasRepo: false,
          status: null,
          isLoading: false,
          localError: normalized,
          dubiousOwnershipPath: dubiousPath,
        }));
      } finally {
        if (isCurrentRequest()) {
          lastRefreshAtRef.current = Date.now();
        }
      }
    },
    [contextKey, contextPath],
  );

  const refresh = useCallback(
    async (options?: { remote?: SourceControlRefreshMode }) => {
      const remoteMode = options?.remote ?? "never";
      const inflight = inflightRef.current;
      if (inflight?.contextKey === contextKey) {
        const cur = inflight.mode;
        const upgrade =
          (cur === "never" && remoteMode !== "never") ||
          (cur === "auto" && remoteMode === "always");
        if (!upgrade) return inflight.promise;
      }
      const run = doRefresh(remoteMode).finally(() => {
        if (inflightRef.current?.promise === run) {
          inflightRef.current = null;
        }
      });
      inflightRef.current = { contextKey, mode: remoteMode, promise: run };
      return run;
    },
    [contextKey, doRefresh],
  );

  const trustRepository = useCallback(
    async (targetPath?: string) => {
      const pathToTrust =
        targetPath ??
        stateRef.current.dubiousOwnershipPath ??
        contextPath;
      if (!pathToTrust) return;
      const trustedContextKey = contextKey;
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

      // Trusting the repository is complete once git config succeeds. On slow
      // network shares, status enumeration can take seconds; keep it detached
      // from the button so the rest of Voktty remains immediately usable.
      void native
        .gitStatus(pathToTrust, workspaceEnv)
        .then((status) => {
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
        })
        .catch((error) => {
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
        });
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

  useEffect(() => {
    const onGitRefresh = () => {
      void doRefresh("never");
    };
    window.addEventListener("voktty:git-refresh", onGitRefresh);
    return () => window.removeEventListener("voktty:git-refresh", onGitRefresh);
  }, [doRefresh]);

  const runRemoteAction = useCallback(
    async (
      mode: SourceControlRemoteActionMode = "contextual",
    ): Promise<SourceControlRemoteActionResult> => {
      const { repo, status } = stateRef.current;
      if (!repo || !status) {
        return { ok: false, action: null, blocked: "no-repo" };
      }
      if (!status.upstream) {
        return { ok: false, action: null, blocked: "missing-upstream" };
      }

      const action = mode === "contextual" ? getContextualAction(status) : mode;
      if (!action) {
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
      runRemoteAction,
    }),
    [state, applyStatus, refresh, trustRepository, initRepository, runRemoteAction],
  );
}
