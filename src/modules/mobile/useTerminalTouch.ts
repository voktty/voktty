import { useEffect, useCallback, type RefObject } from "react";
import { scrollVisibleTerminal, getSlotForLeaf } from "@/modules/terminal/lib/rendererPool";

const MOVE_THRESHOLD = 10;

type TouchPosition = { x: number; y: number };

export function useTerminalTouch(
  terminalRef: RefObject<HTMLElement | null>,
  selectionMode = false,
  activeLeafId: number | null = null,
  enabled = true,
) {
  const handleContextMenu = useCallback((e: MouseEvent) => {
    e.preventDefault();
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const el = terminalRef.current;
    if (!el) return;

    // === Selection mode: drag to select text using xterm API ===
    if (selectionMode && activeLeafId !== null) {
      let startCell: { col: number; row: number } | null = null;
      let lastCell: { col: number; row: number } | null = null;

      const getCell = (clientX: number, clientY: number) => {
        const slot = getSlotForLeaf(activeLeafId);
        if (!slot) return null;
        const rect = slot.host.getBoundingClientRect();
        const cellW = rect.width / slot.term.cols;
        const cellH = rect.height / slot.term.rows;
        const col = Math.max(0, Math.min(slot.term.cols - 1, Math.floor((clientX - rect.left) / cellW)));
        const viewportRow = Math.max(0, Math.min(slot.term.rows - 1, Math.floor((clientY - rect.top) / cellH)));
        return { col, row: viewportRow + slot.term.buffer.active.viewportY };
      };

      const applySelection = () => {
        if (!startCell || !lastCell || !activeLeafId) return;
        const slot = getSlotForLeaf(activeLeafId);
        if (!slot) return;
        // Forward selection
        if (startCell.row < lastCell.row || (startCell.row === lastCell.row && startCell.col <= lastCell.col)) {
          const length = (lastCell.row - startCell.row) * slot.term.cols + (lastCell.col - startCell.col) + 1;
          slot.term.select(startCell.col, startCell.row, length);
        } else {
          // Backward selection
          const length = (startCell.row - lastCell.row) * slot.term.cols + (startCell.col - lastCell.col) + 1;
          slot.term.select(lastCell.col, lastCell.row, length);
        }
      };

      const onTouchStart = (e: TouchEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const touch = e.touches[0];
        startCell = getCell(touch.clientX, touch.clientY);
        lastCell = startCell;
        if (startCell) applySelection();
      };

      const onTouchMove = (e: TouchEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const touch = e.touches[0];
        lastCell = getCell(touch.clientX, touch.clientY);
        if (startCell && lastCell) applySelection();
      };

      const onTouchEnd = (e: TouchEvent) => {
        e.stopPropagation();
      };

      el.addEventListener("touchstart", onTouchStart, { passive: false, capture: true });
      el.addEventListener("touchmove", onTouchMove, { passive: false, capture: true });
      el.addEventListener("touchend", onTouchEnd, { passive: true, capture: true });
      el.addEventListener("contextmenu", handleContextMenu);
      return () => {
        el.removeEventListener("touchstart", onTouchStart, { capture: true } as AddEventListenerOptions);
        el.removeEventListener("touchmove", onTouchMove, { capture: true } as AddEventListenerOptions);
        el.removeEventListener("touchend", onTouchEnd, { capture: true } as AddEventListenerOptions);
        el.removeEventListener("contextmenu", handleContextMenu);
      };
    }

    // === Normal mode: drag to scroll ===
    let longPressTimer: ReturnType<typeof setTimeout> | null = null;
    let startPos: TouchPosition | null = null;
    let lastY = 0;

    const onTouchStart = (e: TouchEvent) => {
      e.stopPropagation();
      const touch = e.touches[0];
      startPos = { x: touch.clientX, y: touch.clientY };
      lastY = touch.clientY;
      longPressTimer = setTimeout(() => {
        // Long press handled silently
      }, 500);
    };

    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!startPos) return;
      const touch = e.touches[0];
      const dx = Math.abs(touch.clientX - startPos.x);
      const dy = Math.abs(touch.clientY - startPos.y);
      if (dx > MOVE_THRESHOLD || dy > MOVE_THRESHOLD) {
        if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
      }
      if (dy > MOVE_THRESHOLD && dy > dx) {
        const deltaY = lastY - touch.clientY;
        if (Math.abs(deltaY) >= 3) {
          const lines = Math.round(deltaY / 6);
          if (lines !== 0) { scrollVisibleTerminal(lines); lastY = touch.clientY; }
        }
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      e.stopPropagation();
      if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
      startPos = null;
    };

    el.addEventListener("touchstart", onTouchStart, { passive: true, capture: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false, capture: true });
    el.addEventListener("touchend", onTouchEnd, { passive: true, capture: true });
    el.addEventListener("contextmenu", handleContextMenu);
    return () => {
      el.removeEventListener("touchstart", onTouchStart, { capture: true } as AddEventListenerOptions);
      el.removeEventListener("touchmove", onTouchMove, { capture: true } as AddEventListenerOptions);
      el.removeEventListener("touchend", onTouchEnd, { capture: true } as AddEventListenerOptions);
      el.removeEventListener("contextmenu", handleContextMenu);
      if (longPressTimer) clearTimeout(longPressTimer);
    };
  }, [terminalRef, handleContextMenu, selectionMode, activeLeafId, enabled]);
}
