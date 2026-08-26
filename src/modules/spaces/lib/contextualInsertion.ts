import type { ViewSpace, ViewSpaceId } from "./spaceLayout";
import type { ActiveStripItem } from "./spaceProjection";

export type ContextualSpaceInsertionPlan =
  | { kind: "standalone" }
  | { kind: "append"; viewSpaceId: ViewSpaceId };

export function planContextualSpaceInsertion(
  spaces: readonly ViewSpace[],
  activeStripItem: ActiveStripItem | null,
): ContextualSpaceInsertionPlan {
  if (activeStripItem?.kind !== "space") return { kind: "standalone" };
  const space = spaces.find(
    (candidate) =>
      candidate.id === activeStripItem.spaceId &&
      !candidate.deleted &&
      candidate.presentation === "composite",
  );
  if (!space) return { kind: "standalone" };
  if (space.memberOrder.length >= 4) {
    return { kind: "standalone" };
  }
  return { kind: "append", viewSpaceId: space.id };
}
