import type { Tab } from "@/modules/tabs/lib/useTabs";
import { lazy, Suspense } from "react";

const Icon = lazy(() =>
  import("@/modules/teams/components/TeamTabChrome").then((m) => ({
    default: m.TeamTabIcon,
  })),
);
const ContextItem = lazy(() =>
  import("@/modules/teams/components/TeamTabChrome").then((m) => ({
    default: m.TeamContextMenuItem,
  })),
);
const NewTabItem = lazy(() =>
  import("@/modules/teams/components/TeamTabChrome").then((m) => ({
    default: m.TeamNewTabMenuItem,
  })),
);

export type TeamContextMenuProps = {
  tab: Tab;
  onOpen: (projectPath?: string) => void;
  className: string;
};

export function TeamTabIconLazy() {
  return (
    <Suspense fallback={<span className="size-3.5 shrink-0" />}>
      <Icon />
    </Suspense>
  );
}

export function TeamContextMenuItemLazy(props: TeamContextMenuProps) {
  return (
    <Suspense fallback={null}>
      <ContextItem {...props} />
    </Suspense>
  );
}

export function TeamNewTabMenuItemLazy(props: { onOpen: () => void }) {
  return (
    <Suspense fallback={null}>
      <NewTabItem {...props} />
    </Suspense>
  );
}
