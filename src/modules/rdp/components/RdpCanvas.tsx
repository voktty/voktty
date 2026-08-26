import { cn } from "@/lib/utils";
import type React from "react";
import { useCallback, useEffect, useRef } from "react";
import type { RdpInput } from "../types";

type Props = {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  resolution: { width: number; height: number };
  scaleMode: "fit" | "1:1";
  onSendInput: (input: RdpInput) => void;
  onSendKey: (code: string, pressed: boolean) => void;
};

export function RdpCanvas({
  canvasRef,
  resolution,
  scaleMode,
  onSendInput,
  onSendKey,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  const getCanvasCoords = useCallback(
    (e: React.MouseEvent | React.PointerEvent | MouseEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return null;

      const scaleX = resolution.width / rect.width;
      const scaleY = resolution.height / rect.height;

      const x = Math.max(
        0,
        Math.min(
          resolution.width - 1,
          Math.floor((e.clientX - rect.left) * scaleX),
        ),
      );
      const y = Math.max(
        0,
        Math.min(
          resolution.height - 1,
          Math.floor((e.clientY - rect.top) * scaleY),
        ),
      );

      return { x, y };
    },
    [canvasRef, resolution],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const coords = getCanvasCoords(e);
      if (!coords) return;
      onSendInput({
        type: "mouse_move",
        x: coords.x,
        y: coords.y,
      });
    },
    [getCanvasCoords, onSendInput],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      (e.currentTarget as HTMLElement).focus?.();
      const coords = getCanvasCoords(e);
      if (coords) {
        onSendInput({
          type: "mouse_move",
          x: coords.x,
          y: coords.y,
        });
      }
      let button = 1;
      if (e.button === 1) button = 2; // Middle
      else if (e.button === 2) button = 3; // Right

      onSendInput({
        type: "mouse_button",
        button,
        pressed: true,
      });
    },
    [getCanvasCoords, onSendInput],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      let button = 1;
      if (e.button === 1) button = 2;
      else if (e.button === 2) button = 3;

      onSendInput({
        type: "mouse_button",
        button,
        pressed: false,
      });
    },
    [onSendInput],
  );

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      onSendInput({
        type: "mouse_wheel",
        vertical: true,
        delta: e.deltaY < 0 ? 120 : -120,
      });
    },
    [onSendInput],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      e.preventDefault();
      onSendKey(e.code, true);
    },
    [onSendKey],
  );

  const handleKeyUp = useCallback(
    (e: React.KeyboardEvent) => {
      e.preventDefault();
      onSendKey(e.code, false);
    },
    [onSendKey],
  );

  // Initialize canvas backing store resolution
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = resolution.width;
    canvas.height = resolution.height;
  }, [canvasRef, resolution]);

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative flex h-full w-full items-center justify-center overflow-auto bg-black/95 select-none",
        scaleMode === "fit" ? "overflow-hidden" : "overflow-auto",
      )}
      onContextMenu={(e) => e.preventDefault()}
    >
      <canvas
        ref={canvasRef}
        tabIndex={0}
        onPointerMove={handlePointerMove}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onWheel={handleWheel}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        className={cn(
          "outline-none cursor-default shadow-2xl transition-all duration-150",
          scaleMode === "fit"
            ? "max-h-full max-w-full object-contain"
            : "shrink-0",
        )}
        style={
          scaleMode === "1:1"
            ? { width: resolution.width, height: resolution.height }
            : undefined
        }
      />
    </div>
  );
}
