import { useCallback, useLayoutEffect, useRef } from "react";

const alwaysCurrent = () => true;

export type ExplorerReveal = (
  path: string,
  isCurrent?: () => boolean,
) => Promise<boolean>;

export function useExplorerReveal({
  scope,
  revealTree,
  select,
  scroll,
}: {
  scope: object;
  revealTree: ExplorerReveal;
  select: (path: string, isCurrent: () => boolean) => void;
  scroll: (path: string) => void;
}): ExplorerReveal {
  const ownerRef = useRef<{
    scope: object;
    revealTree: ExplorerReveal;
  } | null>(null);
  const requestRef = useRef<object | null>(null);
  const frameRef = useRef<number | null>(null);
  const callbacks = useRef({ select, scroll });
  useLayoutEffect(() => {
    callbacks.current = { select, scroll };
  });
  useLayoutEffect(() => {
    const owner = { scope, revealTree };
    ownerRef.current = owner;
    return () => {
      if (ownerRef.current !== owner) return;
      ownerRef.current = null;
      requestRef.current = null;
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, [scope, revealTree]);
  return useCallback(
    async (path, callerCurrent = alwaysCurrent) => {
      const owner = ownerRef.current;
      if (
        !owner ||
        owner.scope !== scope ||
        owner.revealTree !== revealTree ||
        !callerCurrent()
      )
        return false;
      const request = {};
      requestRef.current = request;
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      const isCurrent = () =>
        ownerRef.current === owner &&
        requestRef.current === request &&
        callerCurrent();
      const revealed = await revealTree(path, isCurrent);
      if (!revealed || !isCurrent()) return false;
      callbacks.current.select(path, isCurrent);
      if (!isCurrent()) return false;
      const frame = requestAnimationFrame(() => {
        if (frameRef.current !== frame) return;
        frameRef.current = null;
        if (isCurrent()) callbacks.current.scroll(path);
      });
      frameRef.current = frame;
      return true;
    },
    [scope, revealTree],
  );
}
