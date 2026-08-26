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
import { credentialsFromGuestForm } from "@/modules/collab/lib/invite";
import type { GuestTerminalCredentials } from "@/modules/collab/types";
import { useTranslation } from "@/modules/i18n";
import { ConnectIcon, SquareLock01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useState } from "react";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConnect: (credentials: GuestTerminalCredentials) => void;
};

export function GuestConnectDialog({ open, onOpenChange, onConnect }: Props) {
  const { t } = useTranslation();
  const [connectionUrl, setConnectionUrl] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [participantName, setParticipantName] = useState("");
  const [errorKey, setErrorKey] = useState<string | null>(null);

  useEffect(() => {
    if (open) setErrorKey(null);
  }, [open]);

  const handleConnect = () => {
    try {
      const credentials = credentialsFromGuestForm({
        connectionUrl,
        inviteCode,
        participantName,
      });
      onConnect(credentials);
      onOpenChange(false);
      setConnectionUrl("");
      setInviteCode("");
    } catch (error) {
      const code =
        error instanceof Error ? error.message : "invalid_invitation";
      setErrorKey(`collab.errors.${code}`);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] w-full sm:max-w-lg max-w-lg flex flex-col gap-0 p-0 overflow-hidden border-border bg-card text-card-foreground shadow-2xl rounded-3xl">
        <DialogHeader className="p-6 pb-4 border-b border-border/40 shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-sky-500/10 text-sky-400 shrink-0">
              <HugeiconsIcon icon={ConnectIcon} size={20} strokeWidth={1.8} />
            </div>
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-base font-semibold">{t("collab.guest.title")}</DialogTitle>
              <DialogDescription className="mt-0.5 text-xs text-muted-foreground">
                {t("collab.guest.description")}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="collab-url" className="text-xs font-medium text-foreground">
              {t("collab.guest.urlLabel")}
            </Label>
            <Input
              id="collab-url"
              value={connectionUrl}
              onChange={(event) => setConnectionUrl(event.target.value)}
              placeholder={t("collab.guest.urlPlaceholder")}
              className="h-9 font-mono text-xs rounded-xl"
              autoComplete="off"
            />
          </div>
          <div className="grid gap-3.5 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="collab-code" className="text-xs font-medium text-foreground">
                {t("collab.guest.codeLabel")}
              </Label>
              <Input
                id="collab-code"
                type="password"
                value={inviteCode}
                onChange={(event) => setInviteCode(event.target.value)}
                placeholder={t("collab.guest.codePlaceholder")}
                className="h-9 font-mono text-xs rounded-xl"
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="collab-name" className="text-xs font-medium text-foreground">
                {t("collab.guest.nameLabel")}
              </Label>
              <Input
                id="collab-name"
                value={participantName}
                onChange={(event) => setParticipantName(event.target.value)}
                placeholder={t("collab.guest.namePlaceholder")}
                className="h-9 text-xs rounded-xl"
                autoComplete="name"
              />
            </div>
          </div>

          <div className="flex gap-2.5 rounded-2xl border border-sky-500/20 bg-sky-500/[0.06] p-3.5 text-[11.5px] leading-relaxed text-muted-foreground">
            <HugeiconsIcon
              icon={SquareLock01Icon}
              size={15}
              className="mt-0.5 shrink-0 text-sky-400"
            />
            <span>{t("collab.guest.securityNote")}</span>
          </div>
          {errorKey ? (
            <p role="alert" className="text-xs text-destructive font-medium">
              {t(errorKey)}
            </p>
          ) : null}
        </div>

        <DialogFooter className="p-4 px-6 border-t border-border/40 bg-muted/10 shrink-0 sm:justify-end">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} className="rounded-xl">
            {t("common.cancel")}
          </Button>
          <Button size="sm" className="gap-1.5 rounded-xl px-4" onClick={handleConnect}>
            <HugeiconsIcon icon={ConnectIcon} size={14} />
            {t("collab.guest.connect")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
