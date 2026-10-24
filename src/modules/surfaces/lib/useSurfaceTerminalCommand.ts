import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import type { Tab } from "@/modules/tabs/lib/useTabs";
import { findLeafCwd } from "@/modules/terminal/lib/panes";
import {
  scrollLeafToBottom,
  useTerminalInputTarget,
} from "@/modules/terminal/lib/useTerminalSession";

export function useSurfaceTerminalCommand(source: Tab | undefined) {
  const leaf =
    source?.kind === "terminal"
      ? source.activeLeafId
      : source?.kind === "harness"
        ? undefined
        : null;
  const target = useTerminalInputTarget(leaf);
  const sourceId = source?.id;
  const sourceKey = source?.tabKey;
  const sourceSpace = source?.spaceId;
  const sourceKind = source?.kind;
  const sourceDirectory =
    source?.kind === "terminal"
      ? (findLeafCwd(source.paneTree, source.activeLeafId) ?? source.cwd)
      : source?.kind === "harness"
        ? source.cwd
        : undefined;
  const binding = useMemo(
    () => ({
      sourceId,
      sourceKey,
      sourceSpace,
      sourceKind,
      sourceDirectory,
      target,
    }),
    [sourceId, sourceKey, sourceSpace, sourceKind, sourceDirectory, target],
  );
  const owner = useRef<object | null>(null);
  useLayoutEffect(() => {
    owner.current = binding;
    return () => {
      if (owner.current === binding) owner.current = null;
    };
  }, [binding]);
  const run = useCallback(
    (command: string) => {
      if (owner.current !== binding || !target?.run(command)) return false;
      if (target.isAvailable()) scrollLeafToBottom(target.leafId);
      return true;
    },
    [binding, target],
  );
  return {
    run,
    disabledReason: target ? undefined : "editor.terminalNoActive",
  };
}
