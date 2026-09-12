import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/modules/i18n";
import { Delete02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useApiClientTabStore } from "../store/ApiClientStoreContext";

export function ApiHistoryView() {
  const { t } = useTranslation();
  const { history, loadFromHistory, clearHistory } = useApiClientTabStore();

  return (
    <div className="flex h-full flex-col p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-semibold">{t("apiClient.header.history")}</span>
        {history.length > 0 && (
          <Button
            size="sm"
            variant="ghost"
            onClick={clearHistory}
            className="h-6 gap-1 px-2 text-[11px] text-destructive hover:bg-destructive/10"
          >
            <HugeiconsIcon icon={Delete02Icon} size={12} />
            <span>{t("apiClient.header.clearHistory")}</span>
          </Button>
        )}
      </div>

      {history.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
          {t("apiClient.header.noHistory")}
        </div>
      ) : (
        <div className="flex flex-col gap-2 overflow-auto">
          {history.map((item, index) => (
            <div
              key={`${item.request.id}-${item.timestamp}-${index}`}
              onClick={() => loadFromHistory(index)}
              className="flex cursor-pointer items-center justify-between rounded border border-border/40 bg-muted/20 p-2 text-xs transition-colors hover:border-primary/40 hover:bg-muted/40"
            >
              <div className="flex items-center gap-2 overflow-hidden">
                <span className="font-mono font-bold text-primary">
                  {item.request.method}
                </span>
                <span className="truncate font-mono text-muted-foreground">
                  {item.request.url}
                </span>
              </div>

              <div className="flex items-center gap-2">
                {item.response && (
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[10px]",
                      item.response.status >= 200 && item.response.status < 300
                        ? "text-emerald-500 border-emerald-500/30"
                        : "text-rose-500 border-rose-500/30",
                    )}
                  >
                    {item.response.status}
                  </Badge>
                )}
                <span className="text-[10px] text-muted-foreground">
                  {new Date(item.timestamp).toLocaleTimeString()}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
