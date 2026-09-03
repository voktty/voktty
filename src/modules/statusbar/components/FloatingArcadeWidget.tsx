import { useCallback, useEffect, useRef, useState } from "react";
import { Cancel01Icon, Refresh01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PacmanIcon } from "./PacmanIcon";
import {
  ARCADE_MODES,
  type ArcadeMode,
  type ArcadeSprite,
  type GridArcade,
} from "@/modules/harness/surfaces/gridArcade";
import {
  GRID_GAMES,
  type GridGame,
} from "@/modules/harness/surfaces/gridGames";
import { drawSpeechBubble } from "@/modules/harness/surfaces/speechBubble";
import {
  HARNESS_ICONS,
  MONOCHROME_HARNESSES,
} from "@/modules/harness/chrome/HarnessIcon";
import { HARNESSES, type HarnessId } from "@/modules/harness/lib/session";
import {
  MASCOT_GRID,
  PROJECT_MASCOTS,
} from "@/modules/harness/lib/projectMascots";

const CELL = 6;
const GAP = 1;
const PITCH = CELL + GAP;
const BORDER_OPACITY = 0.08;
const PEAK_OPACITY = 0.88;
const LOGO_OPACITY = 0.8;
const BUBBLE_OPACITY = 0.95;
const PAC_OPACITY = 1;
const GHOST_OPACITY = 0.9;
const SPRITE_SCALE = 0.85;
const BUBBLE_EASE = 0.2;

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

const mascotPaths = new Map<string, { rest: Path2D; talk: Path2D }>();

function mascotArt(name: string) {
  const cached = mascotPaths.get(name);
  if (cached) return cached;
  const mascot = PROJECT_MASCOTS.find((it) => it.name === name);
  if (!mascot) return null;
  const art = {
    rest: new Path2D(mascot.restPath),
    talk: new Path2D(mascot.talkPath),
  };
  mascotPaths.set(name, art);
  return art;
}

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

function drawPacman(
  ctx: CanvasRenderingContext2D,
  sprite: ArcadeSprite,
  fill: string,
) {
  const px = sprite.cx * PITCH + CELL / 2;
  const py = sprite.cy * PITCH + CELL / 2;
  const radius = (sprite.size * PITCH * SPRITE_SCALE) / 2;
  const facing = Math.atan2(sprite.dy, sprite.dx);
  const mouth = sprite.mouth * Math.PI;

  ctx.fillStyle = fill;
  ctx.beginPath();
  if (mouth <= 0.01) {
    ctx.arc(px, py, radius, 0, Math.PI * 2);
  } else {
    ctx.moveTo(px, py);
    ctx.arc(px, py, radius, facing + mouth, facing - mouth + Math.PI * 2);
    ctx.closePath();
  }
  ctx.fill();
}

