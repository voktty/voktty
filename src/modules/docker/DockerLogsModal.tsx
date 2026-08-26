import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useTranslation } from "@/modules/i18n";
import { Copy01Icon, RefreshIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useState } from "react";
import type { DockerContainerInfo } from "./types";
import { useDockerStore } from "./useDockerStore";

type Props = {
  container: DockerContainerInfo | null;
  onClose: () => void;
};

export function DockerLogsModal({ container, onClose }: Props) {
  const { t } = useTranslation();
  const fetchLogs = useDockerStore((s) => s.fetchLogs);
  const [logs, setLogs] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = async () => {
    if (!container) return;
    setLoading(true);
    try {
      const data = await fetchLogs(container.id, 250);
      setLogs(data || "(No logs available)");
    } catch (e) {
      setLogs(`Error loading logs: ${e}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (container) {
      load();
    }
  }, [container?.id]);

  const copyLogs = async () => {
    if (!logs) return;
    await navigator.clipboard.writeText(logs);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!container) return null;

  const containerName = container.names[0] || container.short_id;

  return (
    <Dialog open={!!container} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col p-5 bg-card/95 backdrop-blur-md border border-border/40 shadow-2xl rounded-xl">
        <DialogHeader className="flex flex-row items-center justify-between pb-3 border-b border-border/30">
          <div>
            <DialogTitle className="text-sm font-semibold flex items-center gap-2">
              <span className="text-base">🐳</span>
              <span>{containerName}</span>
              <span className="text-xs text-muted-foreground font-mono font-normal">
                ({container.image})
              </span>
            </DialogTitle>
          </div>
          <div className="flex items-center gap-2 pr-6">
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1.5"
              onClick={load}
              disabled={loading}
            >
              <HugeiconsIcon
                icon={RefreshIcon}
                className={`size-3.5 ${loading ? "animate-spin" : ""}`}
              />
              {t("docker.refresh")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1.5"
              onClick={copyLogs}
            >
              <HugeiconsIcon icon={Copy01Icon} className="size-3.5" />
              {copied ? t("common.copied") : t("common.copy")}
            </Button>
          </div>
        </DialogHeader>

        <div className="flex-1 min-h-[300px] overflow-auto bg-background/90 rounded-lg p-3 font-mono text-[11.5px] leading-relaxed border border-border/30 whitespace-pre-wrap select-text text-foreground/90">
          {logs}
        </div>
      </DialogContent>
    </Dialog>
  );
}
