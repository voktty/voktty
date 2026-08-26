import { invoke } from "@tauri-apps/api/core";
import {
  CheckmarkCircle02Icon,
  ComputerIcon,
  Copy01Icon,
  Loading03Icon,
  PencilEdit02Icon,
  PlayIcon,
  Refresh01Icon,
  SecurityIcon,
  ServerStack01Icon,
  UserIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useTranslation } from "@/modules/i18n";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RdpConnectOptions } from "../types";
import { RdpConnectForm } from "./RdpConnectForm";

export type RdpPaneProps = {
  host: string;
  port?: number;
  username?: string;
  domain?: string;
  autoConnect?: boolean;
};

type ProbeResult = {
  online: boolean;
  latency_ms?: number;
  error?: string;
};

export function RdpPane({
  host,
  port = 3389,
  username,
  domain,
  autoConnect = true,
}: RdpPaneProps) {
  const { t } = useTranslation();
  const [editingForm, setEditingForm] = useState(!host);
  const [copied, setCopied] = useState(false);
  const [probing, setProbing] = useState(false);
  const [probeResult, setProbeResult] = useState<ProbeResult | null>(null);
  const [launchedCount, setLaunchedCount] = useState(0);

  const initialOptions: RdpConnectOptions | null = useMemo(
    () =>
      host
        ? {
            host,
            port: port || 3389,
            username,
            domain,
            width: 1280,
            height: 800,
            ignore_cert: true,
          }
        : null,
    [host, port, username, domain],
  );

  const launchNative = useCallback(async () => {
    if (!host) return;
    try {
      await invoke("rdp_launch_native", {
        host,
        port: port || 3389,
        username: username || undefined,
      });
      setLaunchedCount((c) => c + 1);
    } catch (e) {
      console.error("[RDP] Error launching native client:", e);
    }
  }, [host, port, username]);

  const probeHost = useCallback(async () => {
    if (!host) return;
    setProbing(true);
    try {
      const res = await invoke<ProbeResult>("rdp_probe_host", {
        host,
        port: port || 3389,
      });
      setProbeResult(res);
    } catch (e) {
      setProbeResult({
        online: false,
        error: String(e),
      });
    } finally {
      setProbing(false);
    }
  }, [host, port]);

  const autoLaunchedRef = useRef(false);
  useEffect(() => {
    if (host) {
      void probeHost();
      if (autoConnect && !autoLaunchedRef.current) {
        autoLaunchedRef.current = true;
        void launchNative();
      }
    }
  }, [host, autoConnect, probeHost, launchNative]);

  const copyCommand = () => {
    const cmd = `mstsc /v:${host}:${port || 3389}`;
    void navigator.clipboard.writeText(cmd);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (editingForm || !host) {
    return (
      <RdpConnectForm
        initialOptions={initialOptions || undefined}
        onConnect={(_opts) => {
          setEditingForm(false);
          void launchNative();
          void probeHost();
        }}
        loading={false}
      />
    );
  }

  return (
    <div className="flex h-full w-full flex-col overflow-y-auto bg-gradient-to-b from-background/90 via-background to-background/95 p-6 select-none [-ms-overflow-style:none] [scrollbar-width:thin]">
      <div className="mx-auto w-full max-w-2xl space-y-6 animate-in fade-in zoom-in-95 duration-200">
        {/* Main Hero Card */}
        <div className="relative overflow-hidden rounded-2xl border border-border/50 bg-card/70 p-6 shadow-xl backdrop-blur-xl">
          <div className="absolute top-0 right-0 -mt-8 -mr-8 size-48 rounded-full bg-primary/5 blur-3xl pointer-events-none" />

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500/20 to-sky-500/10 text-blue-500 border border-blue-500/25 shadow-md">
                <HugeiconsIcon icon={ComputerIcon} size={28} />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-xl font-bold tracking-tight text-foreground truncate font-mono">
                    {host}
                  </h1>
                  <span className="rounded-md bg-secondary/80 px-2 py-0.5 font-mono text-xs text-secondary-foreground border border-border/40">
                    :{port || 3389}
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                  {username ? (
                    <span className="flex items-center gap-1">
                      <HugeiconsIcon icon={UserIcon} size={13} />
                      <span className="font-medium text-foreground/80">{username}</span>
                      {domain ? <span className="opacity-70">({domain})</span> : null}
                    </span>
                  ) : (
                    <span>{t("rdp.pane.noUsername")}</span>
                  )}
                  <span>•</span>
                  <span>{t("rdp.pane.protocol")}</span>
                </div>
              </div>
            </div>

            {/* Live Ping Badge */}
            <div className="flex items-center gap-2 self-start sm:self-auto">
              <div
                className={`flex items-center gap-2 rounded-xl px-3 py-1.5 border text-xs font-medium backdrop-blur-md ${
                  probing
                    ? "bg-muted/40 border-border/40 text-muted-foreground"
                    : probeResult?.online
                    ? "bg-emerald-500/10 border-emerald-500/25 text-emerald-600 dark:text-emerald-400"
                    : "bg-rose-500/10 border-rose-500/25 text-rose-600 dark:text-rose-400"
                }`}
              >
                {probing ? (
                  <>
                    <HugeiconsIcon
                      icon={Loading03Icon}
                      size={14}
                      className="animate-spin text-muted-foreground"
                    />
                    <span>{t("rdp.pane.checkingPort")}</span>
                  </>
                ) : probeResult?.online ? (
                  <>
                    <span className="size-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)] animate-pulse" />
                    <span>{t("rdp.pane.portActive", { port: port || 3389 })}</span>
                    {probeResult.latency_ms !== undefined && (
                      <span className="font-mono text-[11px] opacity-80">
                        ({probeResult.latency_ms}ms)
                      </span>
                    )}
                  </>
                ) : (
                  <>
                    <span className="size-2 rounded-full bg-rose-500" />
                    <span>{t("rdp.pane.portUnavailable")}</span>
                  </>
                )}
              </div>

              <button
                type="button"
                onClick={() => void probeHost()}
                disabled={probing}
                title={t("rdp.pane.checkConnectivity")}
                className="flex size-8 shrink-0 items-center justify-center rounded-xl border border-border/50 bg-background/60 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50 cursor-pointer"
              >
                <HugeiconsIcon
                  icon={Refresh01Icon}
                  size={14}
                  className={probing ? "animate-spin" : ""}
                />
              </button>
            </div>
          </div>

          {/* Primary CTA Buttons */}
          <div className="mt-6 flex flex-wrap items-center gap-3 pt-5 border-t border-border/40">
            <button
              type="button"
              onClick={() => void launchNative()}
              className="flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-xs font-semibold text-white shadow-lg shadow-blue-500/20 hover:bg-blue-500 hover:shadow-blue-500/30 active:scale-[0.98] transition-all cursor-pointer"
            >
              <HugeiconsIcon icon={PlayIcon} size={16} />
              <span>
                {launchedCount > 0
                  ? t("rdp.pane.reopenNative")
                  : t("rdp.pane.openNative")}
              </span>
            </button>

            <button
              type="button"
              onClick={copyCommand}
              className="flex items-center gap-1.5 rounded-xl border border-border/50 bg-background/60 px-3.5 py-2.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-all cursor-pointer"
            >
              <HugeiconsIcon
                icon={copied ? CheckmarkCircle02Icon : Copy01Icon}
                size={14}
                className={copied ? "text-emerald-500" : ""}
              />
              <span>{copied ? t("rdp.pane.commandCopied") : t("rdp.pane.copyCli")}</span>
            </button>

            <button
              type="button"
              onClick={() => setEditingForm(true)}
              className="flex items-center gap-1.5 rounded-xl border border-border/50 bg-background/60 px-3.5 py-2.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-all cursor-pointer ml-auto"
            >
              <HugeiconsIcon icon={PencilEdit02Icon} size={14} />
              <span>{t("rdp.pane.editProfile")}</span>
            </button>
          </div>
        </div>

        {/* Diagnostic & Details Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Card 1: Connection Specifications */}
          <div className="rounded-2xl border border-border/40 bg-card/50 p-4 backdrop-blur-md">
            <div className="flex items-center gap-2 mb-3 text-xs font-semibold text-foreground uppercase tracking-wider">
              <HugeiconsIcon icon={ServerStack01Icon} size={14} className="text-primary" />
              <span>{t("rdp.pane.serverDetails")}</span>
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex justify-between py-1 border-b border-border/20">
                <span className="text-muted-foreground">{t("rdp.pane.hostIp")}</span>
                <span className="font-mono text-foreground font-medium">{host}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-border/20">
                <span className="text-muted-foreground">{t("rdp.pane.rdpPort")}</span>
                <span className="font-mono text-foreground font-medium">{port || 3389}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-border/20">
                <span className="text-muted-foreground">{t("rdp.pane.assignedUser")}</span>
                <span className="font-mono text-foreground font-medium">
                  {username || t("rdp.pane.promptOnConnect")}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-border/20">
                <span className="text-muted-foreground">{t("rdp.domain")}:</span>
                <span className="font-mono text-foreground font-medium">
                  {domain || t("rdp.pane.noneValue")}
                </span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-muted-foreground">{t("rdp.pane.nativeClient")}</span>
                <span className="text-foreground font-medium">Microsoft mstsc.exe</span>
              </div>
            </div>
          </div>

          {/* Card 2: Useful RDP Shortcuts */}
          <div className="rounded-2xl border border-border/40 bg-card/50 p-4 backdrop-blur-md">
            <div className="flex items-center gap-2 mb-3 text-xs font-semibold text-foreground uppercase tracking-wider">
              <HugeiconsIcon icon={SecurityIcon} size={14} className="text-primary" />
              <span>{t("rdp.pane.usefulShortcuts")}</span>
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between py-1 border-b border-border/20">
                <span className="text-muted-foreground">{t("rdp.pane.remoteCtrlAltDel")}</span>
                <kbd className="rounded bg-secondary/80 px-1.5 py-0.5 font-mono text-[10px] text-foreground border border-border/40">
                  Ctrl + Alt + Fin
                </kbd>
              </div>
              <div className="flex items-center justify-between py-1 border-b border-border/20">
                <span className="text-muted-foreground">{t("rdp.pane.fullscreenWindow")}</span>
                <kbd className="rounded bg-secondary/80 px-1.5 py-0.5 font-mono text-[10px] text-foreground border border-border/40">
                  Ctrl + Alt + Break
                </kbd>
              </div>
              <div className="flex items-center justify-between py-1 border-b border-border/20">
                <span className="text-muted-foreground">{t("rdp.pane.switchWindows")}</span>
                <kbd className="rounded bg-secondary/80 px-1.5 py-0.5 font-mono text-[10px] text-foreground border border-border/40">
                  Alt + Insert
                </kbd>
              </div>
              <div className="flex items-center justify-between py-1">
                <span className="text-muted-foreground">{t("rdp.pane.remoteStartMenu")}</span>
                <kbd className="rounded bg-secondary/80 px-1.5 py-0.5 font-mono text-[10px] text-foreground border border-border/40">
                  Alt + Home
                </kbd>
              </div>
            </div>
          </div>
        </div>

        {/* Tip Banner */}
        <div className="flex items-start gap-3 rounded-xl border border-blue-500/20 bg-blue-500/5 p-3.5 text-xs text-muted-foreground">
          <HugeiconsIcon
            icon={CheckmarkCircle02Icon}
            size={18}
            className="text-blue-500 shrink-0 mt-0.5"
          />
          <p className="leading-relaxed">
            {t("rdp.pane.tip", { action: t("rdp.pane.openNative") })}
          </p>
        </div>
      </div>
    </div>
  );
}
