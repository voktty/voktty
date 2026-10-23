import type { SessionSummary } from "@/modules/harness/lib/sessionStore";

type Listener = (summary: SessionSummary, isCurrent: () => boolean) => void;
export type HarnessSummarySource = {
  subscribe: (listener: Listener) => () => void;
};

export function createHarnessSummaryUpdates() {
  const entries = new Set<{ listener: Listener }>();
  const source: HarnessSummarySource = {
    subscribe(listener) {
      if (entries.size >= 256)
        throw new RangeError("Harness summary subscriber capacity exceeded");
      const entry = { listener };
      entries.add(entry);
      return () => {
        entries.delete(entry);
      };
    },
  };
  return {
    source,
    publish(summary: SessionSummary, isCurrent: () => boolean) {
      if (!isCurrent() || entries.size === 0) return;
      const owned = Object.freeze({
        id: summary.id,
        cwd: summary.cwd,
        harness: summary.harness,
        model: summary.model,
        runtimeMode: summary.runtimeMode,
        title: summary.title,
        providerSessionId: summary.providerSessionId,
        branch: summary.branch,
        repo: summary.repo,
        additions: summary.additions,
        deletions: summary.deletions,
        createdAt: summary.createdAt,
        updatedAt: summary.updatedAt,
        archived: summary.archived,
        pinned: summary.pinned,
        automationId: summary.automationId,
        linkedWorkItem: summary.linkedWorkItem
          ? Object.freeze({
              kind: summary.linkedWorkItem.kind,
              repo: summary.linkedWorkItem.repo,
              number: summary.linkedWorkItem.number,
              url: summary.linkedWorkItem.url,
            })
          : undefined,
      });
      for (const entry of [...entries]) {
        const current = () => entries.has(entry) && isCurrent();
        if (!current()) continue;
        try {
          entry.listener(owned, current);
        } catch {
          /* Other views must still receive an admitted update. */
        }
      }
    },
  };
}
