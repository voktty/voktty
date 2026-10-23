import {
  createContext,
  useCallback,
  useLayoutEffect,
  useRef,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { FilePaneTab, WorkspaceTab } from "@/modules/harness/lib/layout";
import type { ProjectTerminalDock } from "@/modules/harness/lib/projectTerminal";
import type { PersistencePermit } from "@/modules/harness/lib/persistenceAdmission";
import type { useHarnessTerminalCreation } from "@/modules/harness/hooks/useHarnessTerminalCreation";
import { useCanonicalTerminalCatalog } from "@/modules/terminal/CanonicalTerminalCatalog";
import {
  terminalRecoveryTarget,
  replaceRecoveredTerminalTabs,
  replaceRecoveredTerminalDocks,
  type TerminalRecoveryState,
} from "@/modules/harness/lib/canonicalTerminalRecovery";

type Recover = (
  file: FilePaneTab,
  slotKey: string,
  isCurrent: () => boolean,
  onSettled: () => void,
) => boolean;
export const HarnessTerminalRecovery = createContext<Recover | null>(null);

export function useHarnessTerminalRecovery(
  props: TerminalRecoveryState & {
    enabled: boolean;
    capture: () => PersistencePermit | undefined;
    open: ReturnType<typeof useHarnessTerminalCreation>["open"];
    setTabs: Dispatch<SetStateAction<WorkspaceTab[]>>;
    setDocks: Dispatch<SetStateAction<ProjectTerminalDock[]>>;
  },
) {
  const catalog = useCanonicalTerminalCatalog();
  const latest = useRef({ ...props, catalog });
  const lifetime = useRef<object | null>(null);
  useLayoutEffect(() => {
    latest.current = { ...props, catalog };
  });
  useLayoutEffect(() => {
    const current = { projectCwd: props.projectCwd, enabled: props.enabled };
    lifetime.current = current;
    return () => {
      if (lifetime.current === current) lifetime.current = null;
    };
  }, [props.projectCwd, props.enabled]);
  return useCallback<Recover>((file, slotKey, requestCurrent, onSettled) => {
    const captured = latest.current;
    const original = lifetime.current;
    const target = terminalRecoveryTarget(captured, file.id, slotKey);
    const permit = captured.capture();
    const reference = file.canonicalTerminal;
    if (
      !captured.enabled ||
      !original ||
      !permit?.isCurrent() ||
      !target ||
      !reference ||
      target.file !== file ||
      !captured.catalog ||
      captured.catalog.get(reference)
    )
      return false;
    let replacement: FilePaneTab | undefined;
    let submitted = false;
    const currentTarget = () => {
      const current = terminalRecoveryTarget(latest.current, file.id, slotKey);
      return current?.tabId === target.tabId &&
        current?.paneId === target.paneId &&
        current?.dockProject === target.dockProject
        ? current
        : undefined;
    };
    const baseCurrent = () =>
      lifetime.current === original &&
      permit.isCurrent() &&
      latest.current.enabled;
    const originalCurrent = () =>
      baseCurrent() &&
      requestCurrent() &&
      currentTarget()?.file === file &&
      !latest.current.catalog?.get(reference);
    return captured.open({
      cwd: file.cwd,
      slotKey,
      isCurrent: () =>
        submitted
          ? baseCurrent() && currentTarget()?.file === replacement
          : originalCurrent(),
      onCreated: ({ tabKey }) => {
        if (!originalCurrent())
          throw new Error("Terminal recovery was retired.");
        replacement = {
          ...file,
          foreground: undefined,
          canonicalTerminal: { tabKey, projectCwd: captured.projectCwd },
        };
        const successor = replacement;
        captured.setTabs((tabs) =>
          originalCurrent()
            ? replaceRecoveredTerminalTabs(tabs, target, successor)
            : tabs,
        );
        captured.setDocks((docks) =>
          originalCurrent()
            ? replaceRecoveredTerminalDocks(docks, target, successor)
            : docks,
        );
        submitted = true;
      },
      onSettled,
    });
  }, []);
}
