import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Clock01Icon,
  Delete02Icon,
  GlobalIcon,
  Link01Icon,
  Shield01Icon,
  WorkflowSquare01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useApiClientStore } from "../store/apiClientStore";
import { RequestEditor } from "./RequestEditor";
import { ResponseViewer } from "./ResponseViewer";
import { SandboxProbePanel } from "./SandboxProbePanel";
import { ScenarioRunner } from "./ScenarioRunner";

export function ApiClientView() {
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
            <span className="text-xs font-bold tracking-tight">API Client & Sandbox</span>
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
              <span>Request Builder</span>
            </Button>

            <Button
              size="sm"
              variant={activeTab === "sandbox" ? "secondary" : "ghost"}
              onClick={() => setActiveTab("sandbox")}
              className="h-6 gap-1 px-2 text-[11px] font-medium"
            >
              <HugeiconsIcon icon={Shield01Icon} size={12} />
              <span>Sandbox Probes</span>
            </Button>

            <Button
              size="sm"
              variant={activeTab === "scenarios" ? "secondary" : "ghost"}
              onClick={() => setActiveTab("scenarios")}
              className="h-6 gap-1 px-2 text-[11px] font-medium"
            >
              <HugeiconsIcon icon={WorkflowSquare01Icon} size={12} />
              <span>Scenarios</span>
            </Button>

            <Button
              size="sm"
              variant={activeTab === "history" ? "secondary" : "ghost"}
              onClick={() => setActiveTab("history")}
              className="h-6 gap-1 px-2 text-[11px] font-medium"
            >
              <HugeiconsIcon icon={Clock01Icon} size={12} />
              <span>History {history.length > 0 && `(${history.length})`}</span>
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-[10px] text-muted-foreground">
            Zero-CORS • Native Rust Engine
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

        {activeTab === "sandbox" && <SandboxProbePanel />}

        {activeTab === "scenarios" && <ScenarioRunner />}

        {activeTab === "history" && (
          <div className="flex h-full flex-col p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs font-semibold">Request History</span>
              {history.length > 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={clearHistory}
                  className="h-6 gap-1 text-[11px] text-muted-foreground hover:text-destructive"
                >
                  <HugeiconsIcon icon={Delete02Icon} size={12} /> Clear History
                </Button>
              )}
            </div>

            {history.length === 0 ? (
              <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground/60">
                No request history yet.
              </div>
            ) : (
              <div className="flex flex-col gap-1.5 overflow-y-auto">
                {history.map((item, idx) => (
                  <div
                    key={idx}
                    onClick={() => loadFromHistory(idx)}
                    className="flex cursor-pointer items-center justify-between rounded border border-border/50 bg-muted/20 p-2 text-xs transition-colors hover:bg-muted/50"
                  >
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="font-mono text-[10px] font-bold">
                        {item.request.method}
                      </Badge>
                      <span className="font-mono text-xs text-foreground">{item.request.url}</span>
                    </div>

                    <div className="flex items-center gap-2">
                      {item.response && (
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-[10px]",
                            item.response.status >= 200 && item.response.status < 300
                              ? "border-emerald-500/40 text-emerald-600"
                              : "border-rose-500/40 text-rose-600",
                          )}
                        >
                          {item.response.status}
                        </Badge>
                      )}
                      <span className="text-[10.5px] text-muted-foreground">
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
