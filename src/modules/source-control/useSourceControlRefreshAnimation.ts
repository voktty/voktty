import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { useConflictScope } from "@/modules/source-control/useConflictScope";
import { useWorkspaceEnvStore } from "@/modules/workspace";

export function useSourceControlRefreshAnimation({
  open,
  contextKey,
  refresh,
}: {
  open: boolean;
  contextKey: string;
  refresh: () => Promise<void>;
}) {
  const workspace = useWorkspaceEnvStore((state) => state.env);
  const scope = useConflictScope(contextKey, open, workspace, true);
  type Request = {
    binding: object;
    timer: number | null;
    isCurrent: () => boolean;
  };
  const current = useRef<Request | null>(null);
  const [display, setDisplay] = useState<Request | null>(null);
  useLayoutEffect(
    () => () => {
      const request = current.current;
      if (request?.binding !== scope.binding) return;
      current.current = null;
      if (request.timer !== null) window.clearTimeout(request.timer);
    },
    [scope.binding],
  );

  const handleRefresh = useCallback(() => {
    const permit = scope.capture();
    if (!permit) return;
    const previous = current.current;
    if (previous?.timer != null) window.clearTimeout(previous.timer);
    const request: Request = {
      binding: scope.binding,
      timer: null,
      isCurrent: () => current.current === request && permit.isCurrent(),
    };
    current.current = request;
    setDisplay((previous) => (request.isCurrent() ? request : previous));
    const finish = () => {
      if (!request.isCurrent()) return;
      request.timer = window.setTimeout(() => {
        request.timer = null;
        if (!request.isCurrent()) return;
        setDisplay((previous) =>
          request.isCurrent() && previous === request ? null : previous,
        );
      }, 450);
    };
    if (!request.isCurrent()) return;
    try {
      void refresh().then(finish, finish);
    } catch {
      finish();
    }
  }, [scope.binding, scope.capture, refresh]);
  return {
    handleRefresh,
    refreshAnimating:
      !!display && display.binding === scope.binding && display.isCurrent(),
  };
}
