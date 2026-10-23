import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Tab, TerminalTab } from "@/modules/tabs";
import type { TabKey } from "@/modules/tabs/lib/tabIdentity";
import type { WorkspacePlacement } from "@/modules/spaces/lib/spaceGeometry";
import { useTerminalSurfaceController } from "@/modules/terminal/TerminalSurface";
import {
  createTerminalSurfaceAdmission,
  type TerminalSurfaceIntent,
} from "@/modules/terminal/lib/terminalSurfaceAdmission";

export type CanonicalTerminalReference = { tabKey: TabKey; projectCwd: string };
type Catalog = {
  revision: number;
  reserve: (
    intent: TerminalSurfaceIntent,
  ) => ReturnType<ReturnType<typeof createTerminalSurfaceAdmission>["reserve"]>;
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
  activeId = -1,
  placements,
}: {
  tabs: readonly Tab[];
  activeId?: number;
  placements?: readonly WorkspacePlacement[];
  onClose?: (
    id: number,
    terminalIds?: readonly number[],
  ) => void | Promise<void>;
  children: ReactNode;
}) {
  const surfaces = useTerminalSurfaceController();
  const byId = useMemo(
    () =>
      placements
        ? new Map(placements.map((placement) => [placement.tabId, placement]))
        : undefined,
    [placements],
  );
  const latest = useRef({
    tabs,
    onClose,
    activeId,
    placements: byId,
    surfaces,
  });
  const [admission] = useState(() =>
    createTerminalSurfaceAdmission(() => ({
      ...latest.current,
      entries: latest.current.surfaces?.getSnapshot().entries ?? [],
    })),
  );
  const [revision, setRevision] = useState(0);
  const live = useRef(false);
  useLayoutEffect(() => {
    live.current = true;
    admission.resume();
    return () => {
      live.current = false;
      admission.retire();
    };
  }, [admission]);
  useLayoutEffect(() => {
    latest.current = { tabs, onClose, activeId, placements: byId, surfaces };
    if (admission.revalidate()) setRevision((value) => value + 1);
  }, [tabs, onClose, activeId, byId, surfaces, admission]);
  useLayoutEffect(
    () =>
      surfaces?.subscribe(() => {
        if (admission.revalidate()) setRevision((value) => value + 1);
      }),
    [surfaces, admission],
  );
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
      reserve: admission.reserve,
      revision,
      requestClose,
      requestCloseMany,
    }),
    [tabs, requestClose, requestCloseMany, admission, revision],
  );
  return <Context value={value}>{children}</Context>;
}

export function useCanonicalTerminalCatalog() {
  return useContext(Context);
}
