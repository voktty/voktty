import { useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { useAgentStore } from "@/modules/agents/store/agentStore";
import {
  captureTerminalSubmissionTarget,
  subscribeTerminalInputTargets,
  type TerminalSubmissionTarget,
} from "@/modules/terminal/lib/useTerminalSession";
import {
  resolveActiveAgentTargets,
  type ActiveAgentTarget,
  type TabSummary,
} from "./agentHandoff";

export type AgentHandoffTarget = ActiveAgentTarget & {
  submission: TerminalSubmissionTarget | null;
  run: (text: string) => boolean;
};

const EMPTY_TARGETS: AgentHandoffTarget[] = [];

export function useAgentHandoffTargets(
  tabs?: TabSummary[],
): AgentHandoffTarget[] {
  const sessions = useAgentStore((state) => state.sessions);
  const metadata = useMemo(
    () => resolveActiveAgentTargets(sessions, tabs),
    [sessions, tabs],
  );
  const owner = useRef<typeof metadata | null>(null);
  useLayoutEffect(() => {
    owner.current = metadata;
    return () => {
      if (owner.current === metadata) owner.current = null;
    };
  }, [metadata]);
  const getSnapshot = useMemo(() => {
    let previous: AgentHandoffTarget[] = [];
    return () => {
      let changed = previous.length !== metadata.length;
      const next = metadata.map((target, index) => {
        const old = previous[index];
        const submission = old?.submission?.isAvailable()
          ? old.submission
          : captureTerminalSubmissionTarget(target.leafId);
        if (old && old.submission === submission) return old;
        changed = true;
        return {
          ...target,
          submission,
          run: (text: string) =>
            owner.current === metadata && (submission?.run(text) ?? false),
        };
      });
      if (changed) previous = next;
      return previous;
    };
  }, [metadata]);
  return useSyncExternalStore(
    subscribeTerminalInputTargets,
    getSnapshot,
    () => EMPTY_TARGETS,
  );
}
