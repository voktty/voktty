import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { displayAgent } from "@/modules/agents/lib/format";
import { useAgentStore } from "@/modules/agents/store/agentStore";
import { t } from "@/modules/i18n";
import { useKanbanStore } from "@/modules/notes-board/store/kanbanStore";
import type { Tab } from "@/modules/tabs/lib/useTabs";
import { hasLeaf } from "@/modules/terminal/lib/panes";
import { captureTerminalSubmissionTarget } from "@/modules/terminal/lib/useTerminalSession";

function targetIdentity(tab: Tab): string | null {
  if (
    tab.kind !== "terminal" ||
    tab.collaboration ||
    !hasLeaf(tab.paneTree, tab.activeLeafId)
  )
    return null;
  return JSON.stringify([
    tab.tabKey,
    tab.spaceId,
    tab.workspaceScopeId,
    tab.activeLeafId,
    tab.cwd,
    tab.projectCwd,
    tab.workspaceEnv ?? { kind: "local" },
  ]);
}

type TargetReceipt = { identity: string; current: boolean };

export function useKanbanCardDrop(
  tabs: Tab[],
  activate: (tabId: number, leafId: number) => void,
) {
  const registry = useRef(new Map<number, TargetReceipt>());
  const inputs = useRef(new WeakMap<Tab, TargetReceipt>());
  const publication = useMemo(() => ({ activate }), [activate]);
  const owner = useRef<typeof publication | null>(null);
  useLayoutEffect(() => {
    owner.current = publication;
    return () => {
      if (owner.current === publication) owner.current = null;
    };
  }, [publication]);
  useLayoutEffect(
    () => () => {
      for (const receipt of registry.current.values()) receipt.current = false;
      registry.current.clear();
    },
    [],
  );
  useLayoutEffect(() => {
    const next = new Map<number, TargetReceipt>();
    for (const tab of tabs) {
      const identity = targetIdentity(tab);
      if (!identity) continue;
      const previous = registry.current.get(tab.id);
      const receipt =
        previous?.current && previous.identity === identity
          ? previous
          : { identity, current: true };
      next.set(tab.id, receipt);
      inputs.current.set(tab, receipt);
    }
    for (const [id, receipt] of registry.current) {
      if (next.get(id) !== receipt) receipt.current = false;
    }
    registry.current = next;
  }, [tabs]);
  return useCallback(
    (tab: Tab, cardId: string, prompt: string): boolean => {
      if (
        owner.current !== publication ||
        tab.kind !== "terminal" ||
        !cardId ||
        cardId.length > 256 ||
        prompt.length > 1024 * 1024 ||
        !prompt.trim() ||
        prompt.includes("\0")
      )
        return false;
      const receipt = inputs.current.get(tab);
      const card = useKanbanStore
        .getState()
        .cards.find((candidate) => candidate.id === cardId);
      const targetCurrent = () =>
        owner.current === publication &&
        receipt?.current === true &&
        registry.current.get(tab.id) === receipt &&
        targetIdentity(tab) === receipt.identity;
      const cardCurrent = () =>
        useKanbanStore
          .getState()
          .cards.find((candidate) => candidate.id === cardId) === card;
      if (!card || !targetCurrent()) return false;
      const leafId = tab.activeLeafId;
      const submission = captureTerminalSubmissionTarget(leafId);
      if (!submission) return false;
      const agent = useAgentStore.getState().sessions[leafId];
      const execution = {
        leafId,
        tabId: tab.id,
        agentName: agent?.agent
          ? displayAgent(agent.agent)
          : t("statusbar.terminal"),
        startedAt: Date.now(),
        lastObservedStatus: agent?.status ?? ("working" as const),
      };
      if (
        !submission.run(prompt, () => targetCurrent() && cardCurrent()) ||
        !targetCurrent() ||
        !cardCurrent() ||
        !submission.isAvailable()
      )
        return false;
      useKanbanStore.getState().assignCardToAgent(cardId, execution);
      if (
        targetCurrent() &&
        submission.isAvailable() &&
        useKanbanStore
          .getState()
          .cards.find((candidate) => candidate.id === cardId)
          ?.assignedExecution === execution
      )
        publication.activate(tab.id, leafId);
      return true;
    },
    [publication],
  );
}
