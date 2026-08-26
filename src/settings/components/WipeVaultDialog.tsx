import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useTranslation } from "@/modules/i18n";
import { Alert02Icon, Delete02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirmWipe: () => Promise<boolean>;
};

export function WipeVaultDialog({ open, onOpenChange, onConfirmWipe }: Props) {
  const { t } = useTranslation();
  const [isWiping, setIsWiping] = useState(false);

  const handleWipe = async () => {
    setIsWiping(true);
    const success = await onConfirmWipe();
    setIsWiping(false);
    if (success) {
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <HugeiconsIcon icon={Alert02Icon} size={18} strokeWidth={1.75} />
            <span>{t("vault.wipe.title")}</span>
          </DialogTitle>
          <DialogDescription>
            {t("vault.wipe.warningDescription")}
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive flex flex-col gap-1.5">
          <p className="font-semibold">{t("vault.wipe.cautionHeader")}</p>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {t("vault.wipe.cautionDetails")}
          </p>
        </div>

        <DialogFooter className="mt-2 flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isWiping}
            onClick={() => onOpenChange(false)}
          >
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={isWiping}
            onClick={() => void handleWipe()}
            className="gap-1.5 cursor-pointer"
          >
            <HugeiconsIcon icon={Delete02Icon} size={14} />
            <span>{isWiping ? t("vault.wipe.wiping") : t("vault.wipe.confirmButton")}</span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
