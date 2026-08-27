import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/modules/i18n";
import {
  Clock01Icon,
  Delete02Icon,
  FlashIcon,
  GlobalIcon,
  Link01Icon,
  Shield01Icon,
  WorkflowSquare01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useApiClientStore } from "../store/apiClientStore";
import { ApiBrowserView } from "./ApiBrowserView";
import { RequestEditor } from "./RequestEditor";
import { ResponseViewer } from "./ResponseViewer";
import { SandboxProbePanel } from "./SandboxProbePanel";
import { ScenarioRunner } from "./ScenarioRunner";

export function ApiClientView() {
  const { t } = useTranslation();
  const {
    activeTab,
    setActiveTab,
    history,
    loadFromHistory,
    clearHistory,
  } = useApiClientStore();

  return (
    <div className="flex h-full w-full flex-col bg-background text-foreground" dir="ltr">
      {/* Top Header & Navigation Modes */}
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-border/60 bg-muted/20 px-3">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 text-primary">
            <HugeiconsIcon icon={GlobalIcon} size={15} strokeWidth={2} />
            <span className="text-xs font-bold tracking-tight">
              {t("apiClient.header.title")}
            </span>
          </div>

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

        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-[10px] text-muted-foreground">
            {t("apiClient.header.zeroCorsBadge")}
          </Badge>
        </div>
      </div>

      {/* Main Workspace Area */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {activeTab === "request" && (
          <div className="grid h-full grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-border/50">
            <RequestEditor />
            <ResponseViewer />
          </div>
        )}

        {activeTab === "browser" && <ApiBrowserView />}

        {activeTab === "sandbox" && <SandboxProbePanel />}

        {activeTab === "scenarios" && <ScenarioRunner />}

        {activeTab === "history" && (
          <div className="flex h-full flex-col p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs font-semibold">{t("apiClient.header.history")}</span>
              {history.length > 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={clearHistory}
                  className="h-6 gap-1 px-2 text-[11px] text-destructive hover:bg-destructive/10"
                >
                  <HugeiconsIcon icon={Delete02Icon} size={12} />
                  <span>{t("apiClient.header.clearHistory")}</span>
                </Button>
              )}
            </div>

            {history.length === 0 ? (
              <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
                {t("apiClient.header.noHistory")}
              </div>
            ) : (
              <div className="flex flex-col gap-2 overflow-auto">
                {history.map((item, index) => (
                  <div
                    key={`${item.request.id}-${item.timestamp}-${index}`}
                    onClick={() => loadFromHistory(index)}
                    className="flex cursor-pointer items-center justify-between rounded border border-border/40 bg-muted/20 p-2 text-xs transition-colors hover:border-primary/40 hover:bg-muted/40"
                  >
                    <div className="flex items-center gap-2 overflow-hidden">
                      <span className="font-mono font-bold text-primary">
                        {item.request.method}
                      </span>
                      <span className="truncate font-mono text-muted-foreground">
                        {item.request.url}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      {item.response && (
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-[10px]",
                            item.response.status >= 200 && item.response.status < 300
                              ? "text-emerald-500 border-emerald-500/30"
                              : "text-rose-500 border-rose-500/30",
                          )}
                        >
                          {item.response.status}
                        </Badge>
                      )}
                      <span className="text-[10px] text-muted-foreground">
                        {new Date(item.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
