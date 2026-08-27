import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  ArrowRight01Icon,
  Copy01Icon,
  FlashIcon,
  GlobalIcon,
  Loading03Icon,
  LockIcon,
  Search01Icon,
  Shield01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useApiClientStore } from "../store/apiClientStore";
import type { ApiMethod } from "../types";

const METHOD_BADGES: Record<ApiMethod, string> = {
  GET: "bg-emerald-500/10 text-emerald-500 border-emerald-500/30",
  POST: "bg-blue-500/10 text-blue-500 border-blue-500/30",
  PUT: "bg-amber-500/10 text-amber-500 border-amber-500/30",
  PATCH: "bg-orange-500/10 text-orange-500 border-orange-500/30",
  DELETE: "bg-rose-500/10 text-rose-500 border-rose-500/30",
  HEAD: "bg-purple-500/10 text-purple-500 border-purple-500/30",
  OPTIONS: "bg-zinc-500/10 text-zinc-500 border-zinc-500/30",
};

const FAST_TARGETS = [
  { name: "ForgeNEX CRM", url: "https://forgenex.nexgestion.es/api/v1" },
  { name: "Ollama LLM (11434)", url: "http://localhost:11434/api" },
  { name: "Docker Daemon (2375)", url: "http://localhost:2375" },
  { name: "OpenAI / LocalAI (v1)", url: "http://localhost:8000/v1" },
];

