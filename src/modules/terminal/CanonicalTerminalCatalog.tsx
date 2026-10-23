import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import type { Tab, TerminalTab } from "@/modules/tabs";
import type { TabKey } from "@/modules/tabs/lib/tabIdentity";

export type CanonicalTerminalReference = { tabKey: TabKey; projectCwd: string };
type Catalog = {
  get: (reference: CanonicalTerminalReference) => TerminalTab | undefined;
  requestClose: (reference: CanonicalTerminalReference) => Promise<boolean>;
  requestCloseMany: (
    references: readonly CanonicalTerminalReference[],
  ) => Promise<boolean>;
};
const Context = createContext<Catalog | null>(null);

function matching(tabs: readonly Tab[], reference: CanonicalTerminalReference) {
  const tab = tabs.find((entry) => entry.tabKey === reference.tabKey);
  return tab?.kind === "terminal" &&
    !tab.private &&
    !tab.collaboration &&
    tab.projectCwd === reference.projectCwd
    ? tab
    : undefined;
}

export function CanonicalTerminalCatalog({
  tabs,
  onClose,
  children,
}: {
  tabs: readonly Tab[];
  onClose?: (
    id: number,
    terminalIds?: readonly number[],
  ) => void | Promise<void>;
  children: ReactNode;
}) {
  const latest = useRef({ tabs, onClose });
  const live = useRef(false);
  useLayoutEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  useLayoutEffect(() => {
    latest.current = { tabs, onClose };
  }, [tabs, onClose]);
  const requestClose = useCallback(
    async (reference: CanonicalTerminalReference) => {
      const current = latest.current;
      const tab = matching(current.tabs, reference);
      if (!live.current || !tab || !current.onClose) return false;
      await current.onClose(tab.id);
      return true;
    },
    [],
  );
  const requestCloseMany = useCallback(
    async (references: readonly CanonicalTerminalReference[]) => {
      if (!live.current || references.length > 256) return false;
      const current = latest.current;
      if (!current.onClose) return false;
      const ids = [
        ...new Set(
          references.flatMap((reference) => {
            const tab = matching(current.tabs, reference);
            return tab ? [tab.id] : [];
          }),
        ),
      ];
      if (ids.length === 0) return false;
      await current.onClose(ids[0], ids);
      return true;
    },
    [],
  );
  const value = useMemo(
    () => ({
      get: (reference: CanonicalTerminalReference) => matching(tabs, reference),
      requestClose,
      requestCloseMany,
    }),
    [tabs, requestClose, requestCloseMany],
  );
  return <Context value={value}>{children}</Context>;
}

export function useCanonicalTerminalCatalog() {
  return useContext(Context);
}
