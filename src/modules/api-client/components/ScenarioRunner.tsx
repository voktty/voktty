import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Copy01Icon,
  PlayIcon,
  WorkflowSquare01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";
import { toast } from "sonner";
import { generateScenarioMarkdownReceipt } from "../lib/markdownReceipt";
import { PRESET_SCENARIOS } from "../lib/presets";
import { useApiClientStore } from "../store/apiClientStore";
import type { ApiScenario } from "../types";

export function ScenarioRunner() {
  const { scenarioResult, isRunningScenario, executeScenario } = useApiClientStore();
  const [selectedScenario, setSelectedScenario] = useState<ApiScenario>(PRESET_SCENARIOS[0]);

  const handleRun = () => {
    void executeScenario(selectedScenario);
  };

  const handleCopyReceipt = () => {
    if (!scenarioResult) return;
    const receipt = generateScenarioMarkdownReceipt(scenarioResult);
    void navigator.clipboard.writeText(receipt);
    toast.success("Validation receipt copied to clipboard!");
  };

  return (
    <div className="grid h-full grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-border/50">
      {/* Left: Scenarios list & steps overview */}
      <div className="flex h-full flex-col overflow-y-auto p-3 bg-background/50">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <HugeiconsIcon icon={WorkflowSquare01Icon} size={15} className="text-primary" />
            <span className="text-xs font-semibold text-foreground">Integration Scenarios & Workflows</span>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          {PRESET_SCENARIOS.map((sc) => (
            <div
              key={sc.id}
              onClick={() => setSelectedScenario(sc)}
              className={cn(
                "flex cursor-pointer flex-col gap-1 rounded-lg border p-2.5 transition-colors",
                selectedScenario.id === sc.id
                  ? "border-primary bg-primary/5 shadow-xs"
                  : "border-border/60 bg-muted/20 hover:bg-muted/40",
              )}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-foreground">{sc.name}</span>
                <Badge variant="outline" className="text-[10px] uppercase">
                  {sc.service}
                </Badge>
              </div>
              <p className="text-[11px] text-muted-foreground">{sc.description}</p>
              <div className="mt-1 flex items-center gap-2 text-[10.5px] text-muted-foreground">
                <span>{sc.steps.length} sequential steps</span>
              </div>
            </div>
          ))}
        </div>

        {/* Steps of selected scenario */}
        <div className="mt-4 flex flex-col gap-2">
          <span className="text-[11px] font-semibold text-muted-foreground">Scenario Steps:</span>
          {selectedScenario.steps.map((st, i) => (
            <div key={st.id} className="flex items-center gap-2 rounded border border-border/40 bg-muted/10 p-2 text-xs">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                {i + 1}
              </span>
              <div className="flex flex-1 flex-col">
                <span className="font-medium text-foreground">{st.name}</span>
                <span className="text-[10px] text-muted-foreground">Kind: {st.kind}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 flex justify-end">
          <Button
            size="sm"
            disabled={isRunningScenario}
            onClick={handleRun}
            className="h-8 gap-1.5 px-4 text-xs font-semibold"
          >
            <HugeiconsIcon icon={PlayIcon} size={13} strokeWidth={2} />
            <span>{isRunningScenario ? "Running Scenario..." : "Run Scenario"}</span>
          </Button>
        </div>
      </div>

      {/* Right: Results & Validation Receipt */}
      <div className="flex h-full flex-col bg-background/50 p-3 overflow-y-auto">
        <div className="mb-2 flex items-center justify-between border-b border-border/50 pb-2">
          <span className="text-xs font-semibold text-foreground">Execution Receipt</span>
          {scenarioResult && (
            <Button size="sm" variant="ghost" onClick={handleCopyReceipt} className="h-6 gap-1 text-[10.5px]">
              <HugeiconsIcon icon={Copy01Icon} size={11} /> Copy Receipt (.md)
            </Button>
          )}
        </div>

        {!scenarioResult ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-muted-foreground/60">
            <HugeiconsIcon icon={WorkflowSquare01Icon} size={28} className="opacity-30" />
            <span className="text-xs font-medium">No scenario executed yet</span>
            <span className="max-w-xs text-[11px]">
              Run the scenario to generate deterministic before/after validation receipts for your integration.
            </span>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div
              className={cn(
                "flex flex-col gap-1 rounded-lg border p-3",
                scenarioResult.passed
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                  : "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300",
              )}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold">
                  {scenarioResult.passed ? "Scenario PASSED (VERIFIED)" : "Scenario FAILED (FIX NEEDED)"}
                </span>
                <Badge variant={scenarioResult.passed ? "default" : "destructive"} className="text-[10px]">
                  {scenarioResult.passedSteps}/{scenarioResult.totalSteps} passed
                </Badge>
              </div>
              <span className="text-[11px] opacity-80">
                Completed in {scenarioResult.totalDurationMs.toFixed(1)} ms
              </span>
            </div>

            {/* Steps Breakdown */}
            <div className="flex flex-col gap-2">
              <span className="text-[11px] font-semibold text-muted-foreground">Step Diagnostics:</span>
              {scenarioResult.stepResults.map((sr) => (
                <div
                  key={sr.stepId}
                  className="flex flex-col gap-1 rounded border border-border/50 bg-muted/20 p-2 text-xs"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-foreground">{sr.stepName}</span>
                    <Badge
                      variant={sr.passed ? "outline" : "destructive"}
                      className={cn("text-[10px]", sr.passed && "border-emerald-500/40 text-emerald-600")}
                    >
                      {sr.passed ? "Passed" : "Failed"} ({sr.durationMs.toFixed(1)}ms)
                    </Badge>
                  </div>
                  {sr.webhookResult && (
                    <p className="text-[11px] text-muted-foreground">{sr.webhookResult.summary}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
