import { useLayoutEffect, useMemo, useRef, type RefObject } from "react";
import { createPortal } from "react-dom";
import {
  COIN_EDGE_PATH,
  COIN_FACE_PATH,
  COIN_HOVER,
  COIN_SIZE,
  COLLECT_POP_MS,
  COLLECT_POP_PX,
  EXIT_MS,
  EXIT_SINK,
  coinCollected,
  exitJumpY,
  jumpHeight,
  nextCoinDelay,
  obstacleFromRects,
  pickCoinX,
  RUNNER_INSET,
  RUNNER_SIZE,
  poseAt,
  scaleTrackX,
  stepAlong,
  runnerTrack,
  spriteClipBottom,
  type Coin,
} from "../lib/composerRunner";
import { projectName } from "../lib/paths";
import {
  loadTabGroupColors,
  loadTabGroupCustomColors,
  loadTabGroupMascots,
  resolveTabGroupColor,
  resolveTabGroupMascot,
} from "../lib/tabGroups";
import { ProjectMascot } from "./ProjectMascot";

type Props = {
  boxRef: RefObject<HTMLElement | null>;
  cwd: string;
  busy: boolean;
  enabled?: boolean;
  onExited: () => void;
};

type LiveCoin = Coin & {
  el: HTMLDivElement;
  collectedAt: number | null;
};

const COIN_SVG = `<svg viewBox="0 0 8 8" width="${COIN_SIZE}" height="${COIN_SIZE}" shape-rendering="crispEdges" fill="#e8b923" aria-hidden="true"><path class="composer-coin-face" d="${COIN_FACE_PATH}"/><path class="composer-coin-edge" d="${COIN_EDGE_PATH}"/></svg>`;

