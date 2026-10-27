import { useMemo, useSyncExternalStore } from "react";
import { createProjectFileSourceStore } from "@/modules/remote/projectFileSource";

const subscribeNone = () => () => {};
const emptySnapshot = () => null;

export function useProjectFileSource(path: string | null, enabled: boolean) {
  const store = useMemo(
    () =>
      enabled && path?.startsWith("remote://")
        ? createProjectFileSourceStore(path)
        : null,
    [path, enabled],
  );
  return (
    useSyncExternalStore(
      store?.subscribe ?? subscribeNone,
      store?.getSnapshot ?? emptySnapshot,
      store?.getSnapshot ?? emptySnapshot,
    )?.source ?? null
  );
}
