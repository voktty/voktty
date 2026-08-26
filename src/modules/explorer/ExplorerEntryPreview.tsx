import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { classifyMediaExtension, getMediaMimeType } from "@/modules/editor/lib/media";
import { useTranslation } from "@/modules/i18n";
import { isPathInRemoteWorkspace, remoteReadBinaryFile } from "@/modules/remote";
import { type WorkspaceEnv, workspaceForNativeFs } from "@/modules/workspace";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import {
  cloneElement,
  isValidElement,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";

const IMAGE_PREVIEW_LIMIT = 4 * 1024 * 1024;

type Props = {
  children: ReactNode;
  path: string;
  name: string;
  isDir: boolean;
  size: number;
  mtime: number;
  workspace: WorkspaceEnv;
};

type PreviewTriggerProps = {
  onPointerDownCapture?: (event: ReactPointerEvent<HTMLElement>) => void;
};

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function extensionOf(name: string): string | null {
  const extension = name.split(".").pop()?.toLowerCase();
  return extension && extension !== name.toLowerCase() ? extension : null;
}

function PreviewImage({
  path,
  size,
  extension,
  workspace,
  alt,
}: {
  path: string;
  size: number;
  extension: string;
  workspace: WorkspaceEnv;
  alt: string;
}) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    if (size > IMAGE_PREVIEW_LIMIT) return;
    let disposed = false;
    let objectUrl: string | null = null;

    const load = async () => {
      try {
        if (isPathInRemoteWorkspace(workspace, path)) {
          const { bytes } = await remoteReadBinaryFile(workspace, path);
          const content = bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
          ) as ArrayBuffer;
          objectUrl = URL.createObjectURL(
            new Blob([content], { type: getMediaMimeType(extension) }),
          );
          if (!disposed) setSrc(objectUrl);
          return;
        }

        if (workspace.kind === "local") {
          if (!disposed) setSrc(convertFileSrc(path));
          return;
        }

        const bytes = await invoke<number[] | Uint8Array>("fs_read_binary_file", {
          path,
          workspace: workspaceForNativeFs(workspace, path),
        });
        const binary = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
        const content = binary.buffer.slice(
          binary.byteOffset,
          binary.byteOffset + binary.byteLength,
        ) as ArrayBuffer;
        objectUrl = URL.createObjectURL(
          new Blob([content], { type: getMediaMimeType(extension) }),
        );
        if (!disposed) setSrc(objectUrl);
      } catch {
        if (!disposed) setSrc(null);
      }
    };

    void load();
    return () => {
      disposed = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [extension, path, size, workspace]);

  if (size > IMAGE_PREVIEW_LIMIT || !src) return null;
  return (
    <img
      src={src}
      alt={alt}
      className="mb-3 max-h-48 w-full rounded-xl border border-border/50 bg-muted/30 object-contain"
    />
  );
}

export function ExplorerEntryPreview({
  children,
  path,
  name,
  isDir,
  size,
  mtime,
  workspace,
}: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const pointerDownRef = useRef(false);
  const extension = extensionOf(name);
  const isImage = !isDir && extension !== null && classifyMediaExtension(extension) === "image";

  useEffect(() => {
    const releasePointer = () => {
      pointerDownRef.current = false;
    };
    window.addEventListener("pointerup", releasePointer, true);
    window.addEventListener("pointercancel", releasePointer, true);
    return () => {
      window.removeEventListener("pointerup", releasePointer, true);
      window.removeEventListener("pointercancel", releasePointer, true);
    };
  }, []);

  const closeForPointerGesture = () => {
    pointerDownRef.current = true;
    setOpen(false);
  };
  const trigger = isValidElement<PreviewTriggerProps>(children)
    ? cloneElement(children as ReactElement<PreviewTriggerProps>, {
        onPointerDownCapture: (event) => {
          children.props.onPointerDownCapture?.(event);
          closeForPointerGesture();
        },
      })
    : (
        <span onPointerDownCapture={closeForPointerGesture}>{children}</span>
      );

  return (
    <HoverCard
      open={open}
      openDelay={900}
      closeDelay={120}
      onOpenChange={(nextOpen) => {
        if (!pointerDownRef.current) setOpen(nextOpen);
      }}
    >
      <HoverCardTrigger asChild>{trigger}</HoverCardTrigger>
      <HoverCardContent side="right" align="start" className="w-72 p-3">
        {isImage ? (
          <PreviewImage
            path={path}
            size={size}
            extension={extension ?? ""}
            workspace={workspace}
            alt={name}
          />
        ) : null}
        <div className="min-w-0 space-y-1.5">
          <div className="truncate text-sm font-medium text-foreground">{name}</div>
          <div className="break-all font-mono text-[11px] text-muted-foreground">{path}</div>
          <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            <span className="text-muted-foreground">{t("explorer.previewType")}</span>
            <span>{isDir ? t("explorer.previewFolder") : extension?.toUpperCase() ?? t("explorer.previewFile")}</span>
            <span className="text-muted-foreground">{t("explorer.previewSize")}</span>
            <span>{isDir ? "—" : formatBytes(size)}</span>
            <span className="text-muted-foreground">{t("explorer.previewModified")}</span>
            <span>{mtime ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(mtime)) : "—"}</span>
          </div>
          {isImage && size > IMAGE_PREVIEW_LIMIT ? (
            <div className="pt-1 text-[11px] text-muted-foreground">{t("explorer.previewImageTooLarge")}</div>
          ) : null}
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}
