import { lazy, Suspense, useLayoutEffect, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import BrainIcon from "@hugeicons/core-free-icons/BrainIcon";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useTranslation } from "@/modules/i18n";
import type { MemoryPanelTarget } from "@/modules/workspace-kit/lib/memoryPanel";
import { cn } from "@/lib/utils";

const Panel = lazy(
  () => import("@/modules/workspace-kit/components/ProjectMemoryPanel"),
);

export function ProjectMemoryButton({
  target,
  rail = false,
}: {
  target: MemoryPanelTarget | null;
  rail?: boolean;
}) {
  const { t } = useTranslation();
  const key = JSON.stringify(target);
  const [opened, setOpened] = useState<{
    key: string;
    target: MemoryPanelTarget | null;
  } | null>(null);
  const open = opened !== null && opened.key === key;
  useLayoutEffect(() => {
    if (opened && opened.key !== key) setOpened(null);
  }, [opened, key]);
  return (
    <Dialog
      open={open}
      onOpenChange={(value) =>
        setOpened(
          value
            ? { key, target: target ? structuredClone(target) : null }
            : null,
        )
      }
    >
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size={rail ? "default" : "icon"}
          title={t("projectMemory.title")}
          aria-label={t("projectMemory.title")}
          className={cn(
            rail
              ? "h-8 w-full justify-start gap-2 px-2 text-content/50 hover:bg-content/10 hover:text-content"
              : "size-6 shrink-0 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground",
            open && "bg-accent text-foreground",
          )}
        >
          <HugeiconsIcon
            icon={BrainIcon}
            size={rail ? 16 : 14}
            strokeWidth={1.75}
            aria-hidden
          />
          {rail ? (
            <span className="truncate text-sm font-medium">
              {t("projectMemory.title")}
            </span>
          ) : null}
        </Button>
      </DialogTrigger>
      {open ? (
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("projectMemory.title")}</DialogTitle>
            <DialogDescription>
              {t("projectMemory.description")}
            </DialogDescription>
          </DialogHeader>
          <Suspense
            fallback={<p role="status">{t("projectMemory.checking")}</p>}
          >
            <Panel target={opened.target} />
          </Suspense>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
