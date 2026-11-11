import { useEffect, useMemo, useRef, useState } from "react";
import { buildTimeline, emptyFeed, type FeedState, mergeFeed, type Timeline } from "./feedModel";
import { FeedSourceError, type FeedTarget, pollFeed } from "./feedSource";
import type { FeedCursor, FeedScope } from "./types";

export const FEED_POLL_MS = 3000;

export type FeedStatus =
  | { kind: "loading" }
  | { kind: "live" }
  | { kind: "unavailable" }
  | { kind: "error"; reason: FeedSourceError["reason"]; message: string };

function targetKey(target: FeedTarget): string {
  return target.kind === "ssh"
    ? `ssh:${target.env.connection.id}:${target.root ?? ""}`
    : `local:${target.root ?? ""}`;
}

/**
 * Polls the agent feed while mounted. The cursor lives here, so a dropped
 * connection resumes where it stopped and a reopened panel rebuilds the
 * chosen range from the transcripts. Nothing is stored on disk.
 */
export function useAgentFeed(target: FeedTarget, scope: FeedScope, rangeMs: number) {
  const key = `${targetKey(target)}|${scope}|${rangeMs}`;
  const [feed, setFeed] = useState<FeedState>(emptyFeed);
  const [status, setStatus] = useState<FeedStatus>({ kind: "loading" });
  const targetRef = useRef(target);
  targetRef.current = target;

  // biome-ignore lint/correctness/useExhaustiveDependencies: the key captures the target identity and the range; the target object itself changes on every render.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cursor: FeedCursor | null = null;
    const sinceMs = Date.now() - rangeMs;
    setFeed(emptyFeed());
    setStatus({ kind: "loading" });

    const tick = async () => {
      let again = FEED_POLL_MS;
      try {
        const root = scope === "project" ? (targetRef.current.root ?? "") : "";
        const response = await pollFeed(targetRef.current, { root, scope, sinceMs, cursor });
        if (cancelled) return;
        if (!response.available) {
          setStatus({ kind: "unavailable" });
        } else {
          cursor = response.cursor;
          setFeed((previous) => mergeFeed(previous, response));
          setStatus({ kind: "live" });
          if (response.truncated) again = 0;
        }
      } catch (error) {
        if (cancelled) return;
        const reason = error instanceof FeedSourceError ? error.reason : "failed";
        setStatus({ kind: "error", reason, message: String(error instanceof Error ? error.message : error) });
        again = FEED_POLL_MS * 2;
      }
      if (!cancelled) timer = setTimeout(() => void tick(), again);
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [key]);

  const timeline: Timeline = useMemo(() => buildTimeline(feed), [feed]);
  return {
    timeline,
    status,
    unrecognized: feed.unrecognized,
    key: `${targetKey(target)}|${scope}`,
  };
}
