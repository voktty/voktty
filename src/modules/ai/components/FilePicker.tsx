import { PopoverContent } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { fileIconUrl } from "@/modules/explorer/lib/iconResolver";
import { useEffect, useRef } from "react";

type Props = {
  files: readonly string[];
  activeIndex: number;
  indexing: boolean;
  truncated: boolean;
  hasWorkspace: boolean;
  remote: boolean;
  error: string | null;
  onPick: (file: string) => void;
  onHover: (index: number) => void;
};

import { useTranslation } from "@/modules/i18n";

export function FilePickerContent({
  files,
  activeIndex,
  indexing,
  truncated,
  hasWorkspace,
  remote,
  error,
  onPick,
  onHover,
}: Props) {
  const { t } = useTranslation();
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = itemRefs.current[activeIndex];
    if (!el) return;
    el.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  return (
    <PopoverContent
      side="top"
      align="start"
      sideOffset={6}
      onOpenAutoFocus={(e) => e.preventDefault()}
      onCloseAutoFocus={(e) => e.preventDefault()}
      onMouseDown={(e) => e.preventDefault()}
      className="w-80 overflow-hidden rounded-lg border border-border/60 bg-popover/95 p-0 shadow-xl backdrop-blur-xl"
    >
      <div className="border-b border-border/60 px-2.5 py-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
        {t("ai.filePicker.title")}
      </div>
      {remote && hasWorkspace ? (
        <div className="border-b border-sky-500/15 bg-sky-500/[0.05] px-2.5 py-2 text-[10.5px] leading-relaxed text-muted-foreground">
          {t("ai.filePicker.remoteWarning")}
        </div>
      ) : null}
      {!hasWorkspace ? (
        <div className="px-3 py-3 text-[11px] text-muted-foreground">
          {remote
            ? t("ai.filePicker.remoteUnavailable")
            : t("ai.filePicker.noWorkspace")}
        </div>
      ) : error ? (
        <div className="px-3 py-3 text-[11px] text-destructive">
          {t("ai.filePicker.remoteError")}
        </div>
      ) : indexing && files.length === 0 ? (
        <div className="flex items-center gap-2 px-3 py-3 text-[11px] text-muted-foreground">
          <Spinner className="size-3" />
          <span>{t("ai.filePicker.indexing")}</span>
        </div>
      ) : files.length === 0 ? (
        <div className="px-3 py-3 text-[11px] text-muted-foreground">
          {t("ai.filePicker.noMatches")}
        </div>
      ) : (
        <>
          <div ref={listRef} className="max-h-64 overflow-y-auto py-1">
            {files.map((path, idx) => {
              const slash = path.lastIndexOf("/");
              const name = slash === -1 ? path : path.slice(slash + 1);
              const dir = slash === -1 ? "" : path.slice(0, slash);
              return (
                <button
                  key={path}
                  ref={(el) => {
                    itemRefs.current[idx] = el;
                  }}
                  type="button"
                  onClick={() => onPick(path)}
                  onMouseEnter={() => onHover(idx)}
                  className={cn(
                    "flex w-full items-center gap-2 px-2 py-1.5 text-left text-[12px]",
                    idx === activeIndex ? "bg-accent" : "hover:bg-accent/60",
                  )}
                >
                  <img
                    src={fileIconUrl(name)}
                    alt=""
                    className="size-4 shrink-0"
                  />
                  <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
                    <span className="truncate font-medium">{name}</span>
                    {dir && (
                      <span className="truncate text-[10.5px] text-muted-foreground">
                        {dir}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
          {truncated && (
            <div className="border-t border-border/60 px-2.5 py-1.5 text-[10px] text-muted-foreground">
              {t("ai.filePicker.truncated")}
            </div>
          )}
        </>
      )}
    </PopoverContent>
  );
}
