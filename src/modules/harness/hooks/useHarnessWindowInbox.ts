import { useEffect, useRef, useState } from "react";
import { useInboxUnseen } from "@/modules/harness/hooks/useInboxUnseen";
import { collectHarnessWindowInboxProjects } from "@/modules/harness/lib/harnessWindowInboxProjects";
import {
  loadRecents,
  subscribeProjectPathsChanged,
  type RecentProject,
} from "@/modules/harness/lib/recents";

type Options = NonNullable<Parameters<typeof useInboxUnseen>[2]>;

export function useHarnessWindowInbox(
  livePaths: readonly string[],
  options: Options,
) {
  const [recents, setRecents] = useState(() =>
    collectHarnessWindowInboxProjects(loadRecents(), []),
  );
  useEffect(() => {
    const refresh = () => {
      const next = collectHarnessWindowInboxProjects(loadRecents(), []);
      setRecents((previous) =>
        previous.length === next.length &&
        previous.every((project, index) => project.path === next[index].path)
          ? previous
          : next,
      );
    };
    const stop = subscribeProjectPathsChanged(refresh);
    refresh();
    return stop;
  }, []);
  const key = JSON.stringify([...new Set(livePaths)].sort());
  const scope = useRef<{
    key: string;
    recents: RecentProject[];
    projects: RecentProject[];
  } | null>(null);
  if (
    !scope.current ||
    scope.current.key !== key ||
    scope.current.recents !== recents
  )
    scope.current = {
      key,
      recents,
      projects: collectHarnessWindowInboxProjects(recents, livePaths),
    };
  return useInboxUnseen(scope.current.projects, "", options);
}
