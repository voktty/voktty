import { appendReadyHandoff, buildDeterministicHandoff } from "./handoff";
import { pathKey } from "./paths";
import { isBlankSession } from "./projectReturn";
import { newSession, sessionWorkCwd, type Session } from "./session";
import type { Worktree } from "./worktrees";

/** Existing working copies stay bound; removed ones can be replaced in place. */
export function sessionInWorktree(session: Session, tree: Worktree): Session {
  if (
    !session.worktreeRemoved &&
    pathKey(sessionWorkCwd(session)) === pathKey(tree.path)
  ) {
    return session;
  }
  const target =
    session.worktreeRemoved && !isBlankSession(session)
      ? appendReadyHandoff(
          session,
          session.harness,
          session.harness,
          `The previous working copy was deleted. Continue this conversation in ${tree.path}. Recheck the files before making changes.\n\n${buildDeterministicHandoff(session)}`,
        )
      : isBlankSession(session)
        ? session
        : {
            ...newSession(
              session.harness,
              session.cwd,
              session.model,
              session.runtimeMode,
              session.modelSettings,
            ),
            providerAccountId: session.providerAccountId,
          };
  return {
    ...target,
    worktreeRemoved: undefined,
    worktreeCwd:
      pathKey(tree.path) === pathKey(session.cwd) ? undefined : tree.path,
    branch: tree.branch ?? undefined,
    providerSessionId: undefined,
    context: undefined,
    pendingSwitch: undefined,
  };
}
