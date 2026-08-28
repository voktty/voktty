import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { useAiAvailable } from "@/modules/ai/lib/runtimeAvailability";
import { useChatStore } from "@/modules/ai/store/chatStore";
import {
  Clock01Icon,
  Copy01Icon,
  DatabaseIcon,
  Download01Icon,
  SparklesIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";
import { toast } from "sonner";
import { useApiClientStore } from "../store/apiClientStore";

export function ResponseViewer() {
  const aiAvailable = useAiAvailable();
  const { activeResponse, activeRequest, isLoading, cancelRequest } = useApiClientStore();
  const [activeTab, setActiveTab] = useState<"body" | "headers" | "timings">("body");
  const [viewMode, setViewMode] = useState<"pretty" | "raw">("pretty");

  if (isLoading) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-background/50 p-6 text-muted-foreground">
        <div className="size-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <span className="text-xs">Executing request via native Rust engine...</span>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void cancelRequest()}
          className="h-7 text-xs text-rose-500 hover:text-rose-600 hover:bg-rose-500/10"
        >
          Cancel Request
        </Button>
      </div>
    );
  }

  if (!activeResponse) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 bg-background/50 p-6 text-center text-muted-foreground/60">
        <HugeiconsIcon icon={Download01Icon} size={28} strokeWidth={1.5} className="opacity-40" />
        <span className="text-xs font-medium">No response yet</span>
        <span className="max-w-xs text-[11px]">
          Enter a URL and click Send or press <kbd className="rounded bg-muted px-1.5 py-0.5 text-[10px]">Ctrl+Enter</kbd> to inspect the API output.
        </span>
      </div>
    );
  }

  const status = activeResponse.status;
  const is2xx = status >= 200 && status < 300;
  const is3xx = status >= 300 && status < 400;
  const is4xx = status >= 400 && status < 500;
  const is5xx = status >= 500 || status === 0;

  const statusColor = is2xx
    ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/30 dark:text-emerald-400"
    : is3xx
      ? "bg-blue-500/10 text-blue-600 border-blue-500/30 dark:text-blue-400"
      : is4xx
        ? "bg-amber-500/10 text-amber-600 border-amber-500/30 dark:text-amber-400"
        : "bg-rose-500/10 text-rose-600 border-rose-500/30 dark:text-rose-400";

  const formattedJson = (() => {
    if (!activeResponse.isJson) return null;
    try {
      if (typeof activeResponse.jsonValue !== "undefined") {
        return JSON.stringify(activeResponse.jsonValue, null, 2);
      }
      return JSON.stringify(JSON.parse(activeResponse.body), null, 2);
    } catch {
      return null;
    }
  })();

  const copyResponse = () => {
    void navigator.clipboard.writeText(formattedJson ?? activeResponse.body);
    toast.success("Response copied to clipboard");
  };

  const handleFixWithAi = () => {
    const prompt = `Help me debug and fix this API failure in my project:
- Endpoint: ${activeRequest.method} ${activeRequest.url}
- HTTP Status: ${status} ${activeResponse.statusText}
- Latency: ${activeResponse.timings.totalDurationMs.toFixed(1)}ms
- Request Body:
\`\`\`
${activeRequest.bodyContent || "(none)"}
\`\`\`
- Response Body:
\`\`\`
${activeResponse.body.slice(0, 1500)}
\`\`\`

Please search my workspace for where this route handler or webhook is implemented, pinpoint the root cause of the error, apply the code fix, and verify it works.`;

    const chat = useChatStore.getState();
    if (!chat.activeSessionId) {
      chat.newSession();
    }
    chat.openPanel();
    chat.focusInput(prompt);
  };

  return (
    <div className="flex h-full flex-col bg-background/50">
      {/* Response Header Status Bar */}
      <div className="flex items-center justify-between border-b border-border/50 px-3 py-2">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={cn("font-mono text-xs font-semibold", statusColor)}>
            {status === 0 ? "Network Error" : `${status} ${activeResponse.statusText}`}
          </Badge>
          <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <HugeiconsIcon icon={Clock01Icon} size={12} />
            <span>{activeResponse.timings.totalDurationMs.toFixed(1)} ms</span>
          </div>
          <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <HugeiconsIcon icon={DatabaseIcon} size={12} />
            <span>
              {activeResponse.bodyBytesLen < 1024
                ? `${activeResponse.bodyBytesLen} B`
                : `${(activeResponse.bodyBytesLen / 1024).toFixed(1)} KB`}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {/* AI Diagnostics Trigger for Errors / Investigations */}
          {aiAvailable && (
            <Button
              size="sm"
              variant={is4xx || is5xx ? "default" : "outline"}
              onClick={handleFixWithAi}
              className={cn(
                "h-6 gap-1 px-2 text-[10.5px] font-medium",
                (is4xx || is5xx) && "bg-gradient-to-r from-indigo-600 to-cyan-600 text-white hover:opacity-90",
              )}
            >
              <HugeiconsIcon icon={SparklesIcon} size={11} strokeWidth={2} />
              <span>{is4xx || is5xx ? "Diagnosticar con IA" : "Investigar con IA"}</span>
            </Button>
          )}

          <Button
            size="icon"
            variant="ghost"
            className="size-6 text-muted-foreground hover:text-foreground"
            onClick={copyResponse}
            title="Copy Response"
          >
            <HugeiconsIcon icon={Copy01Icon} size={12} />
          </Button>
        </div>
      </div>

      {/* Response Tabs */}
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as typeof activeTab)}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="flex items-center justify-between border-b border-border/40 px-3">
          <TabsList className="h-7 bg-transparent p-0">
            <TabsTrigger value="body" className="h-6 text-xs data-[state=active]:bg-muted">
              Body
            </TabsTrigger>
            <TabsTrigger value="headers" className="h-6 text-xs data-[state=active]:bg-muted">
              Headers ({activeResponse.headers.length})
            </TabsTrigger>
            <TabsTrigger value="timings" className="h-6 text-xs data-[state=active]:bg-muted">
              Timings
            </TabsTrigger>
          </TabsList>

          {activeTab === "body" && activeResponse.isJson && (
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => setViewMode("pretty")}
                className={cn(
                  "rounded px-1.5 py-0.5 text-[10px] font-medium",
                  viewMode === "pretty" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                Pretty
              </button>
              <button
                type="button"
                onClick={() => setViewMode("raw")}
                className={cn(
                  "rounded px-1.5 py-0.5 text-[10px] font-medium",
                  viewMode === "raw" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                Raw
              </button>
            </div>
          )}
        </div>

        {/* BODY */}
        <TabsContent value="body" className="m-0 min-h-0 flex-1 overflow-auto p-3">
          <pre className="font-mono text-[11.5px] leading-relaxed text-foreground" dir="ltr">
            {viewMode === "pretty" && formattedJson ? formattedJson : activeResponse.body}
          </pre>
        </TabsContent>

        {/* HEADERS */}
        <TabsContent value="headers" className="m-0 min-h-0 flex-1 overflow-auto p-2">
          <div className="flex flex-col divide-y divide-border/30">
            {activeResponse.headers.map(([k, v], idx) => (
              <div key={idx} className="flex py-1 text-xs">
                <span className="w-48 shrink-0 font-mono text-[11px] font-medium text-muted-foreground">{k}</span>
                <span className="min-w-0 flex-1 font-mono text-[11px] break-all text-foreground" dir="ltr">
                  {v}
                </span>
              </div>
            ))}
          </div>
        </TabsContent>

        {/* TIMINGS & NETWORK TIMELINE */}
        <TabsContent value="timings" className="m-0 min-h-0 flex-1 overflow-auto p-3">
          <div className="flex flex-col gap-3 text-xs">
            {/* Visual Timeline Bar */}
            {activeResponse.timings.firstByteMs && (
              <div className="flex flex-col gap-1.5 rounded-lg border border-border/40 bg-muted/20 p-2.5">
                <span className="text-[11px] font-semibold text-foreground">Network Phase Breakdown</span>
                <div className="flex h-2.5 w-full overflow-hidden rounded bg-muted/60">
                  <div
                    style={{
                      width: `${Math.max(
                        5,
                        Math.min(
                          95,
                          ((activeResponse.timings.firstByteMs || 0) /
                            (activeResponse.timings.totalDurationMs || 1)) *
                            100,
                        ),
                      )}%`,
                    }}
                    className="bg-indigo-500"
                    title={`TTFB: ${(activeResponse.timings.firstByteMs || 0).toFixed(1)}ms`}
                  />
                  <div
                    style={{
                      width: `${Math.max(
                        5,
                        Math.min(
                          95,
                          (((activeResponse.timings.downloadMs || 0) /
                            (activeResponse.timings.totalDurationMs || 1)) *
                            100),
                        ),
                      )}%`,
                    }}
                    className="bg-emerald-500"
                    title={`Content Download: ${(activeResponse.timings.downloadMs || 0).toFixed(1)}ms`}
                  />
                </div>
                <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                  <div className="flex items-center gap-1.5">
                    <span className="size-2 rounded-full bg-indigo-500" />
                    <span>TTFB (Server Processing)</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="size-2 rounded-full bg-emerald-500" />
                    <span>Content Download</span>
                  </div>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between border-b border-border/40 pb-1.5">
              <span className="text-muted-foreground">Time to First Byte (TTFB):</span>
              <span className="font-mono font-medium text-foreground">
                {activeResponse.timings.firstByteMs
                  ? `${activeResponse.timings.firstByteMs.toFixed(2)} ms`
                  : "N/A"}
              </span>
            </div>

            {activeResponse.timings.downloadMs && (
              <div className="flex items-center justify-between border-b border-border/40 pb-1.5">
                <span className="text-muted-foreground">Content Download Duration:</span>
                <span className="font-mono font-medium text-foreground">
                  {activeResponse.timings.downloadMs.toFixed(2)} ms
                </span>
              </div>
            )}

            <div className="flex items-center justify-between border-b border-border/40 pb-1.5">
              <span className="text-muted-foreground">Total Roundtrip Latency:</span>
              <span className="font-mono font-semibold text-emerald-500">
                {activeResponse.timings.totalDurationMs.toFixed(2)} ms
              </span>
            </div>

            <div className="flex items-center justify-between border-b border-border/40 pb-1.5">
              <span className="text-muted-foreground">Payload Size:</span>
              <span className="font-mono text-foreground">{activeResponse.bodyBytesLen} bytes</span>
            </div>

            <div className="flex items-center justify-between border-b border-border/40 pb-1.5">
              <span className="text-muted-foreground">Transport Engine:</span>
              <span className="font-mono text-emerald-500">Native Rust Async Engine (No CORS restrictions)</span>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
