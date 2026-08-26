import { useCallback, useEffect, useState } from "react";

export type SelectionPopupPosition = {
  x: number;
  y: number;
  top: number;
  bottom: number;
  left: number;
  right: number;
  width: number;
  height: number;
  selectedText: string;
};

type Params = {
  captureActiveSelection: () => string | null;
  askFromSelection: () => void;
};

/**
 * Tracks text selections inside the terminal / editor and surfaces the
 * Live AI Selection Toolbar. Supports mouse drag, Ctrl+A (Select All),
 * and keyboard selections (Shift+Arrows).
 */
export function useSelectionAskAi({
  captureActiveSelection,
  askFromSelection,
}: Params) {
  const [askPopup, setAskPopup] = useState<SelectionPopupPosition | null>(null);

  useEffect(() => {
    const isInsideAi = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      if (!el) return false;
      return !!(
        el.closest("[data-selection-ask-ai]") ||
        el.closest("[data-ai-input-bar]") ||
        el.closest("[data-ai-mini-window]") ||
        el.closest("[data-inline-ai-widget]")
      );
    };

    const computeSelectionCoordinates = (
      text: string,
      fallbackClientX?: number,
      fallbackClientY?: number,
    ): SelectionPopupPosition => {
      // 1. Try DOM window.getSelection range bounds
      try {
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0) {
          const range = sel.getRangeAt(0);
          const rect = range.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            return {
              x: Math.round(rect.left + rect.width / 2),
              y: Math.round(rect.top),
              top: Math.round(rect.top),
              bottom: Math.round(rect.bottom),
              left: Math.round(rect.left),
              right: Math.round(rect.right),
              width: Math.round(rect.width),
              height: Math.round(rect.height),
              selectedText: text,
            };
          }
        }
      } catch {
        // Range bounding rect may throw in detached contexts
      }

      // 2. Try active CodeMirror selection layer
      const cmSelection = document.querySelector(".cm-editor .cm-selectionLayer");
      if (cmSelection) {
        const rect = cmSelection.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          return {
            x: Math.round(rect.left + rect.width / 2),
            y: Math.round(rect.top),
            top: Math.round(rect.top),
            bottom: Math.round(rect.bottom),
            left: Math.round(rect.left),
            right: Math.round(rect.right),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            selectedText: text,
          };
        }
      }

      // 3. Try active CodeMirror cursor
      const cmCursor = document.querySelector(".cm-editor .cm-cursor");
      if (cmCursor) {
        const rect = cmCursor.getBoundingClientRect();
        if (rect.top > 0) {
          return {
            x: Math.round(rect.left),
            y: Math.round(rect.top),
            top: Math.round(rect.top),
            bottom: Math.round(rect.bottom || rect.top + 20),
            left: Math.round(rect.left),
            right: Math.round(rect.right || rect.left + 20),
            width: Math.round(rect.width || 10),
            height: Math.round(rect.height || 18),
            selectedText: text,
          };
        }
      }

      // 4. Fallback to passed client coordinates
      if (
        typeof fallbackClientX === "number" &&
        typeof fallbackClientY === "number" &&
        fallbackClientX > 0 &&
        fallbackClientY > 0
      ) {
        return {
          x: fallbackClientX,
          y: fallbackClientY,
          top: fallbackClientY,
          bottom: fallbackClientY + 24,
          left: Math.max(0, fallbackClientX - 50),
          right: fallbackClientX + 50,
          width: 100,
          height: 24,
          selectedText: text,
        };
      }

      // 5. Fallback to editor / terminal content area
      const contentArea = document.querySelector(".cm-editor, .xterm");
      if (contentArea) {
        const rect = contentArea.getBoundingClientRect();
        return {
          x: Math.round(rect.left + rect.width / 2),
          y: Math.round(rect.top + 80),
          top: Math.round(rect.top + 80),
          bottom: Math.round(rect.top + 104),
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
          height: 24,
          selectedText: text,
        };
      }

      return {
        x: Math.round(window.innerWidth / 2),
        y: Math.round(window.innerHeight / 3),
        top: Math.round(window.innerHeight / 3),
        bottom: Math.round(window.innerHeight / 3 + 24),
        left: Math.round(window.innerWidth / 4),
        right: Math.round((window.innerWidth * 3) / 4),
        width: Math.round(window.innerWidth / 2),
        height: 24,
        selectedText: text,
      };
    };

    const evaluateSelection = (fallbackX?: number, fallbackY?: number) => {
      // Defer one tick so CodeMirror/Xterm update internal selection states
      setTimeout(() => {
        const text = captureActiveSelection();
        if (text && text.trim().length > 0) {
          const coords = computeSelectionCoordinates(text, fallbackX, fallbackY);
          setAskPopup(coords);
        } else {
          setAskPopup(null);
        }
      }, 25);
    };

    const onDown = (e: MouseEvent) => {
      if (isInsideAi(e.target)) return;
      setAskPopup(null);
    };

    const onUp = (e: MouseEvent) => {
      if (isInsideAi(e.target)) return;
      const el = e.target as HTMLElement | null;
      const inContentArea = el?.closest?.(".xterm, .cm-editor");
      if (!inContentArea) return;
      evaluateSelection(e.clientX, e.clientY);
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (isInsideAi(e.target)) return;
      // Handle Ctrl+A / Cmd+A or Shift+Arrows / Navigation
      if (
        (e.key === "a" && (e.ctrlKey || e.metaKey)) ||
        e.shiftKey ||
        e.key === "ArrowLeft" ||
        e.key === "ArrowRight" ||
        e.key === "ArrowUp" ||
        e.key === "ArrowDown" ||
        e.key === "Home" ||
        e.key === "End"
      ) {
        const el = document.activeElement;
        const inContentArea = el?.closest?.(".xterm, .cm-editor");
        if (!inContentArea) return;
        evaluateSelection();
      }
    };

    document.addEventListener("mousedown", onDown);
    document.addEventListener("mouseup", onUp);
    document.addEventListener("keyup", onKeyUp);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("keyup", onKeyUp);
    };
  }, [captureActiveSelection]);

  const onAskFromSelection = useCallback(() => {
    askFromSelection();
    setAskPopup(null);
  }, [askFromSelection]);

  return { askPopup, setAskPopup, onAskFromSelection };
}
