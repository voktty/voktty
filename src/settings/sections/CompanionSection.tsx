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

type PendingPairing = {
  id: string;
  deviceName: string;
  fingerprint: string;
  expiresAtMs: number;
};

function pairingPayload(invitation: Invitation): string {
  return JSON.stringify({ type: "voktty-companion", invitation });
}

export function CompanionSection() {
  const { t } = useTranslation();
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [status, setStatus] = useState<CompanionStatus | null>(null);
  const [pending, setPending] = useState<PendingPairing[]>([]);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    const next = await invoke<CompanionStatus>("companion_status");
    setStatus(next);
    if (!next.active) setInvitation(null);
    const requests = await invoke<PendingPairing[]>("companion_pending_pairings");
    setPending(requests);
  }, []);

  useEffect(() => {
    void refreshStatus().catch(() => {});
  }, [refreshStatus]);

  useEffect(() => {
    if (status?.active !== true) return;
    const interval = setInterval(() => {
      void refreshStatus().catch(() => {});
    }, 1500);
    return () => clearInterval(interval);
  }, [refreshStatus, status?.active]);

  useEffect(() => {
    if (!invitation) {
      setQrCode(null);
      return;
    }
    let cancelled = false;
    void import("qrcode")
      .then((module) => module.toDataURL(pairingPayload(invitation), {
        errorCorrectionLevel: "M",
        margin: 1,
        width: 256,
      }))
      .then((value) => {
        if (!cancelled) setQrCode(value);
      })
      .catch(() => {
        if (!cancelled) setQrCode(null);
      });
    return () => {
      cancelled = true;
    };
  }, [invitation]);

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

  const decide = async (requestId: string, approved: boolean) => {
    await invoke("companion_decide_pairing", { requestId, approved });
    await refreshStatus();
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
            {qrCode ? (
              <div className="mt-3 inline-flex rounded-lg bg-white p-2">
                <img
                  src={qrCode}
                  alt={t("settings.companion.qrCode")}
                  className="size-48"
                />
              </div>
            ) : (
              <p className="mt-3 text-xs text-muted-foreground">
                {t("settings.companion.generatingQr")}
              </p>
            )}
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
      {pending.length > 0 ? (
        <section className="rounded-xl border border-border/50 bg-card/40 p-4">
          <h2 className="text-sm font-medium">{t("settings.companion.pendingTitle")}</h2>
          <div className="mt-3 flex flex-col gap-2">
            {pending.map((request) => (
              <div
                key={request.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/40 bg-background/40 p-3"
              >
                <div>
                  <p className="text-sm font-medium">{request.deviceName}</p>
                  <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                    {t("settings.companion.fingerprint", {
                      fingerprint: request.fingerprint,
                    })}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void decide(request.id, false)}
                  >
                    {t("settings.companion.reject")}
                  </Button>
                  <Button size="sm" onClick={() => void decide(request.id, true)}>
                    {t("settings.companion.approve")}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
