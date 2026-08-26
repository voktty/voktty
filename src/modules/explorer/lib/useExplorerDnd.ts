import type { PointerEvent as ReactPointerEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

export type ExplorerPathDropTarget = {
  updateTarget: (clientX: number, clientY: number) => boolean;
  dropPath: (path: string, clientX: number, clientY: number) => boolean;
  dropExplorerPath?: (path: string, clientX: number, clientY: number) => boolean;
  clearTarget: () => void;
};

type Options = {
  rootPath: string;
  isDir: (path: string) => boolean | undefined;
  onMove: (from: string, toDir: string) => void;
  pathDropTarget?: ExplorerPathDropTarget;
  selectedPaths?: Set<string>;
};

const THRESHOLD = 5;

function parentDir(path: string): string {
  const i = path.lastIndexOf("/");
  return i > 0 ? path.slice(0, i) : path;
}

export function resolveExplorerMoveTarget(
  source: string,
  rootPath: string,
  hoveredPath: string | null,
  insideExplorer: boolean,
  isDir: (path: string) => boolean | undefined,
): string | null {
  if (!insideExplorer) return null;
  const target = hoveredPath
    ? isDir(hoveredPath)
      ? hoveredPath
      : parentDir(hoveredPath)
    : rootPath;
  if (
    target === source ||
    target.startsWith(`${source}/`) ||
    parentDir(source) === target
  ) {
    return null;
  }
  return target;
}

export function finishExplorerDrag(
  commit: boolean,
  source: string,
  clientX: number,
  clientY: number,
  moveTarget: string | null,
  pathDropTarget: ExplorerPathDropTarget | undefined,
  onMove: (from: string, toDir: string) => void,
  selectedSources?: Set<string>,
): void {
  const sources =
    selectedSources && selectedSources.has(source) && selectedSources.size > 1
      ? Array.from(selectedSources)
      : [source];

  if (commit && pathDropTarget) {
    let handled = false;
    for (const src of sources) {
      const drop = pathDropTarget.dropExplorerPath ?? pathDropTarget.dropPath;
      if (drop(src, clientX, clientY)) {
        handled = true;
      }
    }
    if (handled) {
      pathDropTarget.clearTarget();
      return;
    }
  }

  if (commit && moveTarget) {
    for (const src of sources) {
      if (src !== moveTarget && !moveTarget.startsWith(`${src}/`)) {
        onMove(src, moveTarget);
      }
    }
  }
  pathDropTarget?.clearTarget();
}

// Pointer-based, delegated on the container (no per-row handlers); sidesteps
// native HTML5 DnD which Tauri intercepts when dragDropEnabled is on. The ghost
// follows the cursor via direct DOM writes, so dragging re-renders only when the
// drop target changes, not on every move.
export function useExplorerDnd({
  rootPath,
  isDir,
  onMove,
  pathDropTarget,
  selectedPaths,
}: Options) {
  const [dragLabel, setDragLabel] = useState<string | null>(null);
  const [dropTargetDir, setDropTargetDir] = useState<string | null>(null);

  const ghostElRef = useRef<HTMLDivElement | null>(null);
  const lastPosRef = useRef({ x: 0, y: 0 });
  const dropTargetRef = useRef<string | null>(null);
  const suppressClickRef = useRef(false);
  const cleanupRef = useRef<(() => void) | null>(null);
  const optsRef = useRef({
    rootPath,
    isDir,
    onMove,
    pathDropTarget,
    selectedPaths,
  });
  optsRef.current = {
    rootPath,
    isDir,
    onMove,
    pathDropTarget,
    selectedPaths,
  };

  const placeGhost = useCallback((x: number, y: number) => {
    lastPosRef.current = { x, y };
    const g = ghostElRef.current;
    if (g) {
      g.style.transform = `translate3d(${x + 10}px, ${y + 10}px, 0)`;
    }
  }, []);

  const ghostRef = useCallback(
    (el: HTMLDivElement | null) => {
      ghostElRef.current = el;
      if (el) placeGhost(lastPosRef.current.x, lastPosRef.current.y);
    },
    [placeGhost],
  );

  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      if (e.button !== 0) return;
      const el = (e.target as HTMLElement).closest<HTMLElement>("[data-fs-path]");
      const source = el?.getAttribute("data-fs-path");
      if (!source) return;
      const { selectedPaths: currentSelected } = optsRef.current;
      const isMulti =
        currentSelected &&
        currentSelected.has(source) &&
        currentSelected.size > 1;
      const name = isMulti
        ? `${currentSelected.size} items`
        : source.slice(source.lastIndexOf("/") + 1);
      const sx = e.clientX;
      const sy = e.clientY;
      let active = false;

      const move = (ev: PointerEvent) => {
        if (!active) {
          if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < THRESHOLD) return;
          active = true;
          lastPosRef.current = { x: ev.clientX, y: ev.clientY };
          setDragLabel(name);
        }
        placeGhost(ev.clientX, ev.clientY);
        const { rootPath, isDir, pathDropTarget } = optsRef.current;
        const element = document.elementFromPoint(ev.clientX, ev.clientY);
        const terminalTargeted =
          pathDropTarget?.updateTarget(ev.clientX, ev.clientY) ?? false;
        const hit = element?.closest<HTMLElement>("[data-fs-path]");
        const p = hit?.getAttribute("data-fs-path");
        const valid = terminalTargeted
          ? null
          : resolveExplorerMoveTarget(
              source,
              rootPath,
              p ?? null,
              element?.closest("[data-explorer-drop]") != null,
              isDir,
            );
        if (dropTargetRef.current !== valid) {
          dropTargetRef.current = valid;
          setDropTargetDir(valid);
        }
      };
      const detach = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", cancel);
        cleanupRef.current = null;
      };
      const end = (commit: boolean) => {
        detach();
        if (!active) return;
        const { x, y } = lastPosRef.current;
        finishExplorerDrag(
          commit,
          source,
          x,
          y,
          dropTargetRef.current,
          optsRef.current.pathDropTarget,
          optsRef.current.onMove,
          optsRef.current.selectedPaths,
        );
        suppressClickRef.current = true;
        setTimeout(() => {
          suppressClickRef.current = false;
        }, 0);
        dropTargetRef.current = null;
        setDragLabel(null);
        setDropTargetDir(null);
      };
      const up = () => end(true);
      const cancel = () => end(false);
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", cancel);
      cleanupRef.current = detach;
    },
    [placeGhost],
  );

  const onClickCapture = useCallback((e: React.MouseEvent) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      e.preventDefault();
      e.stopPropagation();
    }
  }, []);

  useEffect(
    () => () => {
      cleanupRef.current?.();
      optsRef.current.pathDropTarget?.clearTarget();
    },
    [],
  );

  return { ghostRef, dragLabel, dropTargetDir, onPointerDown, onClickCapture };
}
