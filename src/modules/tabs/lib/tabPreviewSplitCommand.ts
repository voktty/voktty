import type { Tab } from "@/modules/tabs/lib/useTabs";
import type { ViewSpace } from "@/modules/spaces/lib/spaceLayout";
import type { WorkspaceEnv } from "@/modules/workspace";
import { tabDirectoryTarget } from "@/modules/surfaces/lib/tabDirectoryTarget";
import { tabPreviewTarget } from "@/modules/surfaces/lib/tabPreviewTarget";
import { commandSurfaceUnavailableReason } from "@/modules/shortcuts/lib/commandSurface";

export const PREVIEW_SPLIT_COMMAND = "tab.splitPreview";

export function tabPreviewSplitUnavailableReason(
  tab: Tab,
  space: { root: string | null; env: WorkspaceEnv } | undefined,
  viewSpaces: readonly ViewSpace[],
  limit: number,
) {
  const kind =
    tab.kind === "terminal" || tab.kind === "harness"
      ? tab.kind
      : tab.kind === "editor" || tab.kind === "markdown"
        ? "editor"
        : "other";
  if (
    commandSurfaceUnavailableReason(PREVIEW_SPLIT_COMMAND, { kind }) ||
    (tab.kind === "terminal" && tab.collaboration)
  )
    return "editor.status.previewNotSupported" as const;
  if (!tabPreviewTarget(tab, space)) {
    return tabDirectoryTarget(tab, space)
      ? ("workspace.localMachine" as const)
      : ("editor.dialog.noWorkspaceRoot" as const);
  }
  const destination =
    viewSpaces.find(
      (view) => !view.deleted && view.memberOrder.includes(tab.tabKey),
    ) ??
    viewSpaces.find(
      (view) => !view.deleted && view.id === `view-${tab.spaceId}`,
    );
  return (destination?.memberOrder.length ?? 1) >= limit
    ? ("spaces.noFreeSlots" as const)
    : null;
}
