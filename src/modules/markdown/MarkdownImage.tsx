import { cn } from "@/lib/utils";
import { convertFileSrc } from "@tauri-apps/api/core";
import {
  type ComponentProps,
  type SyntheticEvent,
  useCallback,
  useMemo,
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
  const { docPath } = useMarkdownDoc();
  const [hasError, setHasError] = useState(false);

  const resolvedSrc = useMemo(() => {
    if (!src) return "";
    if (
      src.startsWith("http://") ||
      src.startsWith("https://") ||
      src.startsWith("data:") ||
      src.startsWith("asset://") ||
      src.startsWith("tauri://")
    ) {
      return src;
    }
    if (!docPath) return src;

    const fullLocalPath = resolveRelativeDocPath(docPath, src);
    try {
      return convertFileSrc(fullLocalPath);
    } catch {
      return src;
    }
  }, [src, docPath]);

  const handleError = useCallback(
    (e: SyntheticEvent<HTMLImageElement, Event>) => {
      setHasError(true);
      onError?.(e);
    },
    [onError],
  );

  if (!src) return null;

  if (hasError) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded border border-border/60 bg-muted/40 px-2 py-1 text-xs text-muted-foreground my-2",
          className,
        )}
      >
        <HugeiconsIcon icon={Image01Icon} size={14} className="shrink-0 opacity-70" />
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
