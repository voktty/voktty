import { useCallback, useLayoutEffect, useRef } from "react";
import { createHarnessViewCreation } from "@/modules/harness/lib/harnessViewCreation";
import type {
  CreateHarnessNavigationView,
  HarnessNavigationView,
} from "@/modules/harness/lib/harnessWindowNavigation";
import type { Tab } from "@/modules/tabs";

export function useHarnessViewCreation(
  tabs: readonly Tab[],
  openTab?: () => number,
) {
  const current = useRef<ReturnType<typeof createHarnessViewCreation> | null>(
    null,
  );
  const latest = useRef(openTab);
  latest.current = openTab;
  useLayoutEffect(() => {
    const owner = createHarnessViewCreation();
    current.current = owner;
    return () => {
      if (current.current === owner) current.current = null;
      owner.dispose();
    };
  }, []);
  useLayoutEffect(() => {
    current.current?.observeTabs(
      tabs.filter((tab) => tab.kind === "harness").map((tab) => tab.id),
    );
  }, [tabs]);
  const create = useCallback<CreateHarnessNavigationView>((_id, permit) => {
    const open = latest.current;
    return open && current.current
      ? current.current.create(open, permit)
      : Promise.resolve(null);
  }, []);
  const registered = useCallback((view: HarnessNavigationView) => {
    queueMicrotask(() => current.current?.registered(view));
  }, []);
  return { create: openTab ? create : undefined, registered };
}
