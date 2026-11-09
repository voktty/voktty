import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Cancel01Icon,
  CheckmarkCircle02Icon,
  SmartPhone01Icon,
} from "@hugeicons/core-free-icons";
import { useTranslation } from "@/modules/i18n";
import { useCompanionPairingStore } from "./useCompanionPairingStore";

export function CompanionPairingModal() {
  const { t } = useTranslation();
  const pendingRequest = useCompanionPairingStore((s) => s.pendingRequest);
  const clearPendingRequest = useCompanionPairingStore(
    (s) => s.clearPendingRequest,
  );
  const [submitting, setSubmitting] = useState(false);

  if (!pendingRequest) return null;

  const handleDecide = async (approved: boolean) => {
    setSubmitting(true);
    try {
      await invoke("companion_decide_pairing", {
        requestId: pendingRequest.id,
        approved,
      });
      if (approved) {
        toast.success(
          t("companion.pairing.allowedSuccess", {
            device: pendingRequest.deviceName,
          }),
        );
      }
    } catch (error) {
      if (approved) {
        toast.error(String(error));
      }
    } finally {
      setSubmitting(false);
      clearPendingRequest();
    }
  };

  return (
    <Dialog
      open={Boolean(pendingRequest)}
      onOpenChange={(open) => {
        if (!open && !submitting) {
          void handleDecide(false);
        }
      }}
    >
      <DialogContent className="sm:max-w-md p-6 gap-5 bg-card/95 backdrop-blur-xl border-border/80 shadow-2xl rounded-3xl">
        <DialogHeader className="flex flex-col items-center text-center gap-2">
          <div className="size-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shadow-xs">
            <HugeiconsIcon icon={SmartPhone01Icon} size={28} strokeWidth={2} />
          </div>
          <DialogTitle className="text-lg font-semibold tracking-tight text-foreground">
            {t("companion.pairing.modalTitle")}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground leading-relaxed max-w-xs">
            {t("companion.pairing.modalDesc")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 rounded-2xl border border-border/60 bg-background/50 p-4">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">
              {t("companion.pairing.deviceLabel")}
            </span>
            <span className="font-semibold text-foreground">
              {pendingRequest.deviceName || t("companion.pairing.unknownDevice")}
            </span>
          </div>

          <div className="flex flex-col gap-1.5 pt-1 border-t border-border/40">
            <span className="text-[11px] font-medium text-muted-foreground">
              {t("companion.pairing.fingerprintLabel")}
            </span>
            <div className="rounded-xl border border-border/60 bg-muted/40 px-3 py-2 text-center font-mono text-[11px] font-medium tracking-wider text-foreground select-all">
              {pendingRequest.fingerprint}
            </div>
            <p className="text-[10px] text-muted-foreground/80 leading-relaxed text-center">
              {t("companion.pairing.fingerprintHint")}
            </p>
          </div>
        </div>

        <DialogFooter className="flex flex-row gap-2.5 sm:justify-end">
          <Button
            type="button"
            variant="outline"
            className="flex-1 h-9 gap-1.5 text-xs text-muted-foreground hover:text-foreground border-border/70"
            disabled={submitting}
            onClick={() => void handleDecide(false)}
          >
            <HugeiconsIcon icon={Cancel01Icon} size={15} strokeWidth={2} />
            <span>{t("companion.pairing.deny")}</span>
          </Button>
          <Button
            type="button"
            className="flex-1 h-9 gap-1.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm"
            disabled={submitting}
            onClick={() => void handleDecide(true)}
          >
            <HugeiconsIcon
              icon={CheckmarkCircle02Icon}
              size={15}
              strokeWidth={2}
            />
            <span>{t("companion.pairing.allow")}</span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
