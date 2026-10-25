import { cn } from "@/lib/utils";
import { useMediaSource } from "@/modules/editor/lib/useMediaSource";
import { getMediaMimeType } from "@/modules/editor/lib/media";
import {
  type ComponentProps,
  type SyntheticEvent,
  useCallback,
  useState,
} from "react";
import { useMarkdownDoc } from "./lib/docContext";
import { resolveRelativeDocPath } from "./lib/pathUtils";
import { HugeiconsIcon } from "@hugeicons/react";
import { Image01Icon } from "@hugeicons/core-free-icons";

export type MarkdownImageProps = ComponentProps<"img"> & {
  node?: unknown;
};

export function MarkdownImage({
  src,
  alt,
  className,
  onError,
  ...props
}: MarkdownImageProps) {
  const { docPath, workspaceEnv } = useMarkdownDoc();
  const [failedSrc, setFailedSrc] = useState<string>();
  const passthrough =
    !docPath ||
    (!!src &&
      (src.startsWith("http://") ||
        src.startsWith("https://") ||
        src.startsWith("data:") ||
        src.startsWith("asset://") ||
        src.startsWith("tauri://")));
  const target =
    src && !passthrough ? resolveRelativeDocPath(docPath, src) : undefined;
  const media = useMediaSource(
    target,
    workspaceEnv,
    getMediaMimeType(target?.split(".").pop() ?? ""),
  );
  const resolvedSrc = passthrough ? src : media.src;
  const hasError = passthrough ? failedSrc === src : media.failed;

  const handleError = useCallback(
    (e: SyntheticEvent<HTMLImageElement, Event>) => {
      if (!passthrough && !media.isCurrent()) return;
      if (passthrough) setFailedSrc(src);
      else media.onError();
      onError?.(e);
    },
    [onError, passthrough, src, media],
  );

  if (!src) return null;

  if (hasError || !resolvedSrc) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded border border-border/60 bg-muted/40 px-2 py-1 text-xs text-muted-foreground my-2",
          className,
        )}
      >
        <HugeiconsIcon
          icon={Image01Icon}
          size={14}
          className="shrink-0 opacity-70"
        />
        <span>{alt || src}</span>
      </span>
    );
  }

  return (
    <img
      {...props}
      src={resolvedSrc}
      alt={alt ?? ""}
      onError={handleError}
      className={cn(
        "my-3 max-w-full rounded-md object-contain transition-opacity duration-200",
        className,
      )}
      loading="lazy"
    />
  );
}
