import type { WorkspaceDragSource } from "./workspaceDrag";

export type DroppedResourceStatKind = "file" | "dir" | "symlink";

export function isDroppedResourceStatCompatible(
  source: Extract<WorkspaceDragSource, { kind: "file" | "directory" }>,
  statKind: DroppedResourceStatKind | null,
): boolean {
  if (statKind === null) return false;
  if (source.kind === "directory") return statKind === "dir";
  return statKind === "file" || statKind === "symlink";
}
