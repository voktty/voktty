import { useCallback, useEffect, useRef, useState } from "react";
import { HARNESS_ICONS, MONOCHROME_HARNESSES } from "../chrome/HarnessIcon";
import { HARNESSES, type HarnessId } from "../lib/session";
import {
  LOGO_CELLS,
  SNAKE_MODES,
  createSnakeArcade,
  type SnakeMode,
} from "./gridArcade";
import { drawSpeechBubble } from "./speechBubble";

const CELL = 6;
const GAP = 1;
const PITCH = CELL + GAP;
const BORDER_OPACITY = 0.06;
const PEAK_OPACITY = 0.28;
const GAME_PEAK_OPACITY = 0.5;
const PLAY_PEAK_OPACITY = 0.72;
const LOGO_OPACITY = 0.7;
const BUBBLE_OPACITY = 0.9;
/** How hard the bubble chases the head; the head itself moves cell by cell. */
const BUBBLE_EASE = 0.2;
const CELL_FLICKER_RATE = 0.0018;
const ROW_PULSE_RATE = 0.00035;
const DECAY = 0.93;
const FRAME_MS = 33;

const HEADING: Record<string, { x: number; y: number }> = {
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  w: { x: 0, y: -1 },
  a: { x: -1, y: 0 },
  s: { x: 0, y: 1 },
  d: { x: 1, y: 0 },
};

type Cell = { intensity: number };
type SnakeArcade = ReturnType<typeof createSnakeArcade>;

function parseRgb(value: string, fallback: string) {
  const match = value.match(/\d+/g);
  if (!match || match.length < 3) return fallback;
  return `${match[0]}, ${match[1]}, ${match[2]}`;
}

function parseContentRgb() {
  return parseRgb(getComputedStyle(document.body).color, "235, 238, 241");
}

function parseSurfaceRgb() {
  return parseRgb(
    getComputedStyle(document.body).backgroundColor,
    "20, 22, 25",
  );
}

