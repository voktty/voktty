import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTranslation } from "@/modules/i18n";
import { Key01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChangePassword: (oldPass: string, newPass: string) => Promise<boolean>;
};

export function ChangeMasterPasswordDialog({
  open,
  onOpenChange,
  onChangePassword,
}: Props) {
  const { t } = useTranslation();
  const [oldPass, setOldPass] = useState("");
  const [newPass, setNewPass] = useState("");
  const [confirmPass, setConfirmPass] = useState("");
  const [isChanging, setIsChanging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setOldPass("");
    setNewPass("");
    setConfirmPass("");
    setError(null);
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!oldPass) {
      setError(t("vault.changePass.errorOldRequired"));
      return;
    }
    if (newPass.length < 6) {
      setError(t("vault.changePass.errorMinLength"));
      return;
    }
    if (newPass !== confirmPass) {
      setError(t("vault.changePass.errorMismatch"));
      return;
    }

    setIsChanging(true);
    setError(null);
    const success = await onChangePassword(oldPass, newPass);
    setIsChanging(false);
    if (success) {
      toast.success(t("vault.changePass.successToast"));
      onOpenChange(false);
    } else {
      setError(t("vault.changePass.errorCurrentWrong"));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HugeiconsIcon icon={Key01Icon} size={18} strokeWidth={1.75} />
            <span>{t("vault.changePass.title")}</span>
          </DialogTitle>
          <DialogDescription>
            {t("vault.changePass.description")}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3 py-1">
          <div className="flex flex-col gap-1">
            <Label htmlFor="old-pass" className="text-[11px] text-muted-foreground">
              {t("vault.changePass.oldPassLabel")}
            </Label>
            <Input
              id="old-pass"
              type="password"
              value={oldPass}
              onChange={(e) => setOldPass(e.target.value)}
              placeholder="••••••••"
              className="h-8 text-xs font-mono"
              required
            />
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="new-pass" className="text-[11px] text-muted-foreground">
              {t("vault.changePass.newPassLabel")}
            </Label>
            <Input
              id="new-pass"
              type="password"
              value={newPass}
              onChange={(e) => setNewPass(e.target.value)}
              placeholder="••••••••"
              className="h-8 text-xs font-mono"
              required
            />
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="confirm-new-pass" className="text-[11px] text-muted-foreground">
              {t("vault.changePass.confirmPassLabel")}
            </Label>
            <Input
              id="confirm-new-pass"
              type="password"
              value={confirmPass}
              onChange={(e) => setConfirmPass(e.target.value)}
              placeholder="••••••••"
              className="h-8 text-xs font-mono"
              required
            />
          </div>

          {error && <div className="text-[11px] text-destructive">{error}</div>}

          <DialogFooter className="mt-2 flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isChanging}
              onClick={() => onOpenChange(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="submit"
              variant="default"
              size="sm"
              disabled={isChanging}
              className="cursor-pointer"
            >
              {isChanging ? t("vault.changePass.saving") : t("vault.changePass.submitButton")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
