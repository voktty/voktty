import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { requestHarnessSourceControl } from "@/modules/source-control/harnessSourceControlRequest";

export function useHarnessSourceControlOpening(
  projectPath: string,
  enabled = true,
  capture?: () => { isCurrent: () => boolean } | null | undefined,
) {
  const binding = useMemo(() => ({ projectPath, enabled }), [projectPath, enabled]);
  const current = useRef<{ binding: object } | null>(null);
  const captureRef = useRef(capture);
  useLayoutEffect(() => { captureRef.current = capture; });
  useLayoutEffect(() => {
    const owner = { binding };
    current.current = owner;
    return () => {
      if (current.current === owner) current.current = null;
    };
  }, [binding]);

  return useCallback(() => {
    const owner = current.current;
    if (!enabled || owner?.binding !== binding) return false;
    const permit = captureRef.current?.();
    if (captureRef.current && !permit) return false;
    const isCurrent = () => current.current === owner && (!permit || permit.isCurrent());
    if (!isCurrent()) return false;
    return requestHarnessSourceControl(projectPath, isCurrent);
  }, [binding, enabled, projectPath]);
}
