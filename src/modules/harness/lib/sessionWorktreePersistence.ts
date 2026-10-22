import type { PersistencePermit } from "@/modules/harness/lib/persistenceAdmission";
import { pathKey } from "@/modules/harness/lib/paths";
import type { Session } from "@/modules/harness/lib/session";
import {
  shouldPersistSession,
  upsertSession,
} from "@/modules/harness/lib/sessionStore";
import { sessionInWorktree } from "@/modules/harness/lib/sessionWorktrees";
import { listWorktrees } from "@/modules/harness/lib/worktrees";

export async function moveSessionWorktree({
  session,
  targetPath,
  permit,
  isCurrent,
  commit,
}: {
  session: Session;
  targetPath: string;
  permit: PersistencePermit;
  isCurrent: () => boolean;
  commit: (session: Session) => void;
}): Promise<boolean> {
  const active = () => permit.isCurrent() && isCurrent();
  if (!active()) return false;
  const source = {
    ...session,
    modelSettings: { ...session.modelSettings },
    blocks: [...session.blocks],
  };
  try {
    const listed = await listWorktrees(source.cwd);
    if (!active()) return false;
    const target = listed.worktrees.find(
      (tree) => pathKey(tree.path) === pathKey(targetPath) && !tree.missing,
    );
    if (!target) throw new Error("This worktree is no longer available.");
    const next = sessionInWorktree(source, target);
    if (shouldPersistSession(next)) {
      const admitted = await permit.run(async () => {
        if (active()) await upsertSession(next);
      });
      if (!admitted || !active()) return false;
    }
    if (!active()) return false;
    commit(next);
    return active();
  } catch (error) {
    if (!active()) return false;
    throw error;
  }
}
