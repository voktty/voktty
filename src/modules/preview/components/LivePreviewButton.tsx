import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/modules/i18n";
import { PlayIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";
import { useWebServerStore } from "../store/webServerStore";

type Props = {
  path: string;
  onOpenPreview: (url: string) => void;
};

export function isWebPreviewablePath(path: string): boolean {
  const lower = path.toLowerCase();
  return (
    lower.endsWith(".html") ||
    lower.endsWith(".htm") ||
    lower.endsWith(".php") ||
    lower.endsWith(".svg")
  );
}

export function LivePreviewButton({ path, onOpenPreview }: Props) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);

  const handleClick = async () => {
    setLoading(true);
    try {
      const dir = path.replace(/[/\\][^/\\]+$/, "");
      const info = await useWebServerStore.getState().startServer(dir);
      const filename = path.split(/[/\\]/).pop() || "";
      const url = filename ? `${info.url}/${filename}` : info.url;
      onOpenPreview(url);
    } catch (err) {
      console.error("Failed to start live preview:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      type="button"
      size="icon-xs"
      variant="ghost"
      onClick={handleClick}
      disabled={loading}
      title={t("tooltips.openLivePreview")}
      aria-label={t("tooltips.openLivePreview")}
      className={cn(
        "rounded-lg text-emerald-400 hover:bg-emerald-500/10 hover:text-emerald-300",
        loading && "cursor-wait opacity-60",
      )}
    >
      <HugeiconsIcon icon={PlayIcon} size={13} strokeWidth={2} />
    </Button>
  );
}
