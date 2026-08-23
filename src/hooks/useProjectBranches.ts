import { useCallback, useSyncExternalStore } from "react";
import { gitBranches, subscribeGitChanged, type GitBranches } from "../lib/fs";

type Entry = {
  cwd: string;
  branches: GitBranches | null;
  listeners: Set<() => void>;
  inFlight: boolean;
  unsubscribeGit: (() => void) | null;
  onResume: (() => void) | null;
};

const entries = new Map<string, Entry>();

function branchesEqual(a: GitBranches | null, b: GitBranches | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (
    a.current !== b.current ||
    a.detached !== b.detached ||
    a.branches.length !== b.branches.length
  ) {
    return false;
  }
  return a.branches.every((branch, index) => {
    const other = b.branches[index];
    return (
      other != null &&
      branch.name === other.name &&
      branch.current === other.current &&
      branch.remote === other.remote
    );
  });
}

function entryFor(cwd: string): Entry {
  const existing = entries.get(cwd);
  if (existing) return existing;
  const entry: Entry = {
    cwd,
    branches: null,
    listeners: new Set(),
    inFlight: false,
    unsubscribeGit: null,
    onResume: null,
  };
  entries.set(cwd, entry);
  return entry;
}

function publish(entry: Entry, branches: GitBranches | null) {
  if (branchesEqual(entry.branches, branches)) return;
  entry.branches = branches;
  for (const listener of entry.listeners) listener();
}

async function load(entry: Entry, force = false) {
  if (entry.inFlight || (!force && document.hidden)) return;
  entry.inFlight = true;
  try {
    publish(entry, await gitBranches(entry.cwd));
  } catch {
    publish(entry, null);
  } finally {
    entry.inFlight = false;
  }
}

function start(entry: Entry) {
  if (entry.onResume) return;
  void load(entry, true);
  entry.onResume = () => {
    if (!document.hidden) void load(entry, true);
  };
  window.addEventListener("focus", entry.onResume);
  document.addEventListener("visibilitychange", entry.onResume);
  entry.unsubscribeGit = subscribeGitChanged(entry.onResume);
}

function stop(entry: Entry) {
  if (entry.onResume) {
    window.removeEventListener("focus", entry.onResume);
    document.removeEventListener("visibilitychange", entry.onResume);
  }
  entry.unsubscribeGit?.();
  entry.onResume = null;
  entry.unsubscribeGit = null;
}

export function useProjectBranches(
  cwd: string,
  enabled: boolean,
): GitBranches | null {
  const active = enabled && Boolean(cwd) && cwd !== "~";
  const subscribe = useCallback(
    (listener: () => void) => {
      if (!active) return () => undefined;
      const entry = entryFor(cwd);
      entry.listeners.add(listener);
      if (entry.listeners.size === 1) start(entry);
      return () => {
        entry.listeners.delete(listener);
        if (entry.listeners.size === 0) stop(entry);
      };
    },
    [active, cwd],
  );
  const getSnapshot = useCallback(() => {
    return active ? entryFor(cwd).branches : null;
  }, [active, cwd]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
