import type { WorkspaceEnv } from "@/modules/workspace";
import type { WorkspaceSearchHit } from "@/modules/workspace-search/types";
import { lazy, Suspense } from "react";

const WorkspaceSearchPanel = lazy(() =>
  import("@/modules/workspace-search/WorkspaceSearchPanel").then((module) => ({
    default: module.WorkspaceSearchPanel,
  })),
);

type Props = {
  active: boolean;
  root: string | null;
  workspace: WorkspaceEnv;
  focusRequest: number;
  dirtyPaths: string[];
  onOpenHit: (hit: WorkspaceSearchHit, pin: boolean) => void;
};

export function WorkspaceSearchPanelLazy(props: Props) {
  return (
    <Suspense fallback={null}>
      <WorkspaceSearchPanel {...props} />
    </Suspense>
  );
}