function drawGhost(
  ctx: CanvasRenderingContext2D,
  sprite: ArcadeSprite,
  fill: string,
) {
  const span = sprite.size * PITCH * SPRITE_SCALE;
  const left = sprite.cx * PITCH + CELL / 2 - span / 2;
  const top = sprite.cy * PITCH + CELL / 2 - span / 2;
  const unit = span / MASCOT_GRID;

  ctx.fillStyle = fill;
  if (sprite.eyes) {
    const lean = {
      x: Math.sign(sprite.dx) * unit * 0.6,
      y: Math.sign(sprite.dy) * unit * 0.6,
    };
    for (const offset of [2, 5]) {
      ctx.fillRect(
        left + offset * unit + lean.x,
        top + 3 * unit + lean.y,
        unit,
        unit * 1.5,
      );
    }
    return;
  }

  const art = sprite.mascot ? mascotArt(sprite.mascot) : null;
  if (!art) {
    ctx.beginPath();
    ctx.arc(
      sprite.cx * PITCH + CELL / 2,
      sprite.cy * PITCH + CELL / 2,
      span / 2,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    return;
  }

  const path = sprite.frame === "talk" ? art.talk : art.rest;
  ctx.save();
  ctx.translate(left, top);
  ctx.scale(unit, unit);
  ctx.fill(path);
  ctx.restore();
}

function drawSprite(
  ctx: CanvasRenderingContext2D,
  sprite: ArcadeSprite,
  fill: string,
  offsetX: number,
  offsetY: number,
  cols: number,
  rows: number,
) {
  const adjusted: ArcadeSprite = {
    ...sprite,
    cx: sprite.cx + offsetX / PITCH,
    cy: sprite.cy + offsetY / PITCH,
  };
  const render = sprite.kind === "pacman" ? drawPacman : drawGhost;
  render(ctx, adjusted, fill);

  // Seamless wrap-around rendering when crossing boundaries
  const radiusCells = (sprite.size * SPRITE_SCALE) / 2;

  if (sprite.cx < radiusCells) {
    render(ctx, { ...adjusted, cx: adjusted.cx + cols }, fill);
  } else if (sprite.cx > cols - radiusCells) {
    render(ctx, { ...adjusted, cx: adjusted.cx - cols }, fill);
  }

  if (sprite.cy < radiusCells) {
    render(ctx, { ...adjusted, cy: adjusted.cy + rows }, fill);
  } else if (sprite.cy > rows - radiusCells) {
    render(ctx, { ...adjusted, cy: adjusted.cy - rows }, fill);
  }
}

type Props = {
  onClose: () => void;
};

export function FloatingArcadeWidget({ onClose }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const arcadeRef = useRef<GridArcade | null>(null);
  const [gameIndex, setGameIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(3);
  const [mode, setMode] = useState<ArcadeMode>("mid");
  const [isOver, setIsOver] = useState(false);

  const currentGame: GridGame = GRID_GAMES[gameIndex] ?? GRID_GAMES[0]!;

  const restartGame = useCallback(() => {
    const arcade = currentGame.create();
    arcade.setMode(mode);
    arcade.takeControl();
    arcadeRef.current = arcade;
    setIsOver(false);
    setScore(0);
    setLives(arcade.lives());
  }, [currentGame, mode]);

  useEffect(() => {
    restartGame();
  }, [restartGame]);

  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

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
    const rgb = parseContentRgb();
    const surfaceRgb = parseSurfaceRgb();
    let lastFrame = 0;
    let bubbleAt: { x: number; y: number } | null = null;

    const layout = () => {
      const { width, height } = canvas.getBoundingClientRect();
      if (width <= 0 || height <= 0) return;

      const dpr = window.devicePixelRatio || 1;
      const nextCols = Math.floor(width / PITCH);
      const nextRows = Math.floor(height / PITCH);

      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      arcadeRef.current?.resize(nextCols, nextRows);
      cols = nextCols;
      rows = nextRows;
    };

    layout();
    const resizeObserver = new ResizeObserver(layout);
    resizeObserver.observe(canvas);

    const draw = (time: number) => {
      if (document.hidden) {
        raf = requestAnimationFrame(draw);
        return;
      }
      if (!lastFrame) lastFrame = time;
      const dt = Math.min(time - lastFrame, 100);
      lastFrame = time;

      const arcade = arcadeRef.current;
      if (arcade && cols > 0 && rows > 0) {
        arcade.step(dt);
        const { width, height } = canvas.getBoundingClientRect();
        const offsetX = Math.max(0, Math.floor((width - cols * PITCH) / 2));
        const offsetY = Math.max(0, Math.floor((height - rows * PITCH) / 2));

        const stamp = new Float32Array(cols * rows);
        arcade.stamp(stamp, cols, rows);
        const fade = arcade.fade();

        ctx.clearRect(0, 0, width, height);
        ctx.lineWidth = 1;
        ctx.strokeStyle = `rgba(${rgb}, ${BORDER_OPACITY * fade})`;

        for (let y = 0; y < rows; y++) {
          for (let x = 0; x < cols; x++) {
            const px = offsetX + x * PITCH;
            const py = offsetY + y * PITCH;
            const fillOpacity = (stamp[y * cols + x] ?? 0) * PEAK_OPACITY;
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
          const span = pickup.cells * PITCH - GAP;
          const dx = offsetX + pickup.x * PITCH;
          const dy = offsetY + pickup.y * PITCH;
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

        for (const sprite of arcade.sprites()) {
          const opacity =
            sprite.alpha *
            (sprite.kind === "pacman" ? PAC_OPACITY : GHOST_OPACITY);
          if (opacity <= 0.02) continue;
          const fill =
            sprite.kind === "pacman"
              ? "#facc15" // Classic glowing yellow pacman
              : `rgba(${rgb}, ${opacity})`;
          drawSprite(ctx, sprite, fill, offsetX, offsetY, cols, rows);
        }

        const bubble = arcade.speechBubble();
        if (bubble) {
          const target = {
            x: offsetX + bubble.x * PITCH,
            y: offsetY + bubble.y * PITCH,
          };
          const wrapped =
            bubbleAt && Math.abs(target.x - bubbleAt.x) > width / 3;
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
        } else {
          bubbleAt = null;
        }

        setScore(arcade.score());
        setLives(arcade.lives());
        setIsOver(arcade.gameOver());
      }

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
    };
  }, [gameIndex]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }

      if (isOver && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        event.stopPropagation();
        restartGame();
        return;
      }

      const heading = HEADING[event.key] ?? HEADING[event.key.toLowerCase()];
      if (heading) {
        event.preventDefault();
        event.stopPropagation();
        arcadeRef.current?.steer(heading.x, heading.y);
      }
    };

    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
    };
  }, [isOver, onClose, restartGame]);

  return (
    <div
      ref={rootRef}
      tabIndex={0}
      role="region"
      aria-label="Arcade Mini Window"
      className="fixed bottom-8 right-3 z-50 flex h-[360px] w-[440px] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-xl border border-border/60 bg-popover/95 text-popover-foreground shadow-2xl backdrop-blur-xl outline-none ring-1 ring-border/20 transition-all animate-in fade-in zoom-in-95 duration-150"
    >
      {/* Header bar */}
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-border/40 px-3 bg-muted/20">
        <div className="flex items-center gap-2">
          <PacmanIcon size={16} className="text-yellow-400 shrink-0" />
          <div className="flex items-center gap-1 rounded-md bg-muted/60 p-0.5 text-xs font-mono">
            {GRID_GAMES.map((item, idx) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setGameIndex(idx)}
                className={cn(
                  "cursor-pointer rounded px-2 py-0.5 text-[11px] font-medium transition-colors",
                  gameIndex === idx
                    ? "bg-background text-foreground shadow-xs font-semibold"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 font-mono text-[11px] text-muted-foreground">
            <span className="font-semibold text-foreground">{score}</span>
            {currentGame.lives && (
              <span className="ml-1 text-yellow-400">
                {lives > 0 ? "●".repeat(lives) : "💀"}
              </span>
            )}
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="size-6 text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={restartGame}
            title="Reiniciar (Espacio / Enter)"
          >
            <HugeiconsIcon icon={Refresh01Icon} size={13} strokeWidth={1.75} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-6 text-muted-foreground hover:bg-accent hover:text-destructive"
            onClick={onClose}
            title="Cerrar (Esc)"
          >
            <HugeiconsIcon icon={Cancel01Icon} size={14} strokeWidth={1.75} />
          </Button>
        </div>
      </div>

      {/* Canvas Area */}
      <div
        className="relative min-h-0 flex-1 overflow-hidden bg-background-base/80 cursor-crosshair"
        onClick={() => rootRef.current?.focus()}
      >
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />

        {isOver && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-background/80 backdrop-blur-xs p-4 text-center">
            <p className="font-mono text-sm font-bold tracking-widest text-red-400 uppercase mb-1">
              Game Over
            </p>
            <p className="font-mono text-xs text-muted-foreground mb-3">
              Puntuación final: <span className="font-semibold text-foreground">{score}</span>
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={restartGame}
              className="h-7 text-xs font-medium cursor-pointer"
            >
              Jugar de nuevo (Enter)
            </Button>
          </div>
        )}
      </div>

      {/* Subtle Footer hint */}
      <div className="flex h-6.5 shrink-0 items-center justify-between border-t border-border/30 bg-muted/15 px-2.5 font-mono text-[10px] text-muted-foreground">
        <span>Usa ↑ ↓ ← → o WASD para jugar</span>
        <div className="flex items-center gap-1">
          {ARCADE_MODES.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setMode(m);
                arcadeRef.current?.setMode(m);
              }}
              className={cn(
                "cursor-pointer px-1 rounded hover:text-foreground transition-colors",
                mode === m ? "text-primary font-semibold" : "text-muted-foreground/60",
              )}
            >
              {m}
            </button>
          ))}
          <span className="text-muted-foreground/40 ml-1">· Esc</span>
        </div>
      </div>
    </div>
  );
}
