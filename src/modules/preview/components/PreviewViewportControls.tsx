import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  ArrowDown01Icon,
  LaptopIcon,
  SmartPhone01Icon,
  Tablet01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  VIEWPORT_PRESETS,
  usePreviewDevtoolsStore,
} from "../store/previewDevtoolsStore";

const SCALE_PRESETS = [
  { label: "100%", value: 1 },
  { label: "125%", value: 1.25 },
  { label: "75%", value: 0.75 },
  { label: "50%", value: 0.5 },
];

export function PreviewViewportControls() {
  const viewportMode = usePreviewDevtoolsStore((s) => s.viewportMode);
  const activePresetId = usePreviewDevtoolsStore((s) => s.activePresetId);
  const customWidth = usePreviewDevtoolsStore((s) => s.customWidth);
  const customHeight = usePreviewDevtoolsStore((s) => s.customHeight);
  const isLandscape = usePreviewDevtoolsStore((s) => s.isLandscape);
  const scale = usePreviewDevtoolsStore((s) => s.scale);
  const showDeviceFrame = usePreviewDevtoolsStore((s) => s.showDeviceFrame);

  const selectPreset = usePreviewDevtoolsStore((s) => s.selectPreset);
  const setCustomDimensions = usePreviewDevtoolsStore(
    (s) => s.setCustomDimensions,
  );
  const toggleLandscape = usePreviewDevtoolsStore((s) => s.toggleLandscape);
  const setScale = usePreviewDevtoolsStore((s) => s.setScale);
  const setShowDeviceFrame = usePreviewDevtoolsStore(
    (s) => s.setShowDeviceFrame,
  );
  const resetViewport = usePreviewDevtoolsStore((s) => s.resetViewport);

  const activePreset = VIEWPORT_PRESETS.find((p) => p.id === activePresetId);
  const isFixed = viewportMode !== "responsive" && customWidth && customHeight;

  return (
    <div className="flex items-center gap-1 text-xs">
      {/* Device Preset Dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn(
              "h-7 gap-1.5 rounded-md px-2 text-[11px] font-medium transition-colors",
              isFixed
                ? "bg-cyan-500/15 text-cyan-400 border border-cyan-500/30"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
            title="Seleccionar dispositivo o resolución"
          >
            {viewportMode === "mobile" ? (
              <HugeiconsIcon icon={SmartPhone01Icon} size={13} />
            ) : viewportMode === "tablet" ? (
              <HugeiconsIcon icon={Tablet01Icon} size={13} />
            ) : viewportMode === "laptop" || viewportMode === "desktop" ? (
              <HugeiconsIcon icon={LaptopIcon} size={13} />
            ) : (
              <span className="text-[12px]">📐</span>
            )}
            <span className="max-w-[110px] truncate">
              {activePreset
                ? activePreset.name
                : viewportMode === "responsive"
                  ? "100% Responsivo"
                  : `${customWidth}×${customHeight}`}
            </span>
            <HugeiconsIcon
              icon={ArrowDown01Icon}
              size={11}
              className="opacity-60"
            />
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="start" className="min-w-52 text-xs">
          <DropdownMenuItem
            onClick={resetViewport}
            className={cn(
              "font-medium",
              viewportMode === "responsive" && "bg-accent/80 text-cyan-400",
            )}
          >
            <span className="mr-2 text-sm">📐</span>
            <span>100% Responsivo (Fluido)</span>
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <DropdownMenuLabel className="text-[10px] text-muted-foreground uppercase tracking-wider">
            📱 Teléfonos Móviles
          </DropdownMenuLabel>
          {VIEWPORT_PRESETS.filter((p) => p.category === "mobile").map((p) => (
            <DropdownMenuItem
              key={p.id}
              onClick={() => selectPreset(p.id)}
              className={cn(
                "justify-between",
                activePresetId === p.id && "bg-accent/80 text-cyan-400",
              )}
            >
              <span>{p.name}</span>
              <span className="text-[10px] text-muted-foreground font-mono">
                {p.width}×{p.height}
              </span>
            </DropdownMenuItem>
          ))}

          <DropdownMenuSeparator />

          <DropdownMenuLabel className="text-[10px] text-muted-foreground uppercase tracking-wider">
            💻 Tablets & Laptops
          </DropdownMenuLabel>
          {VIEWPORT_PRESETS.filter(
            (p) => p.category === "tablet" || p.category === "laptop",
          ).map((p) => (
            <DropdownMenuItem
              key={p.id}
              onClick={() => selectPreset(p.id)}
              className={cn(
                "justify-between",
                activePresetId === p.id && "bg-accent/80 text-cyan-400",
              )}
            >
              <span>{p.name}</span>
              <span className="text-[10px] text-muted-foreground font-mono">
                {p.width}×{p.height}
              </span>
            </DropdownMenuItem>
          ))}

          <DropdownMenuSeparator />

          <DropdownMenuLabel className="text-[10px] text-muted-foreground uppercase tracking-wider">
            🖥️ Escritorio
          </DropdownMenuLabel>
          {VIEWPORT_PRESETS.filter((p) => p.category === "desktop").map((p) => (
            <DropdownMenuItem
              key={p.id}
              onClick={() => selectPreset(p.id)}
              className={cn(
                "justify-between",
                activePresetId === p.id && "bg-accent/80 text-cyan-400",
              )}
            >
              <span>{p.name}</span>
              <span className="text-[10px] text-muted-foreground font-mono">
                {p.width}×{p.height}
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Manual Width & Height Inputs if not responsive */}
      {isFixed ? (
        <div className="flex items-center gap-1">
          <div className="flex items-center rounded-md border border-border/60 bg-muted/40 px-1 py-0.5 font-mono text-[11px]">
            <Input
              type="number"
              value={customWidth || ""}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10);
                if (!isNaN(val) && val > 100) {
                  setCustomDimensions(val, customHeight || 600);
                }
              }}
              className="h-5 w-12 border-0 bg-transparent p-0 text-center text-[11px] focus-visible:ring-0 shadow-none"
            />
            <span className="text-muted-foreground/60 px-0.5">×</span>
            <Input
              type="number"
              value={customHeight || ""}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10);
                if (!isNaN(val) && val > 100) {
                  setCustomDimensions(customWidth || 800, val);
                }
              }}
              className="h-5 w-12 border-0 bg-transparent p-0 text-center text-[11px] focus-visible:ring-0 shadow-none"
            />
            <span className="text-[9px] text-muted-foreground/70 pl-0.5">px</span>
          </div>

          {/* Rotate Orientation */}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={toggleLandscape}
            title={
              isLandscape
                ? "Cambiar a vertical (Portrait)"
                : "Cambiar a horizontal (Landscape)"
            }
            className="size-7 shrink-0 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <span className="text-[13px]">{isLandscape ? "🔄" : "🔁"}</span>
          </Button>

          {/* Device Frame Toggle */}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setShowDeviceFrame(!showDeviceFrame)}
            title={showDeviceFrame ? "Ocultar marco de dispositivo" : "Mostrar marco"}
            className={cn(
              "size-7 shrink-0 rounded-md text-muted-foreground hover:bg-accent",
              showDeviceFrame && "text-cyan-400 bg-cyan-500/10",
            )}
          >
            <span className="text-[12px]">📱</span>
          </Button>
        </div>
      ) : null}

      {/* Scale / Zoom Dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-1.5 text-[11px] font-mono text-muted-foreground hover:bg-accent hover:text-foreground"
            title="Escala de zoom"
          >
            {Math.round(scale * 100)}%
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-28 text-xs">
          {SCALE_PRESETS.map((s) => (
            <DropdownMenuItem
              key={s.value}
              onClick={() => setScale(s.value)}
              className={cn(
                "justify-between font-mono",
                scale === s.value && "bg-accent text-cyan-400",
              )}
            >
              <span>{s.label}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
