import type { Tab } from "@/modules/tabs";
import { lazy, Suspense } from "react";

const LazyTeamStack = lazy(() =>
  import("./TeamStack").then((module) => ({
    default: module.TeamStack,
  })),
);

type Props = {
  tabs: Tab[];
  activeId: number;
  onNavigateToTab?: (tabId: number) => void;
  onNewHarnessTab?: (spaceId?: string, cwd?: string, sessionId?: string) => number;
};

export function TeamStackLazy(props: Props) {
  if (!props.tabs.some((tab) => tab.kind === "team" && !tab.cold)) {
    return null;
  }

  return (
    <Suspense fallback={null}>
      <LazyTeamStack {...props} />
    </Suspense>
  );
}
