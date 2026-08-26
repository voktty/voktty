import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useEffect } from "react";
import { useTerminalDropStore } from "./dropStore";
import { formatDroppedPaths } from "./quoteShellPath";
import { pasteIntoLeaf } from "./rendererPool";

export type TerminalPathDropTarget = {
  updateTarget: (clientX: number, clientY: number) => boolean;
  dropPath: (path: string, clientX: number, clientY: number) => boolean;
  /** Handles paths dragged from Voktty's explorer. Unlike native drops, a
   * miss does not open a new editor: only a terminal or AI chat is a target. */
  dropExplorerPath: (path: string, clientX: number, clientY: number) => boolean;
  clearTarget: () => void;
};

export type TerminalPathDropDeps = {
  leafIdAtPoint: (clientX: number, clientY: number) => number | null;
  paste: (leafId: number, text: string) => boolean;
  setTarget: (leafId: number | null) => void;
  isAiChatAtPoint?: (clientX: number, clientY: number) => boolean;
  isExplorerAtPoint?: (clientX: number, clientY: number) => boolean;
  attachToAi?: (path: string) => boolean;
  openDroppedPath?: (path: string) => boolean;
};

function isAiChatAt(x: number, y: number): boolean {
  if (typeof document === "undefined" || typeof window === "undefined")
    return false;
  let lx = x;
  let ly = y;
  if (x > window.innerWidth || y > window.innerHeight) {
    const dpr = window.devicePixelRatio || 1;
    lx = x / dpr;
    ly = y / dpr;
  }
  const el = document.elementFromPoint(lx, ly);
  return Boolean(el?.closest("[data-ai-chat-drop]"));
}

function isExplorerAt(x: number, y: number): boolean {
  if (typeof document === "undefined" || typeof window === "undefined")
    return false;
  let lx = x;
  let ly = y;
  if (x > window.innerWidth || y > window.innerHeight) {
    const dpr = window.devicePixelRatio || 1;
    lx = x / dpr;
    ly = y / dpr;
  }
  const el = document.elementFromPoint(lx, ly);
  return Boolean(
    el?.closest("[data-fs-path]") ||
      el?.closest("[data-explorer-drop]") ||
      el?.closest("[data-sidebar-panel='explorer']"),
  );
}

function isWorkspaceAt(x: number, y: number): boolean {
  if (typeof document === "undefined" || typeof window === "undefined")
    return false;
  let lx = x;
  let ly = y;
  if (x > window.innerWidth || y > window.innerHeight) {
    const dpr = window.devicePixelRatio || 1;
    lx = x / dpr;
    ly = y / dpr;
  }
  const el = document.elementFromPoint(lx, ly);
  if (
    el?.closest("[data-fs-path]") ||
    el?.closest("[data-explorer-drop]") ||
    el?.closest("[data-sidebar-panel='explorer']")
  ) {
    return false;
  }
  return Boolean(
    el?.closest("[data-empty-workspace]") ||
      el?.closest("#workspace") ||
      el?.closest(".voktty-pane") ||
      el?.closest("[data-tabs-header]") ||
      el?.closest("#header"),
  );
}

// Tauri reports the drop point in physical pixels on some platforms and logical
// on others; only scale down when it overflows the logical viewport.
function leafIdAt(x: number, y: number): number | null {
  if (typeof document === "undefined" || typeof window === "undefined")
    return null;
  let lx = x;
  let ly = y;
  if (x > window.innerWidth || y > window.innerHeight) {
    const dpr = window.devicePixelRatio || 1;
    lx = x / dpr;
    ly = y / dpr;
  }
  const el = document.elementFromPoint(lx, ly);
  const leafEl = el?.closest<HTMLElement>("[data-pane-leaf]");
  if (!leafEl) return null;
  const id = Number(leafEl.dataset.paneLeaf);
  return Number.isFinite(id) ? id : null;
}

