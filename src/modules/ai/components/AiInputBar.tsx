import { Button } from "@/components/ui/button";
import { Key01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useTranslation } from "@/modules/i18n";

export function AiInputBarConnect({ onAdd }: { onAdd: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="shrink-0 border-t border-border/60 bg-foreground/[0.02] px-3 py-2">
      <div className="flex h-10 items-center justify-between gap-3 rounded-lg px-3 text-xs">
        <span className="text-muted-foreground">
          {t('ai.inputBarConnect')}
        </span>
        <Button size="xs" onClick={onAdd}>
          <HugeiconsIcon icon={Key01Icon} />
          {t('ai.inputBarConnectButton')}
        </Button>
      </div>
    </div>
  );
}
