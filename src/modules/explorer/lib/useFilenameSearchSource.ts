import { useMemo, useSyncExternalStore } from "react";
import type { WorkspaceEnv } from "@/modules/workspace";
import { captureFilenameSearch } from "@/modules/explorer/lib/filenameSearch";
import { createProjectFilenameSearchStore } from "@/modules/explorer/lib/projectFilenameSearch";

const subscribeNone = () => () => {};
const emptySnapshot = () => null;

export function useFilenameSearchSource(
  workspace: WorkspaceEnv,
  root: string,
  enabled: boolean,
) {
  const filesystem = JSON.stringify(workspace);
  const store = useMemo(
    () =>
      enabled && root.startsWith("remote://")
        ? createProjectFilenameSearchStore(root)
        : null,
    [root, enabled],
  );
  const snapshot = useSyncExternalStore(
    store?.subscribe ?? subscribeNone,
    store?.getSnapshot ?? emptySnapshot,
    store?.getSnapshot ?? emptySnapshot,
  );
  return useMemo(
    () =>
      enabled
        ? captureFilenameSearch(
            JSON.parse(filesystem) as WorkspaceEnv,
            root,
            snapshot?.source,
          )
        : null,
    [filesystem, root, snapshot, enabled],
  );
}
