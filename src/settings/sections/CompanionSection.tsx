import { Button } from "@/components/ui/button";
import { useTranslation } from "@/modules/i18n";
import { invoke } from "@tauri-apps/api/core";
import { Copy01Icon, StopIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback, useEffect, useState } from "react";
import { SectionHeader } from "../components/SectionHeader";

type Invitation = {
  protocol: number;
  publicUrl: string;
  invitationId: string;
  hostPublicKey: string;
  secret: string;
  expiresAtMs: number;
};

type CompanionStatus = {
  active: boolean;
  expiresAtMs: number | null;
  publicUrl: string | null;
};

function pairingPayload(invitation: Invitation): string {
  return JSON.stringify({ type: "voktty-companion", invitation });
}

export function CompanionSection() {
  const { t } = useTranslation();
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [status, setStatus] = useState<CompanionStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    const next = await invoke<CompanionStatus>("companion_status");
    setStatus(next);
    if (!next.active) setInvitation(null);
  }, []);

  useEffect(() => {
    void refreshStatus().catch(() => {});
  }, [refreshStatus]);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await invoke<{ invitation: Invitation }>("companion_start");
      setInvitation(result.invitation);
      await refreshStatus();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    setBusy(true);
    try {
      await invoke("companion_stop");
      setInvitation(null);
      await refreshStatus();
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!invitation) return;
    await navigator.clipboard.writeText(pairingPayload(invitation));
  };

  const expiry = invitation?.expiresAtMs ?? status?.expiresAtMs;
  const active = invitation !== null || status?.active === true;

  return (
    <div className="flex flex-col gap-5">
      <SectionHeader
        title={t("settings.companion.title")}
        description={t("settings.companion.description")}
      />
      <section className="rounded-xl border border-border/50 bg-card/40 p-4">
        <h2 className="text-sm font-medium">{t("settings.companion.scopeTitle")}</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {t("settings.companion.scopeDescription")}
        </p>
      </section>
      <section className="rounded-xl border border-border/50 bg-card/40 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">
              {active ? t("settings.companion.active") : t("settings.companion.inactive")}
            </p>
            {expiry ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {t("settings.companion.expires", {
                  time: new Date(expiry).toLocaleTimeString(),
                })}
              </p>
            ) : null}
          </div>
          {active ? (
            <Button variant="outline" disabled={busy} onClick={() => void stop()}>
              <HugeiconsIcon icon={StopIcon} size={15} />
              {t("settings.companion.stop")}
            </Button>
          ) : (
            <Button disabled={busy} onClick={() => void start()}>
              {busy ? t("settings.companion.starting") : t("settings.companion.start")}
            </Button>
          )}
        </div>
        {invitation ? (
          <div className="mt-4 rounded-lg border border-border/40 bg-background/40 p-3">
            <p className="text-xs text-muted-foreground">{t("settings.companion.tunnel")}</p>
            <p className="mt-1 break-all font-mono text-xs">{invitation.publicUrl}</p>
            <Button className="mt-3" size="sm" variant="secondary" onClick={() => void copy()}>
              <HugeiconsIcon icon={Copy01Icon} size={14} />
              {t("settings.companion.copyPayload")}
            </Button>
          </div>
        ) : null}
        {error ? (
          <p className="mt-3 text-xs text-destructive">
            {t("settings.companion.error", { message: error })}
          </p>
        ) : null}
      </section>
    </div>
  );
}
