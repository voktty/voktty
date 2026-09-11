import type { WorkspacePlacement } from "@/modules/spaces";
import type { Tab } from "@/modules/tabs";
import { lazy, Suspense } from "react";

const LazyApiClientStack = lazy(() =>
  import("./ApiClientStack").then((module) => ({
    default: module.ApiClientStack,
  })),
);

type Props = {
  tabs: Tab[];
  activeId: number;
  placements?: ReadonlyMap<number, WorkspacePlacement>;
};

export function ApiClientStackLazy(props: Props) {
  if (!props.tabs.some((tab) => tab.kind === "api-client" && !tab.cold)) {
    return null;
  }

  return (
    <Suspense fallback={null}>
      <LazyApiClientStack {...props} />
    </Suspense>
  );
}
