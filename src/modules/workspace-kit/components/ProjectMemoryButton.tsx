import { lazy, Suspense, useId, useLayoutEffect, useMemo, useState } from "react";
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
import type { MemoryConversationCapture } from "@/modules/workspace-kit/lib/memoryConversation";
import type { InitialMemoryDraftCapture } from "@/modules/workspace-kit/lib/initialMemoryPrompt";
import { cn } from "@/lib/utils";
import { refreshMemoryIndicators } from "@/modules/workspace-kit/lib/memoryIndicatorRefresh";

const Panel = lazy(
  () => import("@/modules/workspace-kit/components/ProjectMemoryPanel"),
);
const Indicator = lazy(() => import("@/modules/workspace-kit/components/MemoryIndicator"));

export function ProjectMemoryButton({
  target,
  rail = false,
  captureConversation,
  captureInitialMemory,
  observe = false,
}: {
  target: MemoryPanelTarget | null;
  rail?: boolean;
  captureConversation?: () => MemoryConversationCapture | null;
  captureInitialMemory?: () => InitialMemoryDraftCapture | null;
  observe?: boolean;
}) {
  const { t } = useTranslation();
  const descriptionId = useId();
  const key = JSON.stringify(target);
  const observedTarget = useMemo(() => JSON.parse(key) as MemoryPanelTarget | null, [key]);
  const [opened, setOpened] = useState<{
    key: string;
    target: MemoryPanelTarget | null;
    capture: MemoryConversationCapture | null;
    initialMemory: InitialMemoryDraftCapture | null;
    conversationError: boolean;
  } | null>(null);
  const open = opened !== null && opened.key === key;
  useLayoutEffect(() => {
    if (opened && opened.key !== key) {
      opened.capture?.release();
      opened.initialMemory?.release();
      setOpened(null);
    }
    return () => {
      opened?.capture?.release();
      opened?.initialMemory?.release();
    };
  }, [opened, key]);
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) {
          opened?.capture?.release();
          opened?.initialMemory?.release();
          setOpened(null);
          if (open) refreshMemoryIndicators();
          return;
        }
        if (open) return;
        let capture: MemoryConversationCapture | null = null;
        let conversationError = false;
        let initialMemory: InitialMemoryDraftCapture | null = null;
        try {
          capture = captureConversation?.() ?? null;
        } catch {
          conversationError = true;
        }
        try {
          initialMemory = captureInitialMemory?.() ?? null;
        } catch {
          initialMemory = null;
        }
        setOpened({
          key,
          target: target ? structuredClone(target) : null,
          capture,
          initialMemory,
          conversationError,
        });
      }}
    >
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size={rail ? "default" : "icon"}
          title={t("projectMemory.title")}
          aria-label={t("projectMemory.title")}
          aria-describedby={observe ? descriptionId : undefined}
          className={cn(
            rail
              ? "h-8 w-full justify-start gap-2 px-2 text-content/50 hover:bg-content/10 hover:text-content"
              : "size-6 shrink-0 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground",
            open && "bg-accent text-foreground",
          )}
        >
          {observe ? (
            <Suspense fallback={<span id={descriptionId} role="img" className="size-3.5 animate-pulse rounded-full bg-muted" aria-label={t("projectMemory.checking")} />}>
              <Indicator key={key} target={observedTarget} active={!open} descriptionId={descriptionId} />
            </Suspense>
          ) : <HugeiconsIcon
            icon={BrainIcon}
            size={rail ? 16 : 14}
            strokeWidth={1.75}
            aria-hidden
          />}
          {rail ? (
            <span className="truncate text-sm font-medium">
              {t("projectMemory.title")}
            </span>
          ) : null}
        </Button>
      </DialogTrigger>
      {open ? (
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t("projectMemory.title")}</DialogTitle>
            <DialogDescription>
              {t("projectMemory.description")}
            </DialogDescription>
          </DialogHeader>
          <Suspense
            fallback={<p role="status">{t("projectMemory.checking")}</p>}
          >
            <Panel
              target={opened.target}
              conversation={opened.capture?.conversation}
              conversationError={opened.conversationError}
              prepareInitialMemory={
                opened.initialMemory
                  ? (prompt) => {
                      if (!opened.initialMemory?.prepare(prompt)) return false;
                      opened.initialMemory.release();
                      opened.capture?.release();
                      setOpened((current) =>
                        current === opened ? null : current,
                      );
                      refreshMemoryIndicators();
                      return true;
                    }
                  : undefined
              }
            />
          </Suspense>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
