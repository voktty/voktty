import { lazy, Suspense, useState } from "react";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/modules/i18n";
import type { WorkspacePlacement } from "@/modules/spaces";
import type { HarnessTab, Tab } from "@/modules/tabs";

import { markHarnessOpenPhase } from "../lib/openTiming";

export function preloadHarnessApp() {
  void loadHarnessApp();
}

// Marks bracket the dynamic import so its fetch-and-evaluate cost is separable
// from the render and the mount work that follow it.
function loadHarnessApp() {
  markHarnessOpenPhase("requested");
  return import("./HarnessApp").then((m) => {
    markHarnessOpenPhase("loaded");
    return m;
  });
}

const LazyHarnessApp = lazy(() =>
  loadHarnessApp().then((m) => ({
    default: m.HarnessApp,
  })),
);
const LazyNativeAiView = lazy(() =>
  import("./HarnessNativeAiView").then((module) => ({
    default: module.HarnessNativeAiView,
  })),
);

function HarnessWorkbench({
  tab,
  focused,
}: {
  tab: HarnessTab;
  focused: boolean;
}) {
  const { t } = useTranslation();
  const [view, setView] = useState<"harness" | "native">("harness");
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        role="group"
        aria-label={t("harness.agentDevelopment")}
        className="flex shrink-0 gap-1 border-b border-border bg-background px-3 py-1.5"
      >
        {(["harness", "native"] as const).map((item) => (
          <button
            key={item}
            type="button"
            aria-pressed={view === item}
            onClick={() => setView(item)}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs",
              view === item
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:bg-muted/50",
            )}
          >
            {item === "harness"
              ? t("harness.agentDevelopment")
              : `Voktty ${t("shortcuts.groups.ai")}`}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1" hidden={view !== "harness"}>
        <LazyHarnessApp initialCwd={tab.cwd} initialSessionId={tab.sessionId} />
      </div>
      {view === "native" && (
        <div className="min-h-0 flex-1">
          {focused ? (
            <Suspense fallback={null}>
              <LazyNativeAiView onClose={() => setView("harness")} />
            </Suspense>
          ) : null}
        </div>
      )}
    </div>
  );
}

type Props = {
  tabs: Tab[];
  activeId: number;
  placements?: ReadonlyMap<number, WorkspacePlacement>;
};

export function HarnessStack({ tabs, activeId, placements }: Props) {
  const { t } = useTranslation();
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
                <div className="h-full w-full bg-background flex items-center justify-center text-muted-foreground font-mono text-xs">
                  {t("harness.chrome.loadingAgentHarness")}
                </div>
              }
            >
              <HarnessWorkbench
                tab={tab}
                focused={visible && tab.id === activeId}
              />
            </Suspense>
          </div>
        );
      })}
    </div>
  );
}
