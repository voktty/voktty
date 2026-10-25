import { useCallback, useLayoutEffect, useMemo, useRef } from "react";

export function useExplorerGitInitialization({
  scope,
  rootPath,
  initialize,
  onSuccess,
  onError,
}: {
  scope: object;
  rootPath: string | null;
  initialize?: (path: string) => Promise<boolean> | boolean;
  onSuccess: () => void;
  onError: (error: unknown) => void;
}): () => Promise<void> {
  const binding = useMemo(
    () => ({ scope, rootPath, initialize }),
    [scope, rootPath, initialize],
  );
  const current = useRef<{ binding: typeof binding; pending: boolean } | null>(
    null,
  );
  const unsettled = useRef(new Set<object>());
  useLayoutEffect(() => {
    const owner = { binding, pending: false };
    current.current = owner;
    return () => {
      if (current.current === owner) current.current = null;
    };
  }, [binding]);
  return useCallback(async () => {
    const owner = current.current;
    if (
      !owner ||
      owner.binding !== binding ||
      owner.pending ||
      !rootPath ||
      !initialize ||
      unsettled.current.size >= 256
    )
      return;
    const receipt = {};
    owner.pending = true;
    unsettled.current.add(receipt);
    const isCurrent = () => current.current === owner;
    try {
      const accepted = await initialize(rootPath);
      if (accepted && isCurrent()) onSuccess();
    } catch (error) {
      if (isCurrent()) onError(error);
    } finally {
      owner.pending = false;
      unsettled.current.delete(receipt);
    }
  }, [binding, rootPath, initialize, onSuccess, onError]);
}
