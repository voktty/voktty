import { lazy, Suspense } from "react";
import { cn } from "@/lib/utils";
import type { WorkspacePlacement } from "@/modules/spaces";
import type { HarnessTab, Tab } from "@/modules/tabs";

export function preloadHarnessApp() {
  void import("./HarnessApp");
}

if (typeof window !== "undefined") {
  const schedule =
    typeof window.requestIdleCallback === "function"
      ? (cb: () => void) => window.requestIdleCallback(cb, { timeout: 2500 })
      : (cb: () => void) => setTimeout(cb, 1200);

  schedule(() => {
    preloadHarnessApp();
  });
}

const LazyHarnessApp = lazy(() =>
  import("./HarnessApp").then((m) => ({
    default: m.HarnessApp,
  })),
);

type Props = {
  tabs: Tab[];
  activeId: number;
  placements?: ReadonlyMap<number, WorkspacePlacement>;
};

export function HarnessStack({ tabs, activeId, placements }: Props) {
  const harnessTabs = tabs.filter(
    (t): t is HarnessTab => t.kind === "harness" && !t.cold,
  );

  if (harnessTabs.length === 0) return null;

  return (
    <div className="relative h-full w-full">
      {harnessTabs.map((tab) => {
        const placement = placements?.get(tab.id);
        const visible = placements
          ? placement !== undefined
          : tab.id === activeId;

        return (
          <div
            key={tab.id}
            data-space-slot={placement?.slotId}
            data-space-tab={tab.id}
            className={cn(
              "absolute inset-0",
              !visible && "invisible pointer-events-none",
            )}
            style={
              placement
                ? {
                    left: `${placement.rect.x * 100}%`,
                    top: `${placement.rect.y * 100}%`,
                    width: `${placement.rect.width * 100}%`,
                    height: `${placement.rect.height * 100}%`,
                    pointerEvents: "auto",
                  }
                : { inset: 0, pointerEvents: visible ? "auto" : "none" }
            }
            aria-hidden={!visible}
          >
            <Suspense
              fallback={
                <div className="h-full w-full bg-[#121215] flex items-center justify-center text-zinc-500 font-mono text-xs">
                  Loading agent harness...
                </div>
              }
            >
              <LazyHarnessApp
                initialCwd={tab.cwd}
                initialSessionId={tab.sessionId}
              />
            </Suspense>
          </div>
        );
      })}
    </div>
  );
}
