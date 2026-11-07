import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  createManualAutomationRun,
  listAutomations,
  peekAutomations,
  setAutomationEnabled,
  subscribeAutomations,
  type Automation,
} from "@/modules/harness/lib/automations";
import { useTranslation } from "@/modules/i18n";
import { AiMagicIcon, PlayIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";


function formatNext(at: number): string {
  return new Date(at).toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function AutomationsPopover({ onOpenAll }: { onOpenAll: () => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Automation[]>(() => peekAutomations() ?? []);
  const [error, setError] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setItems(await listAutomations());
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
    return subscribeAutomations(() => void refresh());
  }, [refresh]);

  const active = items.filter((item) => item.enabled).length;
  const failed = items.some((item) => item.lastRunStatus === "failed");

  const run = async (item: Automation) => {
    try {
      await createManualAutomationRun(item.id);
      toast.success(t("statusbar.automations.queued", { name: item.name }));
    } catch (cause) {
      toast.error(t("statusbar.automations.runFailed", { message: String(cause) }));
    }
  };

  const toggle = async (item: Automation, enabled: boolean) => {
    try {
      await setAutomationEnabled(item, enabled);
    } catch (cause) {
      toast.error(String(cause));
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="relative size-6 shrink-0 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label={t("statusbar.automations.title")}
            >
              <HugeiconsIcon icon={AiMagicIcon} size={14} strokeWidth={1.75} />
              {failed ? (
                <span className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-destructive" />
              ) : null}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-[10.5px]">
          {t("statusbar.automations.title")}
          {active > 0 ? ` · ${active}` : ""}
        </TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-80 p-0 text-[11.5px]">
        <div className="flex items-center justify-between border-b border-border/40 px-3 py-2">
          <span className="font-semibold">{t("statusbar.automations.title")}</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[11px]"
            onClick={() => {
              setOpen(false);
              onOpenAll();
            }}
          >
            {t("statusbar.automations.openAll")}
          </Button>
        </div>
        {error ? (
          <p className="px-3 py-3 text-destructive">
            {t("statusbar.automations.loadFailed")}
          </p>
        ) : items.length === 0 ? (
          <p className="px-3 py-3 text-muted-foreground">
            {t("statusbar.automations.empty")}
          </p>
        ) : (
          <ul className="max-h-72 overflow-y-auto py-1">
            {items.map((item) => (
              <li
                key={item.id}
                className="flex items-center gap-2 px-3 py-1.5 hover:bg-accent/40"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{item.name}</div>
                  <div className="truncate text-[10.5px] text-muted-foreground">
                    {item.lastRunStatus === "failed"
                      ? t("statusbar.automations.lastFailed")
                      : item.enabled && item.nextRunAt > 0
                        ? t("statusbar.automations.next", {
                            time: formatNext(item.nextRunAt),
                          })
                        : t("statusbar.automations.paused")}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6"
                  title={t("statusbar.automations.runNow")}
                  aria-label={t("statusbar.automations.runNow")}
                  onClick={() => void run(item)}
                >
                  <HugeiconsIcon icon={PlayIcon} size={12} />
                </Button>
                <Switch
                  checked={item.enabled}
                  aria-label={item.name}
                  onCheckedChange={(next) => void toggle(item, next)}
                />
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
