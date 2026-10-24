import { lazy, Suspense, useEffect, useState, useContext, useLayoutEffect } from "react";
import { HarnessRestoreContext } from "@/modules/harness/hooks/harnessRestoreContext";
import { cn } from "@/lib/utils";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { useTranslation } from "@/modules/i18n";
import type { WorkspacePlacement } from "@/modules/spaces";
import type { HarnessTab, Tab } from "@/modules/tabs";
import { removeHarnessSurface } from "@/modules/surfaces";
import { useHarnessViewActivation } from "@/modules/harness/hooks/useHarnessViewActivation";
import { useHarnessViewCreation } from "@/modules/harness/hooks/useHarnessViewCreation";
import type { HarnessNavigationView } from "@/modules/harness/lib/harnessWindowNavigation";
import { HarnessTerminalOwner } from "@/modules/harness/hooks/harnessTerminalContext";
import { HARNESS_SELECT_PROJECT_EVENT, harnessProjectTargetMatches, parseHarnessProjectRequest, type HarnessProjectRequest } from "@/modules/surfaces/lib/harnessProjectRequest";

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
const LazyHarnessRuntime = lazy(() =>
  loadHarnessApp().then(async (m) => {
    const { loadHarnessRuntime } = await import("@/modules/harness/components/HarnessRuntimeBootstrap");
    return loadHarnessRuntime(m.HarnessRuntimeRoot);
  }),
);
const LazyNativeAiView = lazy(() =>
  import("./HarnessNativeAiView").then((module) => ({
    default: module.HarnessNativeAiView,
  })),
);

function HarnessWorkbench({
  tab,
  focused,
  visible,
  onActivate,
  projectRequest,
  onProjectRequestHandled,
  onRegistered,
  layoutKey,
}: {
  tab: HarnessTab;
  focused: boolean;
  visible: boolean;
  onActivate: () => boolean;
  projectRequest?: { path: string };
  onProjectRequestHandled: (request: { path: string }) => void;
  onRegistered: (view: HarnessNavigationView) => void;
  layoutKey?: string;
}) {
  const { t } = useTranslation();
  const restored = useContext(HarnessRestoreContext);
  const [bootView] = useState(() => restored && !restored.claimed.has(tab.tabKey)
    ? restored.views.get(tab.tabKey) : undefined);
  useLayoutEffect(() => { restored?.claimed.add(tab.tabKey); }, [restored, tab.tabKey]);
  const [view, setView] = useState<"harness" | "native">("harness");
  const activate = useHarnessViewActivation(
    focused && view === "harness",
    () => {
      setView("harness");
      onActivate();
    },
  );
  useEffect(() => {
    if (projectRequest) setView("harness");
  }, [projectRequest]);
  useEffect(() => () => removeHarnessSurface(tab.id), [tab.id]);
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
        <HarnessTerminalOwner
          value={{
            tabKey: tab.tabKey,
            visible: visible && view === "harness",
            layoutKey,
            onFocus: () => {
              setView("harness");
              onActivate();
            },
          }}
        >
          <LazyHarnessApp
            {...bootView}
            initialCwd={tab.cwd}
            initialSessionId={tab.sessionId}
            surfaceOwnerId={tab.id}
            visible={visible && view === "harness"}
            focused={focused && view === "harness"}
            onActivate={activate}
            projectRequest={projectRequest}
            onProjectRequestHandled={onProjectRequestHandled}
            onRegistered={onRegistered}
          />
        </HarnessTerminalOwner>
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
  onActivateTab?: (id: number) => void;
  onCreateTab?: () => number;
};

export function HarnessStack({
  tabs,
  activeId,
  placements,
  onActivateTab,
  onCreateTab,
}: Props) {
  const { t } = useTranslation();
  const creation = useHarnessViewCreation(tabs, onCreateTab);
  const harnessTabs = tabs.filter(
    (t): t is HarnessTab => t.kind === "harness" && !t.cold,
  );

  const [activated, setActivated] = useState(false);
  const [projectRequest, setProjectRequest] = useState<HarnessProjectRequest | null>(
    null,
  );
  useEffect(() => {
    const select = (event: Event) => {
      const request = parseHarnessProjectRequest((event as CustomEvent<unknown>).detail);
      if (request) setProjectRequest(request);
    };
    window.addEventListener(HARNESS_SELECT_PROJECT_EVENT, select);
    return () =>
      window.removeEventListener(HARNESS_SELECT_PROJECT_EVENT, select);
  }, []);
  useLayoutEffect(() => {
    const target = projectRequest?.target;
    if (target && !tabs.some((tab) => harnessProjectTargetMatches(target, tab))) {
      setProjectRequest(null);
    }
  }, [projectRequest, tabs]);
  useEffect(() => {
    if (harnessTabs.length > 0) setActivated(true);
  }, [harnessTabs.length]);
  if (!activated && harnessTabs.length === 0) return null;

  return (
    <div className="relative h-full w-full">
      <Suspense fallback={null}>
        <LazyHarnessRuntime createNavigationView={creation.create}
          initialOwnerId={activeId}
          viewIdentities={tabs.filter((tab) => tab.kind === "harness").map((tab) => ({ ownerId: tab.id, tabKey: tab.tabKey }))}>
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
                <ErrorBoundary
                  name="Harness"
                  fallback={(_error, reset) => (
                    <div
                      className="flex h-full flex-col items-center justify-center gap-3"
                      role="alert"
                    >
                      <p>{t("feedback.somethingWentWrong")}</p>
                      <button
                        type="button"
                        className="rounded border px-3 py-1"
                        onClick={reset}
                      >
                        {t("feedback.tryAgain")}
                      </button>
                    </div>
                  )}
                >
                  <Suspense
                    fallback={
                      <div className="h-full w-full bg-background flex items-center justify-center text-muted-foreground font-mono text-xs">
                        {t("harness.chrome.loadingAgentHarness")}
                      </div>
                    }
                  >
                    <HarnessWorkbench
                      layoutKey={
                        placement
                          ? `${placement.rect.x}:${placement.rect.y}:${placement.rect.width}:${placement.rect.height}`
                          : "standalone"
                      }
                      onRegistered={creation.registered}
                      tab={tab}
                      focused={visible && tab.id === activeId}
                      visible={visible}
                      onActivate={() => {
                        if (!tabs.some((current) => current.id === tab.id))
                          return false;
                        if (onActivateTab) onActivateTab(tab.id);
                        return !!onActivateTab || tab.id === activeId;
                      }}
                      projectRequest={
                        visible && tab.id === activeId &&
                        (!projectRequest?.target || harnessProjectTargetMatches(projectRequest.target, tab))
                          ? (projectRequest ?? undefined)
                          : undefined
                      }
                      onProjectRequestHandled={(request) =>
                        setProjectRequest((pending) =>
                          pending === request ? null : pending,
                        )
                      }
                    />
                  </Suspense>
                </ErrorBoundary>
              </div>
            );
          })}
        </LazyHarnessRuntime>
      </Suspense>
    </div>
  );
}
