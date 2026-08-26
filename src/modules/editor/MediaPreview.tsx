import {
  Cancel01Icon,
  File02Icon,
  RefreshIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import {
  type MouseEvent,
  type WheelEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "@/modules/i18n";
import {
  isPathInRemoteWorkspace,
  remoteReadBinaryFile,
} from "@/modules/remote";
import { currentWorkspaceEnv, workspaceForNativeFs } from "@/modules/workspace";
import {
  getMediaMimeType,
  type MediaKind,
} from "./lib/media";

export { classifyMediaExtension, getMediaMimeType } from "./lib/media";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function MediaPreview({
  path,
  size,
  kind,
}: {
  path: string;
  size?: number;
  kind: MediaKind;
}) {
  const { t } = useTranslation();
  const filename = path.split(/[\\/]/).pop() || path;
  const ext = path.split(".").pop()?.toLowerCase() ?? "";

  const [src, setSrc] = useState<string>(() => convertFileSrc(path));
  const [loadFailed, setLoadFailed] = useState(false);
  const [naturalDimensions, setNaturalDimensions] = useState<{
    width: number;
    height: number;
  } | null>(null);

  // Zoom & Pan state for images
  const [scale, setScale] = useState(1);
  const [fitMode, setFitMode] = useState<"fit" | "100%" | "custom">("fit");
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0, startX: 0, startY: 0 });
  const objectUrlRef = useRef<string | null>(null);

  const revokeBlobUrl = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }, []);

  // Fetch binary fallback via Tauri IPC or remote
  const loadBinaryFallback = useCallback(async () => {
    try {
      const workspace = currentWorkspaceEnv();
      const mime = getMediaMimeType(ext);

      if (isPathInRemoteWorkspace(workspace, path)) {
        const { bytes } = await remoteReadBinaryFile(workspace, path);
        const content = bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ) as ArrayBuffer;
        const blob = new Blob([content], { type: mime });
        revokeBlobUrl();
        const url = URL.createObjectURL(blob);
        objectUrlRef.current = url;
        setSrc(url);
        setLoadFailed(false);
      } else {
        const raw = await invoke<number[] | Uint8Array>("fs_read_binary_file", {
          path,
          workspace: workspaceForNativeFs(workspace, path),
        });
        const u8 = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
        const blob = new Blob([u8.buffer as ArrayBuffer], { type: mime });
        revokeBlobUrl();
        const url = URL.createObjectURL(blob);
        objectUrlRef.current = url;
        setSrc(url);
        setLoadFailed(false);
      }
    } catch {
      setLoadFailed(true);
    }
  }, [path, ext, revokeBlobUrl]);

  // Reset and try convertFileSrc on path change
  useEffect(() => {
    revokeBlobUrl();
    setLoadFailed(false);
    setNaturalDimensions(null);
    setScale(1);
    setFitMode("fit");
    setOffset({ x: 0, y: 0 });

    const primaryUrl = convertFileSrc(path);
    setSrc(primaryUrl);

    return () => {
      revokeBlobUrl();
    };
  }, [path, revokeBlobUrl]);

  const handleMediaError = useCallback(() => {
    if (!objectUrlRef.current) {
      void loadBinaryFallback();
    } else {
      setLoadFailed(true);
    }
  }, [loadBinaryFallback]);

  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    setNaturalDimensions({
      width: img.naturalWidth,
      height: img.naturalHeight,
    });
    setLoadFailed(false);
  };

  // Zoom helpers
  const zoomIn = () => {
    setScale((s) => Math.min(Number((s * 1.25).toFixed(2)), 10));
    setFitMode("custom");
  };

  const zoomOut = () => {
    setScale((s) => Math.max(Number((s / 1.25).toFixed(2)), 0.1));
    setFitMode("custom");
  };

  const setActualSize = () => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
    setFitMode("100%");
  };

  const setFitToScreen = () => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
    setFitMode("fit");
  };

  const toggleFitOrActual = () => {
    if (fitMode === "fit") {
      setActualSize();
    } else {
      setFitToScreen();
    }
  };

  const handleWheel = (e: WheelEvent) => {
    if (e.ctrlKey || e.metaKey || fitMode === "custom") {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.15 : 0.85;
      setScale((s) => {
        return Math.max(0.1, Math.min(10, Number((s * factor).toFixed(2))));
      });
      setFitMode("custom");
    }
  };

  const handleMouseDown = (e: MouseEvent) => {
    if (e.button !== 0) return;
    setIsDragging(true);
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      startX: offset.x,
      startY: offset.y,
    };
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isDragging) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    setOffset({
      x: dragStartRef.current.startX + dx,
      y: dragStartRef.current.startY + dy,
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  if (loadFailed) {
    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center gap-3 bg-background/95 p-6 text-center">
        <div className="flex size-12 items-center justify-center rounded-2xl border border-destructive/30 bg-destructive/10 text-destructive shadow-sm">
          <HugeiconsIcon icon={Cancel01Icon} size={24} strokeWidth={2} />
        </div>
        <div className="flex flex-col items-center gap-1">
          <h3 className="text-sm font-semibold text-foreground">{filename}</h3>
          <p className="max-w-md text-xs text-muted-foreground">
            {t("editor.status.previewNotSupported")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadBinaryFallback()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border/40 bg-foreground/[0.04] px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-foreground/[0.08]"
        >
          <HugeiconsIcon icon={RefreshIcon} size={14} />
          <span>{t("common.retry")}</span>
        </button>
      </div>
    );
  }

  return (
    <div
      className="relative flex h-full min-h-0 flex-col items-center justify-center overflow-hidden bg-background select-none"
      onMouseMove={kind === "image" ? handleMouseMove : undefined}
      onMouseUp={kind === "image" ? handleMouseUp : undefined}
    >
      {/* Media Canvas */}
      <div
        className="flex size-full items-center justify-center overflow-hidden p-6"
        onWheel={kind === "image" ? handleWheel : undefined}
      >
        {kind === "image" && (
          <div
            className="relative flex items-center justify-center transition-transform duration-75 ease-out"
            style={{
              transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
              cursor: scale > 1 ? (isDragging ? "grabbing" : "grab") : "default",
            }}
            onMouseDown={scale > 1 ? handleMouseDown : undefined}
            onDoubleClick={toggleFitOrActual}
          >
            <img
              src={src}
              alt={filename}
              loading="eager"
              decoding="async"
              onLoad={handleImageLoad}
              onError={handleMediaError}
              className={`rounded-lg border border-border/30 shadow-2xl transition-all ${
                fitMode === "fit"
                  ? "max-h-[calc(100vh-140px)] max-w-[calc(100vw-80px)] object-contain"
                  : ""
              }`}
              style={{
                backgroundImage:
                  "conic-gradient(var(--muted)/40 0.25turn, transparent 0.25turn 0.5turn, var(--muted)/40 0.5turn 0.75turn, transparent 0.75turn)",
                backgroundSize: "24px 24px",
              }}
              draggable={false}
            />
          </div>
        )}

        {kind === "video" && (
          // biome-ignore lint/a11y/useMediaCaption: local video preview
          <video
            controls
            preload="metadata"
            src={src}
            onError={handleMediaError}
            className="max-h-full max-w-full rounded-lg border border-border/30 bg-black/40 shadow-2xl"
          />
        )}

        {kind === "audio" && (
          <div className="flex w-full max-w-md flex-col items-center gap-4 rounded-2xl border border-border/40 bg-card/60 p-6 shadow-2xl backdrop-blur-xl">
            <div className="flex size-14 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary shadow-inner">
              <HugeiconsIcon icon={File02Icon} size={28} />
            </div>
            <div className="text-center">
              <h4 className="text-sm font-semibold text-foreground">
                {filename}
              </h4>
              {size && (
                <p className="text-xs text-muted-foreground">
                  {formatBytes(size)}
                </p>
              )}
            </div>
            {/* biome-ignore lint/a11y/useMediaCaption: local audio preview */}
            <audio
              controls
              preload="metadata"
              src={src}
              onError={handleMediaError}
              className="w-full"
            />
          </div>
        )}

        {kind === "pdf" && (
          <iframe
            src={src}
            title={filename}
            onError={handleMediaError}
            className="size-full rounded-lg border-none"
          />
        )}
      </div>

      {/* Floating HUD Toolbar (for Images) */}
      {kind === "image" && (
        <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-xl border border-border/40 bg-popover/85 px-3 py-1.5 text-xs text-foreground shadow-xl backdrop-blur-xl animate-in fade-in slide-in-from-bottom-2 duration-150">
          <span className="font-mono text-[11px] font-medium text-muted-foreground">
            {filename}
          </span>

          {naturalDimensions && (
            <>
              <span className="text-border">·</span>
              <span className="font-mono text-[11px] text-muted-foreground">
                {naturalDimensions.width} × {naturalDimensions.height} px
              </span>
            </>
          )}

          {size && (
            <>
              <span className="text-border">·</span>
              <span className="font-mono text-[11px] text-muted-foreground">
                {formatBytes(size)}
              </span>
            </>
          )}

          <div className="mx-1 h-3.5 w-px bg-border/40" />

          {/* Zoom controls */}
          <button
            type="button"
            onClick={zoomOut}
            title={t("editor.media.zoomOut")}
            className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/[0.08] hover:text-foreground active:scale-95"
          >
            -
          </button>

          <button
            type="button"
            onClick={toggleFitOrActual}
            title={t("editor.media.toggleFit")}
            className="min-w-10 px-1.5 py-0.5 rounded-md font-mono text-[11px] font-semibold text-foreground text-center transition-colors hover:bg-foreground/[0.08]"
          >
            {fitMode === "fit" ? t("editor.media.fit") : `${Math.round(scale * 100)}%`}
          </button>

          <button
            type="button"
            onClick={zoomIn}
            title={t("editor.media.zoomIn")}
            className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/[0.08] hover:text-foreground active:scale-95"
          >
            +
          </button>

          <button
            type="button"
            onClick={setActualSize}
            title={t("editor.media.actualSize")}
            className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/[0.08] hover:text-foreground active:scale-95 text-[10px] font-mono font-medium"
          >
            1:1
          </button>
        </div>
      )}
    </div>
  );
}