export function ApiBrowserView() {
  const {
    discoveryUrl,
    setDiscoveryUrl,
    isDiscovering,
    discoveryResult,
    runDiscovery,
    loadEndpointToEditor,
  } = useApiClientStore();

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedMethod, setSelectedMethod] = useState<string>("ALL");

  const filteredEndpoints = useMemo(() => {
    if (!discoveryResult || !discoveryResult.endpoints) return [];
    return discoveryResult.endpoints.filter((ep) => {
      const matchesSearch =
        ep.path.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (ep.description &&
          ep.description.toLowerCase().includes(searchQuery.toLowerCase()));
      const matchesMethod =
        selectedMethod === "ALL" || ep.method === selectedMethod;
      return matchesSearch && matchesMethod;
    });
  }, [discoveryResult, searchQuery, selectedMethod]);

  const handleExportMarkdownReport = async () => {
    if (!discoveryResult) return;
    const dateStr = new Date().toISOString();
    const passedCount = discoveryResult.endpoints.filter(
      (e) => e.status && e.status >= 200 && e.status < 400,
    ).length;

    let md = `# API Validation & Discovery Report — ${discoveryResult.detectedService || "API Service"}\n\n`;
    md += `> **Target Base URL**: \`${discoveryResult.baseUrl}\`  \n`;
    md += `> **Generated**: ${dateStr} • **Engine**: Voktty Zero-CORS Native Scanner  \n`;
    md += `> **Spec Origin**: ${discoveryResult.openApiFound ? "OpenAPI / Swagger 3.0" : "Smart Active Probing"}  \n\n`;
    md += `### ✓ Discovery Summary (${passedCount}/${discoveryResult.endpoints.length} Active Endpoints)\n\n`;
    md += `| Method | Endpoint Path | Status | Latency | Discovery Source |\n`;
    md += `| :--- | :--- | :--- | :--- | :--- |\n`;

    for (const ep of discoveryResult.endpoints) {
      const statusBadge = ep.status
        ? `${ep.status} ${ep.statusText || ""}`
        : "Discovered";
      const latency = ep.durationMs ? `${ep.durationMs}ms` : "—";
      md += `| **${ep.method}** | \`${ep.path}\` | \`${statusBadge}\` | ${latency} | ${ep.source} |\n`;
    }

    md += `\n---\n*Report generated with Voktty API Client & Sandbox.*`;

    try {
      await navigator.clipboard.writeText(md);
      toast.success("Validation report copied to clipboard in Markdown!");
    } catch {
      toast.error("Failed to copy report");
    }
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-background">
      {/* Top Search & Discovery Controls */}
      <div className="flex flex-col gap-3 border-b border-border/60 bg-muted/10 p-4">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <HugeiconsIcon
              icon={GlobalIcon}
              size={15}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              value={discoveryUrl}
              onChange={(e) => setDiscoveryUrl(e.target.value)}
              placeholder="Enter Base URL (e.g. https://forgenex.nexgestion.es/api/v1 or http://localhost:11434/api)"
              className="pl-9 font-mono text-xs"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !isDiscovering) {
                  void runDiscovery();
                }
              }}
            />
          </div>

          <Button
            size="sm"
            onClick={() => void runDiscovery()}
            disabled={isDiscovering || !discoveryUrl}
            className="gap-1.5 font-semibold text-xs"
          >
            {isDiscovering ? (
              <HugeiconsIcon
                icon={Loading03Icon}
                size={14}
                className="animate-spin"
              />
            ) : (
              <HugeiconsIcon icon={FlashIcon} size={14} />
            )}
            <span>{isDiscovering ? "Discovering..." : "Auto-Discover"}</span>
          </Button>
        </div>

        {/* Fast presets chips */}
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-[11px] font-medium text-muted-foreground mr-1">
            Presets rápidos:
          </span>
          {FAST_TARGETS.map((t) => (
            <button
              key={t.name}
              type="button"
              onClick={() => {
                setDiscoveryUrl(t.url);
                void runDiscovery(t.url);
              }}
              className="rounded border border-border/60 bg-background px-2 py-0.5 text-[11px] text-foreground/80 hover:bg-muted hover:text-foreground transition-colors"
            >
              {t.name}
            </button>
          ))}
        </div>
      </div>

      {/* Main Results View */}
      <div className="flex-1 overflow-auto p-4">
        {discoveryResult ? (
          <div className="flex flex-col gap-4">
            {/* Summary Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/20 p-3">
              <div className="flex items-center gap-3">
                <div className="flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <HugeiconsIcon icon={Shield01Icon} size={16} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm">
                      {discoveryResult.detectedService || "API Service"}
                    </span>
                    <Badge variant="outline" className="text-[10px]">
                      {discoveryResult.openApiFound
                        ? "OpenAPI / Swagger 3.0"
                        : "Smart Route Probe"}
                    </Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Base: <code className="font-mono">{discoveryResult.baseUrl}</code> • {discoveryResult.endpoints.length} endpoints encontrados en {discoveryResult.durationMs}ms
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleExportMarkdownReport}
                  className="h-7 gap-1 px-2.5 text-xs"
                >
                  <HugeiconsIcon icon={Copy01Icon} size={13} />
                  <span>Copy Markdown Report</span>
                </Button>
              </div>
            </div>

            {/* Filter Bar */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1">
                {["ALL", "GET", "POST", "PUT", "DELETE"].map((m) => (
                  <Button
                    key={m}
                    size="sm"
                    variant={selectedMethod === m ? "secondary" : "ghost"}
                    onClick={() => setSelectedMethod(m)}
                    className="h-6 px-2 text-[11px]"
                  >
                    {m}
                  </Button>
                ))}
              </div>

              <div className="relative w-64">
                <HugeiconsIcon
                  icon={Search01Icon}
                  size={13}
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filtrar endpoints..."
                  className="h-7 pl-8 text-xs"
                />
              </div>
            </div>

            {/* Endpoints Grid / List */}
            {filteredEndpoints.length > 0 ? (
              <div className="flex flex-col gap-2">
                {filteredEndpoints.map((ep, i) => (
                  <div
                    key={`${ep.method}-${ep.path}-${i}`}
                    className="group flex items-center justify-between gap-3 rounded-md border border-border/50 bg-background/50 p-2.5 transition-colors hover:border-primary/40 hover:bg-muted/10"
                  >
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      <span
                        className={cn(
                          "rounded border px-1.5 py-0.5 font-mono text-[10px] font-bold",
                          METHOD_BADGES[ep.method] || "bg-muted text-foreground",
                        )}
                      >
                        {ep.method}
                      </span>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-semibold text-foreground">
                            {ep.path}
                          </span>
                          {ep.status !== undefined && (
                            <Badge
                              variant="outline"
                              className={cn(
                                "text-[10px] px-1 py-0",
                                ep.status >= 200 && ep.status < 300
                                  ? "text-emerald-500 border-emerald-500/30"
                                  : ep.status === 401 || ep.status === 403
                                    ? "text-amber-500 border-amber-500/30"
                                    : "text-muted-foreground",
                              )}
                            >
                              {ep.status} {ep.statusText || ""}
                            </Badge>
                          )}
                          {ep.durationMs !== undefined && (
                            <span className="text-[10px] text-muted-foreground">
                              {ep.durationMs}ms
                            </span>
                          )}
                          {ep.requiresAuth && (
                            <span className="flex items-center gap-0.5 text-[10px] text-amber-500 font-medium">
                              <HugeiconsIcon icon={LockIcon} size={10} />
                              <span>Auth Required</span>
                            </span>
                          )}
                        </div>

                        {ep.description && (
                          <p className="truncate text-[11px] text-muted-foreground mt-0.5">
                            {ep.description}
                          </p>
                        )}
                      </div>
                    </div>

                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        loadEndpointToEditor(ep);
                        toast.success(`Cargado ${ep.method} ${ep.path} en el editor`);
                      }}
                      className="h-7 gap-1 px-2.5 text-xs opacity-90 group-hover:opacity-100"
                    >
                      <span>Test in Editor</span>
                      <HugeiconsIcon icon={ArrowRight01Icon} size={12} />
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center p-8 text-center text-muted-foreground">
                <p className="text-xs">No se encontraron endpoints con el filtro actual.</p>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full min-h-[300px] text-center p-8 text-muted-foreground">
            <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary mb-3">
              <HugeiconsIcon icon={GlobalIcon} size={24} />
            </div>
            <h3 className="font-semibold text-sm text-foreground">API Discovery & Smart Browser</h3>
            <p className="text-xs max-w-md mt-1">
              Introduce la URL base de tu API (ej. Ollama, CRM, Docker o servicio web) y haz clic en <strong>Auto-Discover</strong> para detectar automáticamente todas las rutas, métodos y especificaciones OpenAPI disponibles.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
