import { useEffect, useRef, useState } from "react";
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

function seenEntries(items: readonly InboxItem[]): InboxSeenEntry[] {
  return items.map((item) => ({
    key: inboxItemKey(item),
    updatedAt: item.updatedAt,
  }));
}

export function useInboxUnseen(recents: RecentProject[], cwd: string): boolean {
  const [unseen, setUnseen] = useState(false);
  const entriesRef = useRef<InboxSeenEntry[]>([]);
  const fetchedRef = useRef(false);

  useEffect(() => {
    return subscribeInboxSeen(() => {
      setUnseen(inboxHasUnseenItems(entriesRef.current));
    });
  }, []);

  useEffect(() => {
    if (fetchedRef.current) return;
    const projects = inboxProjectsForRail(recents, cwd);
    if (projects.length === 0) return;
    let cancelled = false;

    const projectPaths = projects.map((project) => project.path);
    const filters = pruneInboxFilters(loadInboxFilters(), projectPaths);
    const query: InboxQuery = {
      assignedToMe: filters.assignedToMe,
      state: inboxFetchState(filters),
      search: "",
      linearHiddenTeamIds: loadHiddenLinearTeamIds(),
    };

    void listInboxItems(projects, query)
      .then((listed) => {
        if (cancelled) return;
        fetchedRef.current = true;
        const visible = applyInboxFilters(listed.items, filters, "");
        const entries = seenEntries(visible);
        entriesRef.current = entries;
        seedInboxSeenIfNeeded(entries);
        setUnseen(inboxHasUnseenItems(entries));
      })
      .catch(() => {
        // Leave fetchedRef unset so a later mount can try again.
      });

    return () => {
      cancelled = true;
    };
  }, [cwd, recents]);

  return unseen;
}
