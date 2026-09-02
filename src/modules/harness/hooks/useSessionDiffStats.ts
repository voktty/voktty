import { useCallback, useSyncExternalStore } from "react";
import { sessionCheckpointStats, subscribeReviewChanged } from "../lib/checkpoint";
import { subscribeGitChanged, type GitDiffStats } from "../lib/fs";

const EMPTY: Record<string, GitDiffStats> = {};

type Entry = {
  cwd: string;
  ids: string[];
  stats: Record<string, GitDiffStats>;
  listeners: Set<() => void>;
  inFlight: boolean;
  unsubscribeGit: (() => void) | null;
  unsubscribeReview: (() => void) | null;
  onResume: (() => void) | null;
};

const entries = new Map<string, Entry>();

function sameStats(
  a: Record<string, GitDiffStats>,
  b: Record<string, GitDiffStats>,
): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((id) => {
    const left = a[id];
    const right = b[id];
    return (
      left != null &&
      right != null &&
      left.files === right.files &&
      left.additions === right.additions &&
      left.deletions === right.deletions
    );
  });
}

function entryFor(cwd: string): Entry {
  const existing = entries.get(cwd);
  if (existing) return existing;
  const entry: Entry = {
    cwd,
    ids: [],
    stats: EMPTY,
    listeners: new Set(),
    inFlight: false,
    unsubscribeGit: null,
    unsubscribeReview: null,
    onResume: null,
  };
  entries.set(cwd, entry);
  return entry;
}

function publish(entry: Entry, stats: Record<string, GitDiffStats>) {
  if (sameStats(entry.stats, stats)) return;
  entry.stats = stats;
  for (const listener of entry.listeners) listener();
}

async function load(entry: Entry, force = false) {
  if (entry.inFlight || (!force && document.hidden)) return;
  entry.inFlight = true;
  try {
    publish(entry, await sessionCheckpointStats(entry.cwd, entry.ids));
  } catch {
    publish(entry, EMPTY);
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
  entry.unsubscribeReview = subscribeReviewChanged(() => void load(entry, true));
}

function stop(entry: Entry) {
  if (entry.onResume) {
    window.removeEventListener("focus", entry.onResume);
    document.removeEventListener("visibilitychange", entry.onResume);
  }
  entry.unsubscribeGit?.();
  entry.unsubscribeReview?.();
  entry.onResume = null;
  entry.unsubscribeGit = null;
  entry.unsubscribeReview = null;
}

export function useSessionDiffStats(
  cwd: string,
  sessionIds: string[],
  enabled: boolean,
): Record<string, GitDiffStats> {
  const active = enabled && Boolean(cwd) && cwd !== "~" && sessionIds.length > 0;
  const key = sessionIds.join("\0");
  const subscribe = useCallback(
    (listener: () => void) => {
      if (!active) return () => undefined;
      const entry = entryFor(cwd);
      entry.ids = key ? key.split("\0") : [];
      entry.listeners.add(listener);
      if (entry.listeners.size === 1) start(entry);
      else void load(entry, true);
      return () => {
        entry.listeners.delete(listener);
        if (entry.listeners.size === 0) stop(entry);
      };
    },
    [active, cwd, key],
  );
  const getSnapshot = useCallback(() => {
    return active ? entryFor(cwd).stats : EMPTY;
  }, [active, cwd]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
