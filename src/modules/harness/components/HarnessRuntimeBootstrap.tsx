import { useState, type ComponentProps, type ComponentType } from "react";
import type { HarnessWindowHost } from "@/modules/harness/components/HarnessWindowHost";
import { HarnessRestoreContext, type HarnessRestoredView } from "@/modules/harness/hooks/harnessRestoreContext";
import { loadBootWorkspace, type BootWorkspace } from "@/modules/harness/lib/appLifecycle";
import { collectWorkspaceSnapshot, hydrateWorkspaceSnapshot } from "@/modules/harness/lib/workspaceSnapshot";
import type { ResumedWorkspace } from "@/modules/harness/lib/inFlight";

type Props = ComponentProps<typeof HarnessWindowHost>;

function restoreViews(boot: BootWorkspace, props: Props) {
  const views = new Map<string, HarnessRestoredView>();
  const initialViews: NonNullable<Props["initialViews"]> = [];
  const owners = props.viewIdentities ?? [];
  const sessions = boot.windowTransfer?.sessions ?? boot.resumed?.sessions ?? [];
  const loaded = new Map(sessions.map((session) => [session.id, session]));
  const retained = boot.windowSnapshot?.views ?? (boot.resumed ? [{
    tabKey: owners.find((owner) => owner.ownerId === props.initialOwnerId)?.tabKey ?? owners[0]?.tabKey ?? null,
    workspace: collectWorkspaceSnapshot(boot.resumed.tabs, boot.resumed.sessions,
      boot.resumed.activeTabId, boot.resumed.projectCwd,
      boot.resumed.projectReturnMemory ?? new Map(), boot.resumed.projectTerminals ?? []),
  }] : []);
  for (const [index, entry] of retained.entries()) {
    const workspace = hydrateWorkspaceSnapshot(entry.workspace, loaded, new Set(), true);
    if (!workspace) throw new Error("Harness view could not be restored.");
    const owner = owners.find((owner) => owner.tabKey === entry.tabKey);
    initialViews.push({ ownerId: owner?.ownerId ?? Number.MAX_SAFE_INTEGER - index, tabKey: entry.tabKey, workspace });
    if (owner && entry.tabKey) views.set(entry.tabKey, { resumed: workspace });
  }
  if (boot.windowTransfer) {
    const owner = owners.find((owner) => owner.ownerId === props.initialOwnerId) ?? owners[0];
    const transfer = boot.windowTransfer;
    const workspace: ResumedWorkspace = {
      ...transfer, projectReturnMemory: new Map(),
    };
    initialViews.push({ ownerId: owner?.ownerId ?? Number.MAX_SAFE_INTEGER, workspace });
    if (owner) views.set(owner.tabKey, { windowTransfer: transfer });
  }
  return { views, initialViews, sessions, claimed: new Set<string>() };
}

export async function loadHarnessRuntime(Host: ComponentType<Props>) {
  const boot = await loadBootWorkspace();
  return {
    default: function RestoredHarnessRuntime(props: Props) {
      const [restored] = useState(() => restoreViews(boot, props));
      return <HarnessRestoreContext value={restored}>
        <Host {...props} initialSessions={() => restored.sessions} initialViews={restored.initialViews} />
      </HarnessRestoreContext>;
    },
  };
}
