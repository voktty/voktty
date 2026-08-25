import type { Session } from "./session";

export type InboxItemKind = "approval" | "done";

export type InboxItem = {
  session: Session;
  kind: InboxItemKind;
};

/** Sessions that belong in the inbox: pending approvals and unseen finished work. */
export function inboxItems(
  sessions: Session[],
  approvalIds: ReadonlySet<string>,
  doneIds: ReadonlySet<string>,
): InboxItem[] {
  const items: InboxItem[] = [];
  for (const session of sessions) {
    if (approvalIds.has(session.id)) {
      items.push({ session, kind: "approval" });
      continue;
    }
    if (doneIds.has(session.id)) {
      items.push({ session, kind: "done" });
    }
  }
  return items.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "approval" ? -1 : 1;
    return sessionSortKey(b.session) - sessionSortKey(a.session);
  });
}

export function inboxNotificationCount(
  approvalIds: ReadonlySet<string>,
  doneIds: ReadonlySet<string>,
): number {
  const seen = new Set<string>();
  for (const id of approvalIds) seen.add(id);
  for (const id of doneIds) seen.add(id);
  return seen.size;
}

function sessionSortKey(session: Session): number {
  for (let i = session.blocks.length - 1; i >= 0; i--) {
    const block = session.blocks[i];
    if (block.startedAt) return block.startedAt;
  }
  return 0;
}