/** Project pixel mascot running the composer's top ledge while a turn is live. */
export function ComposerRunner({
  boxRef,
  cwd,
  busy,
  enabled = true,
  onExited,
}: Props) {
  const layerRef = useRef<HTMLDivElement>(null);
  const spriteRef = useRef<HTMLDivElement>(null);
  const coinsRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef(busy);
  const enabledRef = useRef(enabled);
  const onExitedRef = useRef(onExited);
  busyRef.current = busy;
  enabledRef.current = enabled;
  onExitedRef.current = onExited;

  const project = projectName(cwd);
  const appearance = useMemo(() => {
    return {
      name: resolveTabGroupMascot(project, loadTabGroupMascots()),
      color: resolveTabGroupColor(
        project,
        loadTabGroupColors(),
        loadTabGroupCustomColors(),
      ),
    };
  }, [project]);

  useLayoutEffect(() => {
    const layer = layerRef.current;
    const sprite = spriteRef.current;
    const coinLayer = coinsRef.current;
    if (!layer || !sprite || !coinLayer) return;

    let along = 0;
    let facing: 1 | -1 = 1;
    let prevWidth = 0;
    let last = performance.now();
    let raf = 0;
    let coinId = 0;
    let nextCoinAt = last + nextCoinDelay(true);
    let exiting = false;
    let exitAt = 0;
    let frozenX = 0;
    let frozenFacing: 1 | -1 = 1;
    let finished = false;
    const coins: LiveCoin[] = [];
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    const showLayer = (shown: boolean) => {
      layer.style.visibility = shown ? "visible" : "hidden";
    };
    showLayer(false);

    const placeSprite = (
      boxLeft: number,
      boxTop: number,
      x: number,
      y: number,
      facing: 1 | -1,
    ) => {
      sprite.style.setProperty(
        "--runner-x",
        `${Math.round(boxLeft + x - RUNNER_SIZE / 2)}px`,
      );
      sprite.style.setProperty(
        "--runner-y",
        `${Math.round(boxTop - RUNNER_SIZE - y + 1)}px`,
      );
      sprite.style.setProperty("--runner-facing", String(facing));
      sprite.style.setProperty("--runner-clip", `${spriteClipBottom(y)}px`);
    };

    const clearCoins = () => {
      for (const coin of coins) coin.el.remove();
      coins.length = 0;
    };

    const apply = (now: number) => {
      const dt = Math.min(now - last, 48);
      last = now;

      const box = boxRef.current;
      if (!enabledRef.current) {
        showLayer(false);
        if (!busyRef.current && !finished) {
          finished = true;
          clearCoins();
          onExitedRef.current();
        }
        return;
      }
      if (!box || document.hidden) {
        showLayer(false);
        return;
      }

      const shell = box.closest("[data-composer]");
      const review = shell?.querySelector("[data-session-review]");
      const track = runnerTrack(
        box.getBoundingClientRect(),
        review?.getBoundingClientRect() ?? null,
      );
      if (track.width <= 0) {
        showLayer(false);
        return;
      }
      showLayer(true);

      const insetTrack = Math.max(0, track.width - RUNNER_INSET * 2);
      if (prevWidth > 0 && prevWidth !== track.width) {
        const prevInset = Math.max(0, prevWidth - RUNNER_INSET * 2);
        along = scaleTrackX(along, prevInset, insetTrack);
        frozenX = scaleTrackX(frozenX, prevWidth, track.width);
        for (const coin of coins) {
          coin.x = scaleTrackX(coin.x, prevWidth, track.width);
        }
      }
      prevWidth = track.width;

      if (busyRef.current) {
        if (exiting) exiting = false;
        finished = false;
        if (!reduced) {
          const stepped = stepAlong(along, facing, dt, insetTrack);
          along = stepped.along;
          facing = stepped.facing;
        }
      } else if (!exiting && !finished) {
        exiting = true;
        exitAt = now;
        const current = poseAt(along, facing, track.width, null, []);
        frozenX = current.x;
        frozenFacing = current.facing;
        for (const coin of coins) {
          if (coin.collectedAt == null) coin.collectedAt = now;
        }
      }

      if (exiting) {
        const t = reduced ? 1 : Math.min(1, (now - exitAt) / EXIT_MS);
        const y = reduced ? -EXIT_SINK : exitJumpY(t);
        placeSprite(track.left, track.top, frozenX, y, frozenFacing);
        for (const coin of [...coins]) {
          const pop = Math.min(1, (now - (coin.collectedAt ?? now)) / COLLECT_POP_MS);
          coin.el.style.opacity = String(1 - pop);
          if (pop >= 1) {
            coin.el.remove();
            coins.splice(coins.indexOf(coin), 1);
          }
        }
        if (t >= 1 && !finished) {
          finished = true;
          clearCoins();
          onExitedRef.current();
        }
        return;
      }

      const pane = box.closest("[data-session-drop]");
      const button = pane?.querySelector("[data-jump-to-bottom]");
      const obstacle = obstacleFromRects(
        {
          left: track.left,
          right: track.left + track.width,
          top: track.top,
          bottom: track.top + 8,
          width: track.width,
        },
        button?.getBoundingClientRect() ?? null,
      );
      for (const coin of coins) {
        if (
          coin.collectedAt == null &&
          (coin.x < RUNNER_INSET || coin.x > track.width - RUNNER_INSET)
        ) {
          coin.collectedAt = now;
        }
      }
      // Keep grabbed coins in the pose so the hop finishes instead of snapping
      // back to the rim the frame they are collected.
      const pose = poseAt(along, facing, track.width, obstacle, coins);
      const hasLive = coins.some((coin) => coin.collectedAt == null);

      if (!reduced && !hasLive && now >= nextCoinAt) {
        const x = pickCoinX(track.width, pose.x, obstacle);
        if (x != null) {
          const el = document.createElement("div");
          el.className = "absolute top-0 left-0";
          el.style.width = `${COIN_SIZE}px`;
          el.style.height = `${COIN_SIZE}px`;
          el.style.transform =
            "translate3d(var(--coin-x, -64px), var(--coin-y, -64px), 0)";
          el.style.filter = "drop-shadow(0 1px 0 rgba(0,0,0,0.45))";
          el.innerHTML = COIN_SVG;
          coinLayer.append(el);
          coins.push({
            id: ++coinId,
            x,
            height: COIN_HOVER,
            el,
            collectedAt: null,
          });
        } else {
          nextCoinAt = now + 2000;
        }
      }

      for (const coin of [...coins]) {
        if (coin.collectedAt == null && coinCollected(pose, coin)) {
          coin.collectedAt = now;
          nextCoinAt = now + nextCoinDelay(false);
        }

        const bob =
          coin.collectedAt == null ? Math.sin(now / 180) * 2 : 0;
        const pop =
          coin.collectedAt == null
            ? 0
            : Math.min(1, (now - coin.collectedAt) / COLLECT_POP_MS);
        coin.el.style.setProperty(
          "--coin-x",
          `${Math.round(track.left + coin.x - COIN_SIZE / 2)}px`,
        );
        coin.el.style.setProperty(
          "--coin-y",
          `${Math.round(track.top - coin.height - COIN_SIZE / 2 - bob - COLLECT_POP_PX * pop)}px`,
        );
        coin.el.style.opacity = String(1 - pop);
        if (pop >= 1) coin.el.remove();
        if (pop >= 1 && jumpHeight(pose.x, null, [coin]) <= 0.5) {
          coins.splice(coins.indexOf(coin), 1);
        }
      }

      placeSprite(track.left, track.top, pose.x, pose.y, pose.facing);
    };

    apply(last);
    const tick = (now: number) => {
      apply(now);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      clearCoins();
      showLayer(false);
    };
  }, [boxRef]);

  return createPortal(
    <div
      ref={layerRef}
      aria-hidden
      className="pointer-events-none fixed inset-0 z-40 overflow-visible"
      style={{ visibility: "hidden" }}
    >
      <div ref={coinsRef} className="absolute inset-0" />
      <div
        ref={spriteRef}
        className="absolute top-0 left-0 origin-bottom drop-shadow-[0_1px_0_rgba(0,0,0,0.45)] will-change-transform"
        style={{
          width: RUNNER_SIZE,
          height: RUNNER_SIZE,
          transform:
            "translate3d(var(--runner-x, -64px), var(--runner-y, -64px), 0) scaleX(var(--runner-facing, 1))",
          clipPath: "inset(0 0 var(--runner-clip, 0px) 0)",
        }}
      >
        <ProjectMascot
          project={project}
          name={appearance.name}
          color={appearance.color}
          className="size-4"
          active
        />
      </div>
    </div>,
    document.body,
  );
}
