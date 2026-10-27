import { useCallback, useMemo, useSyncExternalStore } from "react";
import {
  peekProjectFiles,
  subscribeProjectFiles,
} from "@/modules/harness/lib/fileIndex";
import { useProjectFileIndex } from "@/modules/harness/lib/useProjectFileIndex";
import type { ProjectFile } from "@/modules/harness/lib/fs";

const EMPTY: ProjectFile[] = [];

export function useProjectFileCatalog(cwd: string, enabled: boolean) {
  const index = useProjectFileIndex(cwd, enabled);
  const subscribe = useCallback(
    (listener: () => void) =>
      enabled ? subscribeProjectFiles(listener) : () => {},
    [enabled],
  );
  const snapshot = useCallback(
    () => (enabled ? peekProjectFiles(cwd) : null),
    [cwd, enabled],
  );
  const files = useSyncExternalStore(subscribe, snapshot, () => null);
  return useMemo(
    () => ({
      ...index,
      files: files ?? EMPTY,
      isCurrent: () =>
        enabled && index.isCurrent() && files !== null && snapshot() === files,
    }),
    [enabled, index, files, snapshot],
  );
}
