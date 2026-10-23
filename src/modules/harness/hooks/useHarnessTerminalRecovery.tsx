import {
  createContext,
  useContext,
  useCallback,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { FilePaneTab, WorkspaceTab } from "@/modules/harness/lib/layout";
import type { ProjectTerminalDock } from "@/modules/harness/lib/projectTerminal";
import type { PersistencePermit } from "@/modules/harness/lib/persistenceAdmission";
import { terminalTabLabel } from "@/modules/harness/lib/terminalTab";
import type { useHarnessTerminalCreation } from "@/modules/harness/hooks/useHarnessTerminalCreation";
import { HarnessTerminalMigrationContext } from "@/modules/harness/hooks/harnessTerminalMigrationContext";
import { HarnessTerminalOwner } from "@/modules/harness/hooks/harnessTerminalContext";
import type { ProjectTerminalReference } from "@/modules/terminal/lib/projectTerminalRequest";
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
const noSubscribe = () => () => {};
const noSnapshot = () => null;

export function useHarnessTerminalRecovery(
  props: TerminalRecoveryState & {
    enabled: boolean;
    capture: () => PersistencePermit | undefined;
    open: ReturnType<typeof useHarnessTerminalCreation>["open"];
    setTabs: Dispatch<SetStateAction<WorkspaceTab[]>>;
    setDocks: Dispatch<SetStateAction<ProjectTerminalDock[]>>;
  },
) {
  const migrations = useContext(HarnessTerminalMigrationContext);
  const owner = useContext(HarnessTerminalOwner);
  const revision = useSyncExternalStore(
    migrations?.views.subscribe ?? noSubscribe,
    migrations?.views.getSnapshot ?? noSnapshot,
  );
  const catalog = useCanonicalTerminalCatalog();
  const latest = useRef({ ...props, catalog, owner });
  const lifetime = useRef<object | null>(null);
  useLayoutEffect(() => {
    latest.current = { ...props, catalog, owner };
  });
  useLayoutEffect(() => {
    const current = {
      projectCwd: props.projectCwd,
      enabled: props.enabled,
      ownerTabKey: owner?.tabKey,
    };
    lifetime.current = current;
    return () => {
      if (lifetime.current === current) lifetime.current = null;
    };
  }, [props.projectCwd, props.enabled, owner?.tabKey]);
  useLayoutEffect(() => {
    if (!migrations || migrations.views.getSnapshot() !== revision) return;
    const normalized = migrations.views.normalizeTerminals(
      props.tabs,
      props.docks,
    );
    if (normalized.tabs === props.tabs && normalized.docks === props.docks)
      return;
    const permit = latest.current.capture();
    if (!permit?.isCurrent()) return;
    props.setTabs((tabs) =>
      permit.isCurrent()
        ? migrations.views.normalizeTerminals(tabs, []).tabs
        : tabs,
    );
    props.setDocks((docks) =>
      permit.isCurrent()
        ? migrations.views.normalizeTerminals([], docks).docks
        : docks,
    );
  }, [
    migrations,
    revision,
    props.tabs,
    props.docks,
    props.setTabs,
    props.setDocks,
  ]);
  return useCallback<Recover>(
    (file, slotKey, requestCurrent, onSettled) => {
      const captured = latest.current;
      const original = lifetime.current;
      if (!file.canonicalTerminal && migrations) {
        const target = terminalRecoveryTarget(captured, file.id, slotKey, true);
        const permit = captured.capture();
        const current = () =>
          lifetime.current === original &&
          !!original &&
          permit?.isCurrent() === true &&
          latest.current.enabled &&
          latest.current.owner?.visible === true &&
          latest.current.owner?.tabKey === captured.owner?.tabKey &&
          requestCurrent() &&
          terminalRecoveryTarget(latest.current, file.id, slotKey, true)
            ?.file === file;
        if (
          !captured.enabled ||
          !captured.owner ||
          !captured.catalog ||
          !target ||
          target.file !== file ||
          !current()
        )
          return false;
        const catalog = captured.catalog;
        const source = captured.owner;
        let result: Promise<ProjectTerminalReference>;
        try {
          result = migrations.run(
            file,
            captured.projectCwd,
            current,
            () =>
              new Promise((resolve, reject) => {
                if (!current()) {
                  reject(new Error("Terminal migration was retired."));
                  return;
                }
                const accepted = captured.open({
                  cwd: file.cwd,
                  title: terminalTabLabel(file),
                  slotKey,
                  isCurrent: current,
                  onCreated: () => {},
                  onConfirmed: (terminal) => {
                    let adopted = false;
                    try {
                      adopted =
                        current() &&
                        migrations.views.migrateTerminal(
                          file,
                          {
                            tabKey: terminal.tabKey,
                            projectCwd: captured.projectCwd,
                          },
                          current,
                        );
                    } catch {
                      adopted = false;
                    }
                    resolve(terminal);
                    return adopted;
                  },
                  onFailed: reject,
                });
                if (!accepted)
                  reject(new Error("Terminal migration was declined."));
              }),
          );
        } catch {
          onSettled();
          return false;
        }
        void result
          .then(({ tabKey }) => {
            if (!current()) return;
            const hold = catalog.reserve({
              ownerTabKey: source.tabKey,
              projectCwd: captured.projectCwd,
              slotKey,
            });
            if (!hold) return;
            let adopted = false;
            try {
              if (hold.bind(tabKey))
                adopted = migrations.views.migrateTerminal(
                  file,
                  { tabKey, projectCwd: captured.projectCwd },
                  () => current() && hold.isCurrent(),
                );
            } finally {
              if (!adopted) hold.retire();
              hold.release();
            }
          })
          .catch(() => undefined)
          .finally(onSettled);
        return true;
      }
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
        const current = terminalRecoveryTarget(
          latest.current,
          file.id,
          slotKey,
        );
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
        title: terminalTabLabel(file),
        slotKey,
        isCurrent: () =>
          submitted
            ? baseCurrent() && currentTarget()?.file === replacement
            : originalCurrent(),
        onCreated: ({ tabKey }) => {
          if (!originalCurrent())
            throw new Error("Terminal recovery was retired.");
          const nextReference = { tabKey, projectCwd: captured.projectCwd };
          replacement = {
            ...file,
            foreground: undefined,
            canonicalTerminal: nextReference,
          };
          const successor = replacement;
          if (
            migrations &&
            !migrations.views.migrateTerminal(
              file,
              nextReference,
              originalCurrent,
            )
          )
            throw new Error("Terminal recovery was retired.");
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
    },
    [migrations],
  );
}