export function TerminalGridBackground() {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const arcadeRef = useRef<SnakeArcade | null>(null);
  const scoreRef = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [score, setScore] = useState(0);
  const [mode, setMode] = useState<SnakeMode>("mid");

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (!root || !canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const arcade = createSnakeArcade();
    arcadeRef.current = arcade;
    const logos = Object.fromEntries(
      HARNESSES.map((harness) => {
        const image = new Image();
        image.src = HARNESS_ICONS[harness];
        return [harness, image];
      }),
    ) as Record<HarnessId, HTMLImageElement>;
    const tintCanvas = document.createElement("canvas");
    const tintCtx = tintCanvas.getContext("2d");

    let raf = 0;
    let cols = 0;
    let rows = 0;
    let cells: Cell[] = [];
    let rgb = parseContentRgb();
    let surfaceRgb = parseSurfaceRgb();
    let lastFrame = 0;
    let bubbleAt: { x: number; y: number } | null = null;

    const layout = () => {
      const { width, height } = root.getBoundingClientRect();
      if (width <= 0 || height <= 0) return;

      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const nextCols = Math.ceil(width / PITCH);
      const nextRows = Math.ceil(height / PITCH);
      if (nextCols === cols && nextRows === rows) return;

      cols = nextCols;
      rows = nextRows;
      const needed = cols * rows;
      const prev = cells;
      cells = Array.from({ length: needed }, (_, index) => {
        const existing = prev[index];
        if (existing) return existing;
        return { intensity: Math.random() < 0.12 ? Math.random() * 0.35 : 0 };
      });
      arcade.resize(cols, rows);
    };

    const pulseRow = (row: number, strength = 0.55) => {
      const start = row * cols;
      for (let x = 0; x < cols; x++) {
        const cell = cells[start + x];
        if (!cell) continue;
        cell.intensity = Math.max(
          cell.intensity,
          strength * (0.35 + Math.random() * 0.65),
        );
      }
    };

    const draw = (time: number) => {
      raf = requestAnimationFrame(draw);
      if (time - lastFrame < FRAME_MS) return;
      const dt = lastFrame ? time - lastFrame : FRAME_MS;
      lastFrame = time;

      const { width, height } = root.getBoundingClientRect();
      if (width <= 0 || height <= 0) return;

      arcade.step(dt);

      const nextScore = arcade.score();
      if (nextScore !== scoreRef.current) {
        scoreRef.current = nextScore;
        setScore(nextScore);
      }

      const controlled = arcade.controlled();
      if (!controlled && Math.random() < ROW_PULSE_RATE) {
        pulseRow(Math.floor(Math.random() * rows));
      }

      const stamp = new Float32Array(cols * rows);
      arcade.stamp(stamp, cols, rows);

      ctx.clearRect(0, 0, width, height);
      ctx.lineWidth = 1;
      ctx.strokeStyle = `rgba(${rgb}, ${BORDER_OPACITY})`;

      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const index = y * cols + x;
          const cell = cells[index];
          if (!cell) continue;

          if (!controlled && Math.random() < CELL_FLICKER_RATE) {
            cell.intensity = Math.min(
              1,
              cell.intensity + 0.25 + Math.random() * 0.75,
            );
          }
          cell.intensity *= DECAY;

          const game = stamp[index] ?? 0;
          const peak =
            game > 0.08
              ? controlled
                ? PLAY_PEAK_OPACITY
                : GAME_PEAK_OPACITY
              : PEAK_OPACITY;
          const fillOpacity = Math.max(cell.intensity, game) * peak;
          const px = x * PITCH;
          const py = y * PITCH;
          if (fillOpacity > 0.02) {
            ctx.fillStyle = `rgba(${rgb}, ${fillOpacity})`;
            ctx.fillRect(px, py, CELL, CELL);
          }
          ctx.strokeRect(px + 0.5, py + 0.5, CELL - 1, CELL - 1);
        }
      }

      const pickup = arcade.logoPickup();
      const logo = pickup ? logos[pickup.harness] : null;
      if (pickup && logo?.complete && logo.naturalWidth) {
        const span = LOGO_CELLS * PITCH - GAP;
        const dx = pickup.x * PITCH;
        const dy = pickup.y * PITCH;
        ctx.globalAlpha = pickup.alpha * LOGO_OPACITY;
        if (MONOCHROME_HARNESSES.has(pickup.harness) && tintCtx) {
          const size = Math.max(1, Math.ceil(span));
          if (tintCanvas.width !== size || tintCanvas.height !== size) {
            tintCanvas.width = size;
            tintCanvas.height = size;
          } else {
            tintCtx.clearRect(0, 0, size, size);
          }
          tintCtx.globalCompositeOperation = "source-over";
          tintCtx.drawImage(logo, 0, 0, size, size);
          tintCtx.globalCompositeOperation = "source-in";
          tintCtx.fillStyle = `rgb(${rgb})`;
          tintCtx.fillRect(0, 0, size, size);
          ctx.drawImage(tintCanvas, dx, dy, span, span);
        } else {
          ctx.drawImage(logo, dx, dy, span, span);
        }
        ctx.globalAlpha = 1;
      }

      const bubble = arcade.speechBubble();
      if (!bubble) {
        bubbleAt = null;
      } else {
        const target = { x: bubble.x * PITCH, y: bubble.y * PITCH };
        // Ease towards the head, but snap when it wraps around an edge so the
        // bubble doesn't sail across the whole canvas to catch up.
        const wrapped = bubbleAt && Math.abs(target.x - bubbleAt.x) > width / 3;
        bubbleAt =
          !bubbleAt || wrapped
            ? target
            : {
                x: bubbleAt.x + (target.x - bubbleAt.x) * BUBBLE_EASE,
                y: bubbleAt.y + (target.y - bubbleAt.y) * BUBBLE_EASE,
              };

        drawSpeechBubble(
          ctx,
          bubble.text,
          bubbleAt.x,
          bubbleAt.y,
          CELL,
          { width, height },
          bubble.alpha * BUBBLE_OPACITY,
          { fg: `rgb(${rgb})`, bg: `rgb(${surfaceRgb})` },
        );
      }
    };

    layout();
    raf = requestAnimationFrame(draw);

    const resizeObserver = new ResizeObserver(layout);
    resizeObserver.observe(root);

    const themeObserver = new MutationObserver(() => {
      rgb = parseContentRgb();
      surfaceRgb = parseSurfaceRgb();
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["style", "class"],
    });

    return () => {
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      themeObserver.disconnect();
      arcadeRef.current = null;
    };
  }, []);

  const takeControl = useCallback(() => {
    const arcade = arcadeRef.current;
    arcade?.setMode(mode);
    arcade?.takeControl();
    scoreRef.current = 0;
    setScore(0);
    setPlaying(true);
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
  }, [mode]);

  const pickMode = useCallback((next: SnakeMode) => {
    arcadeRef.current?.setMode(next);
    setMode(next);
  }, []);

  const releaseControl = useCallback(() => {
    arcadeRef.current?.releaseControl();
    scoreRef.current = 0;
    setScore(0);
    setPlaying(false);
  }, []);

  useEffect(() => {
    if (!playing) return;

    const root = rootRef.current;
    root?.focus();
    const onWheel = (event: WheelEvent) => event.preventDefault();
    root?.addEventListener("wheel", onWheel, { passive: false });

    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.isComposing) {
        return;
      }
      const active = document.activeElement;
      if (
        active !== root &&
        !(active instanceof Node && root?.contains(active))
      ) {
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        releaseControl();
        return;
      }
      const heading = HEADING[event.key] ?? HEADING[event.key.toLowerCase()];
      if (!heading) return;
      event.preventDefault();
      event.stopPropagation();
      arcadeRef.current?.steer(heading.x, heading.y);
    };

    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      root?.removeEventListener("wheel", onWheel);
    };
  }, [playing, releaseControl]);

  return (
    <div
      ref={rootRef}
      tabIndex={playing ? 0 : -1}
      onMouseDown={() => {
        if (playing) rootRef.current?.focus();
      }}
      aria-label={
        playing
          ? "Snake. Arrow keys or WASD to move. Escape to release."
          : undefined
      }
      className={
        playing
          ? "absolute inset-0 z-20 overflow-hidden bg-background-base outline-none"
          : "group pointer-events-auto absolute inset-x-0 top-0 z-0 h-48"
      }
    >
      <div
        className={
          playing
            ? "absolute inset-0"
            : "absolute inset-0 overflow-hidden [mask-image:linear-gradient(to_bottom,#000_65%,transparent_100%)]"
        }
      >
        <canvas ref={canvasRef} className="absolute inset-0" aria-hidden />
      </div>

      {playing ? (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 grid grid-cols-3 items-center px-3 py-2 font-mono text-[11px] tracking-[0.14em] text-content/50">
          <span>score {score}</span>
          <div className="pointer-events-auto flex justify-center gap-1">
            {SNAKE_MODES.map((id) => {
              const on = mode === id;
              return (
                <button
                  key={id}
                  type="button"
                  tabIndex={-1}
                  aria-pressed={on}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => pickMode(id)}
                  className={`cursor-pointer border px-2 py-1 ${
                    on
                      ? "border-content/40 bg-content/10 text-content"
                      : "border-content/10 text-content/40 hover:border-content/25 hover:text-content/70"
                  }`}
                >
                  {id}
                </button>
              );
            })}
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              tabIndex={-1}
              onClick={releaseControl}
              className="pointer-events-auto cursor-pointer border border-content/20 bg-background-base/70 px-2 py-1 text-content/70 hover:border-content/40 hover:text-content"
            >
              <span className="text-content/35">[</span> release{" "}
              <span className="text-content/35">]</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="pointer-events-none absolute inset-0 grid place-items-center opacity-0 transition-opacity duration-200 group-hover:opacity-100">
          <button
            type="button"
            tabIndex={-1}
            onMouseDown={(event) => event.preventDefault()}
            onClick={takeControl}
            className="pointer-events-none flex cursor-pointer items-center gap-2 border border-content/25 bg-background-base/80 px-3 py-1.5 font-mono text-[11px] tracking-[0.16em] text-content/85 shadow-lg backdrop-blur-sm group-hover:pointer-events-auto hover:border-content/45 hover:bg-content/10 hover:text-content"
          >
            <span className="text-content/40">[</span>
            take control
            <span
              className="inline-block h-3 w-1.5 bg-content/75 motion-safe:animate-pulse"
              aria-hidden
            />
            <span className="text-content/40">]</span>
          </button>
        </div>
      )}
    </div>
  );
}
