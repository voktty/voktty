import { useCallback, useEffect, useRef, useState } from "react";
import {
  inboxItemKey,
  inboxProjectsForRail,
  listInboxItems,
  type InboxItem,
  type InboxQuery,
} from "../lib/githubTasks";
import {
  applyInboxFilters,
  inboxFetchState,
  loadInboxFilters,
  pruneInboxFilters,
} from "../lib/inboxFilters";
import {
  inboxHasUnseenItems,
  seedInboxSeenIfNeeded,
  subscribeInboxSeen,
  type InboxSeenEntry,
} from "../lib/inboxSeen";
import { loadHiddenLinearTeamIds } from "../lib/linear";
import type { RecentProject } from "../lib/recents";
import { noteInboxUnseen } from "../lib/sounds";

const POLL_MS = 2 * 60_000;
const HIDDEN_POLL_MS = 5 * 60_000;
const POLL_TICK_MS = 30_000;

function seenEntries(items: readonly InboxItem[]): InboxSeenEntry[] {
  return items.map((item) => ({
    key: inboxItemKey(item),
    updatedAt: item.updatedAt,
  }));
}

export function useInboxUnseen(
  recents: RecentProject[],
  cwd: string,
  options?: { onAppeared?: (items: InboxItem[]) => void },
): boolean {
  const [unseen, setUnseen] = useState(false);
  const entriesRef = useRef<InboxSeenEntry[]>([]);
  const onAppearedRef = useRef(options?.onAppeared);
  const lastPulledAt = useRef<number | null>(null);
  onAppearedRef.current = options?.onAppeared;

  const applyUnseen = useCallback((next: boolean) => {
    noteInboxUnseen(next);
    setUnseen(next);
  }, []);

  useEffect(() => {
    return subscribeInboxSeen(() => {
      applyUnseen(inboxHasUnseenItems(entriesRef.current));
    });
  }, [applyUnseen]);

  useEffect(() => {
    const projects = inboxProjectsForRail(recents, cwd);
    if (projects.length === 0) {
      entriesRef.current = [];
      applyUnseen(false);
      return;
    }

    let cancelled = false;
    let pulling = false;

    const pull = (force: boolean) => {
      if (pulling) return;
      pulling = true;
      lastPulledAt.current = Date.now();
      const projectPaths = projects.map((project) => project.path);
      const filters = pruneInboxFilters(loadInboxFilters(), projectPaths);
      const query: InboxQuery = {
        assignedToMe: filters.assignedToMe,
        state: inboxFetchState(filters),
        search: "",
        linearHiddenTeamIds: loadHiddenLinearTeamIds(),
      };
      void listInboxItems(projects, query, { force })
        .then((listed) => {
          if (cancelled) return;
          const visible = applyInboxFilters(listed.items, filters, "");
          onAppearedRef.current?.(listed.items);
          const entries = seenEntries(visible);
          entriesRef.current = entries;
          seedInboxSeenIfNeeded(entries);
          applyUnseen(inboxHasUnseenItems(entries));
        })
        .catch(() => {
          // Leave the last known badge; a later poll can try again.
        })
        .finally(() => {
          pulling = false;
        });
    };

    pull(false);
    const poll = () => {
      if (pulling) return;
      const interval = document.hidden ? HIDDEN_POLL_MS : POLL_MS;
      if (
        lastPulledAt.current != null &&
        Date.now() - lastPulledAt.current < interval
      ) {
        return;
      }
      pull(true);
    };
    // Keep the tray badge fresh without letting background activity drive a
    // request every few seconds or on every visibility transition.
    const timer = window.setInterval(poll, POLL_TICK_MS);
    const onVis = () => {
      if (!document.hidden) poll();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [applyUnseen, cwd, recents]);

  return unseen;
}
