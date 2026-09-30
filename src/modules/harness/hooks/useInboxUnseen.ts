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

const POLL_MS = 30_000;

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

    const pull = (force: boolean) => {
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
        });
    };

    pull(false);
    // Keep polling while minimized or closed-to-tray: the webview is still
    // alive, and GitHub/GitLab automation triggers ride this same refresh.
    const timer = window.setInterval(() => pull(true), POLL_MS);
    const onVis = () => {
      if (!document.hidden) pull(true);
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
