import type { Session } from "@/modules/harness/lib/session";

export function sameHarnessPreparationContext(a: Session, b: Session): boolean {
  return (
    a.cwd === b.cwd &&
    (a.worktreeCwd || a.cwd) === (b.worktreeCwd || b.cwd) &&
    a.harness === b.harness &&
    a.runtimeMode === b.runtimeMode &&
    a.providerAccountId === b.providerAccountId
  );
}

export class HarnessProjectReservedError extends Error {
  constructor() {
    super("Harness project is reserved");
  }
}

export type HarnessSessionDelta =
  | { kind: "admit"; session: Session }
  | {
      kind: "remove";
      id: string;
      expected?: Session;
      shouldRemove?: (session: Session) => boolean;
    }
  | {
      kind: "update";
      id: string;
      update: (session: Session) => Session;
      expected?: Session;
    };

export function applyHarnessSessionDeltas(
  sessions: Session[],
  deltas: readonly HarnessSessionDelta[],
  isProjectReserved: (path: string) => boolean = () => false,
): Session[] {
  let result = sessions;
  for (const delta of deltas) {
    if (delta.kind === "admit") {
      if (!result.some((session) => session.id === delta.session.id)) {
        if (isProjectReserved(delta.session.cwd))
          throw new HarnessProjectReservedError();
        result = [...result, delta.session];
      }
      continue;
    }
    const index = result.findIndex((session) => session.id === delta.id);
    if (index < 0) continue;
    const current = result[index];
    if (delta.expected && current !== delta.expected) continue;
    if (delta.kind === "remove") {
      if (delta.shouldRemove && !delta.shouldRemove(current)) continue;
      result = result.filter((session) => session !== current);
      continue;
    }
    const next = delta.update(current);
    if (next.id !== current.id)
      throw new Error(
        "Harness session identity cannot change during an update.",
      );
    if (next === current) continue;
    if (
      next.cwd !== current.cwd &&
      (isProjectReserved(current.cwd) || isProjectReserved(next.cwd))
    )
      throw new HarnessProjectReservedError();
    result = result.slice();
    result[index] = next;
  }
  return result;
}

export function harnessSessionDeltas(
  before: readonly Session[],
  after: readonly Session[],
  affectedIds: Iterable<string>,
): HarnessSessionDelta[] {
  const deltas: HarnessSessionDelta[] = [];
  for (const id of new Set(affectedIds)) {
    const previous = before.find((session) => session.id === id);
    const next = after.find((session) => session.id === id);
    if (previous === next) continue;
    if (!next) deltas.push({ kind: "remove", id, expected: previous });
    else if (!previous) deltas.push({ kind: "admit", session: next });
    else
      deltas.push({
        kind: "update",
        id,
        expected: previous,
        update: () => next,
      });
  }
  return deltas;
}
