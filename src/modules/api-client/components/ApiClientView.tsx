import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/modules/i18n";
import {
  ArrowDown01Icon,
  Clock01Icon,
  FlashIcon,
  GlobalIcon,
  Link01Icon,
  Menu01Icon,
  Shield01Icon,
  WorkflowSquare01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { lazy, Suspense } from "react";
import { useApiClientTabStore } from "../store/ApiClientStoreContext";

const LazyApiBrowserView = lazy(() =>
  import("./ApiBrowserView").then((module) => ({ default: module.ApiBrowserView })),
);
const LazyApiCollectionExplorer = lazy(() =>
  import("./ApiCollectionExplorer").then((module) => ({
    default: module.ApiCollectionExplorer,
  })),
);
const LazyApiHistoryView = lazy(() =>
  import("./ApiHistoryView").then((module) => ({ default: module.ApiHistoryView })),
);
const LazyRequestEditor = lazy(() =>
  import("./RequestEditor").then((module) => ({ default: module.RequestEditor })),
);
const LazyResponseViewer = lazy(() =>
  import("./ResponseViewer").then((module) => ({ default: module.ResponseViewer })),
);
const LazySandboxProbePanel = lazy(() =>
  import("./SandboxProbePanel").then((module) => ({
    default: module.SandboxProbePanel,
  })),
);
const LazyScenarioRunner = lazy(() =>
  import("./ScenarioRunner").then((module) => ({ default: module.ScenarioRunner })),
);

export function ApiClientView() {
  const { t } = useTranslation();
  const {
    activeTab,
    setActiveTab,
    history,
    sidebarCollapsed,
    toggleSidebar,
    environments,
    activeEnvironmentId,
    setEnvironment,
    activeRequest,
  } = useApiClientTabStore();

  const activeEnv =
    environments.find((e) => e.id === activeEnvironmentId) || environments[0];

  const envColorMap: Record<string, string> = {
    red: "bg-rose-500 text-rose-500",
    yellow: "bg-amber-500 text-amber-500",
    green: "bg-emerald-500 text-emerald-500",
    blue: "bg-blue-500 text-blue-500",
    zinc: "bg-zinc-400 text-zinc-400",
  };

  return (
    <div className="flex h-full w-full flex-col bg-background text-foreground" dir="ltr">
      {/* Top Header & Navigation Modes */}
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-border/60 bg-muted/20 px-2.5">
        <div className="flex items-center gap-2 overflow-hidden">
          <Button
            size="icon"
            variant="ghost"
            onClick={toggleSidebar}
            className="size-7 text-muted-foreground hover:text-foreground"
            title={t("apiClient.header.toggleCollectionsSidebar")}
          >
            <HugeiconsIcon icon={Menu01Icon} size={14} />
          </Button>

          <div className="flex items-center gap-1.5 text-primary">
            <HugeiconsIcon icon={GlobalIcon} size={15} strokeWidth={2} />
            <span className="text-xs font-bold tracking-tight">
              {t("apiClient.header.title")}
            </span>
          </div>

          {activeRequest.name && (
            <>
              <span className="text-muted-foreground/40 font-mono text-xs">/</span>
              <span className="max-w-[200px] truncate text-xs font-medium text-muted-foreground">
                {activeRequest.name}
              </span>
            </>
          )}

          <div className="h-4 w-px bg-border/60" />

          {/* Mode Switcher */}
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant={activeTab === "request" ? "secondary" : "ghost"}
              onClick={() => setActiveTab("request")}
              className="h-6 gap-1 px-2 text-[11px] font-medium"
            >
              <HugeiconsIcon icon={Link01Icon} size={12} />
              <span>{t("apiClient.header.requestBuilder")}</span>
            </Button>

            <Button
              size="sm"
              variant={activeTab === "browser" ? "secondary" : "ghost"}
              onClick={() => setActiveTab("browser")}
              className="h-6 gap-1 px-2 text-[11px] font-medium"
            >
              <HugeiconsIcon icon={FlashIcon} size={12} />
              <span>{t("apiClient.header.apiBrowser")}</span>
            </Button>

            <Button
              size="sm"
              variant={activeTab === "sandbox" ? "secondary" : "ghost"}
              onClick={() => setActiveTab("sandbox")}
              className="h-6 gap-1 px-2 text-[11px] font-medium"
            >
              <HugeiconsIcon icon={Shield01Icon} size={12} />
              <span>{t("apiClient.header.sandboxProbes")}</span>
            </Button>

            <Button
              size="sm"
              variant={activeTab === "scenarios" ? "secondary" : "ghost"}
              onClick={() => setActiveTab("scenarios")}
              className="h-6 gap-1 px-2 text-[11px] font-medium"
            >
              <HugeiconsIcon icon={WorkflowSquare01Icon} size={12} />
              <span>{t("apiClient.header.scenarios")}</span>
            </Button>

            <Button
              size="sm"
              variant={activeTab === "history" ? "secondary" : "ghost"}
              onClick={() => setActiveTab("history")}
              className="h-6 gap-1 px-2 text-[11px] font-medium"
            >
              <HugeiconsIcon icon={Clock01Icon} size={12} />
              <span>
                {t("apiClient.header.history")} {history.length > 0 && `(${history.length})`}
              </span>
            </Button>
          </div>
        </div>

        {/* Right Environment Dropdown & Badges */}
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-6 gap-1.5 px-2 text-[11px] font-medium"
              >
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    envColorMap[activeEnv?.color || "blue"]?.split(" ")[0] || "bg-blue-500",
                  )}
                />
                <span>{activeEnv?.name || t("apiClient.header.environment")}</span>
                <HugeiconsIcon icon={ArrowDown01Icon} size={11} className="text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44 text-xs">
              <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase">
                {t("apiClient.header.environments")}
              </div>
              {environments.map((env) => (
                <DropdownMenuItem
                  key={env.id}
                  onClick={() => setEnvironment(env.id)}
                  className="flex items-center justify-between"
                >
                  <div className="flex items-center gap-1.5">
                    <span
                      className={cn(
                        "size-1.5 rounded-full",
                        envColorMap[env.color]?.split(" ")[0] || "bg-blue-500",
                      )}
                    />
                    <span>{env.name}</span>
                  </div>
                  {env.id === activeEnvironmentId && (
                    <span className="text-[10px] text-primary">{t("apiClient.header.active")}</span>
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <Badge variant="outline" className="hidden sm:inline-flex text-[10px] text-muted-foreground">
            {t("apiClient.header.zeroCorsBadge")}
          </Badge>
        </div>
      </div>

      {/* Main Workspace Area with 3-Column Resizable Panels */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {activeTab === "request" && (
          <ResizablePanelGroup orientation="horizontal" className="h-full w-full">
            {!sidebarCollapsed && (
              <>
                <ResizablePanel defaultSize="20%" minSize="14%" maxSize="32%">
                  <Suspense fallback={null}>
                    <LazyApiCollectionExplorer />
                  </Suspense>
                </ResizablePanel>
                <ResizableHandle />
              </>
            )}

            <ResizablePanel
              defaultSize={sidebarCollapsed ? "50%" : "42%"}
              minSize="25%"
            >
              <Suspense fallback={null}>
                <LazyRequestEditor />
              </Suspense>
            </ResizablePanel>

            <ResizableHandle />

            <ResizablePanel
              defaultSize={sidebarCollapsed ? "50%" : "38%"}
              minSize="25%"
            >
              <Suspense fallback={null}>
                <LazyResponseViewer />
              </Suspense>
            </ResizablePanel>
          </ResizablePanelGroup>
        )}

        {activeTab === "browser" && (
          <Suspense fallback={null}>
            <LazyApiBrowserView />
          </Suspense>
        )}

        {activeTab === "sandbox" && (
          <Suspense fallback={null}>
            <LazySandboxProbePanel />
          </Suspense>
        )}

        {activeTab === "scenarios" && (
          <Suspense fallback={null}>
            <LazyScenarioRunner />
          </Suspense>
        )}

        {activeTab === "history" && (
          <Suspense fallback={null}>
            <LazyApiHistoryView />
          </Suspense>
        )}
      </div>
    </div>
  );
}