export function createTerminalPathDropTarget({
  leafIdAtPoint,
  paste,
  setTarget,
  isAiChatAtPoint = isAiChatAt,
  isExplorerAtPoint = isExplorerAt,
  attachToAi = (path: string) => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("voktty:ai-attach-file", { detail: path }),
      );
      return true;
    }
    return false;
  },
  openDroppedPath = (path: string) => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("voktty:open-dropped-path", { detail: path }),
      );
      return true;
    }
    return false;
  },
}: TerminalPathDropDeps): TerminalPathDropTarget {
  return {
    updateTarget(clientX, clientY) {
      if (isAiChatAtPoint(clientX, clientY) || isExplorerAtPoint(clientX, clientY)) {
        setTarget(null);
        useTerminalDropStore.getState().setWorkspaceHovered(false);
        return true;
      }
      const leafId = leafIdAtPoint(clientX, clientY);
      setTarget(leafId);
      useTerminalDropStore
        .getState()
        .setWorkspaceHovered(
          leafId === null && isWorkspaceAt(clientX, clientY),
        );
      return leafId !== null;
    },
    dropPath(path, clientX, clientY) {
      setTarget(null);
      useTerminalDropStore.getState().setWorkspaceHovered(false);
      if (isAiChatAtPoint(clientX, clientY)) {
        return attachToAi(path);
      }
      if (isExplorerAtPoint(clientX, clientY)) {
        return false;
      }
      const leafId = leafIdAtPoint(clientX, clientY);
      if (leafId !== null) {
        paste(leafId, formatDroppedPaths([path]));
        return true;
      }
      return openDroppedPath(path);
    },
    dropExplorerPath(path, clientX, clientY) {
      setTarget(null);
      useTerminalDropStore.getState().setWorkspaceHovered(false);
      if (isAiChatAtPoint(clientX, clientY)) {
        return attachToAi(path);
      }
      if (isExplorerAtPoint(clientX, clientY)) {
        return false;
      }
      const leafId = leafIdAtPoint(clientX, clientY);
      if (leafId === null) return false;
      paste(leafId, formatDroppedPaths([path]));
      return true;
    },
    clearTarget() {
      setTarget(null);
      useTerminalDropStore.getState().setWorkspaceHovered(false);
    },
  };
}

const terminalPathDropTarget = createTerminalPathDropTarget({
  leafIdAtPoint: leafIdAt,
  paste: pasteIntoLeaf,
  setTarget: (leafId) => useTerminalDropStore.getState().setTarget(leafId),
});

/** Wires native OS file drops into the terminal pane under the cursor: shows a
 * drop overlay on that pane while dragging, and bracketed-pastes the
 * shell-quoted path(s) on drop. Drops on the tab bar/workspace open the file in the editor,
 * drops on the explorer copy/upload, and drops on AI chat attach to context. */
export function useTerminalFileDrop(): TerminalPathDropTarget {
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    const setTarget = useTerminalDropStore.getState().setTarget;
    const setWorkspaceHovered =
      useTerminalDropStore.getState().setWorkspaceHovered;

    void getCurrentWebview()
      .onDragDropEvent((e) => {
        const p = e.payload;
        if (p.type === "enter" || p.type === "over") {
          const isExp = isExplorerAt(p.position.x, p.position.y);
          const leafId = isExp ? null : leafIdAt(p.position.x, p.position.y);
          const isAi = isAiChatAt(p.position.x, p.position.y);
          setTarget(leafId);
          setWorkspaceHovered(
            !isAi &&
              !isExp &&
              leafId === null &&
              isWorkspaceAt(p.position.x, p.position.y),
          );
          return;
        }
        if (p.type === "leave") {
          setTarget(null);
          setWorkspaceHovered(false);
          return;
        }
        if (p.type === "drop") {
          setTarget(null);
          setWorkspaceHovered(false);
          if (!p.paths.length) return;
          if (isAiChatAt(p.position.x, p.position.y)) {
            for (const path of p.paths) {
              window.dispatchEvent(
                new CustomEvent("voktty:ai-attach-file", { detail: path }),
              );
            }
            return;
          }
          if (isExplorerAt(p.position.x, p.position.y)) {
            return;
          }
          const leafId = leafIdAt(p.position.x, p.position.y);
          if (leafId !== null) {
            pasteIntoLeaf(leafId, formatDroppedPaths(p.paths));
          } else {
            for (const path of p.paths) {
              window.dispatchEvent(
                new CustomEvent("voktty:open-dropped-path", { detail: path }),
              );
            }
          }
        }
      })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch((err) => console.error("[voktty] drag-drop listen failed:", err));

    return () => {
      disposed = true;
      setTarget(null);
      setWorkspaceHovered(false);
      unlisten?.();
    };
  }, []);

  return terminalPathDropTarget;
}
