import { useCallback, useRef, useState } from "react";

export type Position = { x: number; y: number };

type Options = {
  initialPosition?: Position;
  onPositionChange?: (pos: Position) => void;
  resetOnClose?: boolean;
};

export function useDraggableModal(options: Options = {}) {
  const [position, setPosition] = useState<Position>(
    options.initialPosition ?? { x: 0, y: 0 },
  );
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef<{
    pointerX: number;
    pointerY: number;
    posX: number;
    posY: number;
  }>({
    pointerX: 0,
    pointerY: 0,
    posX: 0,
    posY: 0,
  });

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      // Only drag with primary mouse button / touch
      if (e.button !== 0) return;
      // Do not initiate drag if clicking on interactive elements (buttons, inputs, etc.)
      const target = e.target as HTMLElement;
      if (
        target.closest("button, input, select, textarea, a, [data-no-drag]")
      ) {
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      isDraggingRef.current = true;
      dragStartRef.current = {
        pointerX: e.clientX,
        pointerY: e.clientY,
        posX: position.x,
        posY: position.y,
      };

      const handlePointerMove = (moveEvent: PointerEvent) => {
        if (!isDraggingRef.current) return;
        const deltaX = moveEvent.clientX - dragStartRef.current.pointerX;
        const deltaY = moveEvent.clientY - dragStartRef.current.pointerY;

        // Bounded within reasonable window limits
        const maxX = window.innerWidth / 2 - 40;
        const maxY = window.innerHeight / 2 - 40;
        const nextX = Math.max(
          -maxX,
          Math.min(maxX, dragStartRef.current.posX + deltaX),
        );
        const nextY = Math.max(
          -maxY,
          Math.min(maxY, dragStartRef.current.posY + deltaY),
        );

        const newPos = { x: nextX, y: nextY };
        setPosition(newPos);
        options.onPositionChange?.(newPos);
      };

      const handlePointerUp = () => {
        isDraggingRef.current = false;
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
        window.removeEventListener("pointercancel", handlePointerUp);
      };

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
      window.addEventListener("pointercancel", handlePointerUp);
    },
    [position, options],
  );

  const resetPosition = useCallback(() => {
    const defaultPos = { x: 0, y: 0 };
    setPosition(defaultPos);
    options.onPositionChange?.(defaultPos);
  }, [options]);

  return {
    position,
    setPosition,
    handlePointerDown,
    resetPosition,
    dragHandleProps: {
      onPointerDown: handlePointerDown,
      onDoubleClick: resetPosition,
      style: { cursor: "grab" },
    },
  };
}
