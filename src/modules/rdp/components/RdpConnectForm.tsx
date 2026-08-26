import { openSettingsWindow } from "@/modules/settings/openSettingsWindow";
import { useTranslation } from "@/modules/i18n";
import {
  ComputerIcon,
  Key01Icon,
  Loading03Icon,
  ServerStack01Icon,
  Settings01Icon,
  UserIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type React from "react";
import { useState } from "react";
import { addRdpConnection, useRdpConnections } from "../rdpStore";
import type { RdpConnectionProfile, RdpConnectOptions } from "../types";

type Props = {
  initialOptions?: Partial<RdpConnectOptions>;
  loading?: boolean;
  onConnect: (options: RdpConnectOptions) => void;
};

export function RdpConnectForm({ initialOptions, loading, onConnect }: Props) {
  const { t } = useTranslation();
  const savedConnections = useRdpConnections();

  const [host, setHost] = useState(initialOptions?.host || "");
  const [port, setPort] = useState(initialOptions?.port || 3389);
  const [username, setUsername] = useState(initialOptions?.username || "");
  const [password, setPassword] = useState(initialOptions?.password || "");
  const [domain, setDomain] = useState(initialOptions?.domain || "");
  const [resolution, setResolution] = useState("1280x800");
  const [ignoreCert, setIgnoreCert] = useState(initialOptions?.ignore_cert ?? true);
  const [saveProfile, setSaveProfile] = useState(false);

  const applyProfile = (p: RdpConnectionProfile) => {
    setHost(p.host);
    setPort(p.port || 3389);
    setUsername(p.username || "");
    setPassword(p.password || "");
    setDomain(p.domain || "");
    if (p.width && p.height) {
      setResolution(`${p.width}x${p.height}`);
    }
    if (p.ignoreCert !== undefined) {
      setIgnoreCert(p.ignoreCert);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!host.trim()) return;

    const [width, height] = resolution.split("x").map(Number);

    if (saveProfile && !savedConnections.some((c) => c.host === host.trim())) {
      addRdpConnection({
        name: host.trim(),
        host: host.trim(),
        port: Number(port) || 3389,
        username: username.trim() || undefined,
        password: password || undefined,
        domain: domain.trim() || undefined,
        width: width || 1280,
        height: height || 800,
        ignoreCert,
      });
    }

    onConnect({
      host: host.trim(),
      port: Number(port) || 3389,
      username: username.trim() || undefined,
      password: password || undefined,
      domain: domain.trim() || undefined,
      width: width || 1280,
      height: height || 800,
      ignore_cert: ignoreCert,
    });
  };

  return (
    <div className="flex h-full w-full items-center justify-center p-6 bg-background/50">
      <div className="w-full max-w-md rounded-2xl border border-border/40 bg-card/80 p-6 shadow-xl backdrop-blur-xl animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-primary/15 text-primary border border-primary/20 shadow-xs">
              <HugeiconsIcon icon={ComputerIcon} size={22} />
            </div>
            <div>
              <h2 className="text-base font-semibold text-foreground">
                {t("rdp.newConnection")}
              </h2>
              <p className="text-xs text-muted-foreground">
                {t("rdp.connectSubtitle")}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => void openSettingsWindow("rdp")}
            title={t("rdp.manageInSettings")}
            className="flex size-8 items-center justify-center rounded-lg border border-border/50 bg-background/60 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <HugeiconsIcon icon={Settings01Icon} size={15} />
          </button>
        </div>

        {/* Saved Profiles Quick Bar */}
        {savedConnections.length > 0 && (
          <div className="mb-4 flex flex-col gap-1.5 border-b border-border/30 pb-3.5">
            <span className="text-[10.5px] font-semibold text-muted-foreground uppercase tracking-wider">
              {t("rdp.savedProfiles")}
            </span>
            <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
              {savedConnections.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => applyProfile(p)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs transition-all ${
                    host === p.host
                      ? "border-primary/60 bg-primary/10 text-foreground font-medium"
                      : "border-border/40 bg-background/50 text-muted-foreground hover:text-foreground hover:bg-accent"
                  }`}
                >
                  <span
                    className="size-2 rounded-full"
                    style={{ backgroundColor: p.color || "#3b82f6" }}
                  />
                  <span className="truncate max-w-[120px]">{p.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Host & Port */}
          <div className="flex gap-2">
            <div className="flex-1 space-y-1.5">
              <label className="text-[11px] font-medium text-foreground/80">
                {t("rdp.host")}
              </label>
              <div className="relative">
                <HugeiconsIcon
                  icon={ServerStack01Icon}
                  size={14}
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/60"
                />
                <input
                  type="text"
                  required
                  placeholder="192.168.1.100 or pc.local"
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  className="h-8.5 w-full rounded-lg border border-border/50 bg-background/60 pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground/50 focus:border-primary/60 focus:outline-none focus:ring-1 focus:ring-primary/40 font-mono"
                />
              </div>
            </div>

            <div className="w-24 space-y-1.5">
              <label className="text-[11px] font-medium text-foreground/80">
                {t("rdp.port")}
              </label>
              <input
                type="number"
                value={port}
                onChange={(e) => setPort(Number(e.target.value))}
                className="h-8.5 w-full rounded-lg border border-border/50 bg-background/60 px-3 text-xs text-foreground focus:border-primary/60 focus:outline-none focus:ring-1 focus:ring-primary/40 font-mono"
              />
            </div>
          </div>

          {/* Username & Domain */}
          <div className="flex gap-2">
            <div className="flex-1 space-y-1.5">
              <label className="text-[11px] font-medium text-foreground/80">
                {t("rdp.username")}
              </label>
              <div className="relative">
                <HugeiconsIcon
                  icon={UserIcon}
                  size={14}
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/60"
                />
                <input
                  type="text"
                  placeholder="Administrator"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="h-8.5 w-full rounded-lg border border-border/50 bg-background/60 pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground/50 focus:border-primary/60 focus:outline-none focus:ring-1 focus:ring-primary/40"
                />
              </div>
            </div>

            <div className="w-32 space-y-1.5">
              <label className="text-[11px] font-medium text-foreground/80">
                {t("rdp.domain")}
              </label>
              <input
                type="text"
                placeholder="WORKGROUP"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                className="h-8.5 w-full rounded-lg border border-border/50 bg-background/60 px-3 text-xs text-foreground placeholder:text-muted-foreground/50 focus:border-primary/60 focus:outline-none focus:ring-1 focus:ring-primary/40"
              />
            </div>
          </div>

          {/* Password */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-foreground/80">
                {t("rdp.password")}
            </label>
            <div className="relative">
              <HugeiconsIcon
                icon={Key01Icon}
                size={14}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/60"
              />
              <input
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-8.5 w-full rounded-lg border border-border/50 bg-background/60 pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground/50 focus:border-primary/60 focus:outline-none focus:ring-1 focus:ring-primary/40"
              />
            </div>
          </div>

          {/* Resolution Dropdown */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-foreground/80">
                {t("rdp.resolution")}
            </label>
            <select
              value={resolution}
              onChange={(e) => setResolution(e.target.value)}
              className="h-8.5 w-full rounded-lg border border-border/50 bg-background/60 px-3 text-xs text-foreground focus:border-primary/60 focus:outline-none focus:ring-1 focus:ring-primary/40"
            >
              <option value="1280x800">1280 x 800 (16:10)</option>
              <option value="1920x1080">1920 x 1080 (Full HD)</option>
              <option value="1600x900">1600 x 900 (HD+)</option>
              <option value="1024x768">1024 x 768 (4:3)</option>
              <option value="2560x1440">2560 x 1440 (2K QHD)</option>
            </select>
          </div>

          {/* Ignore Cert Checkbox */}
          <div className="flex items-center gap-2 pt-1">
            <input
              type="checkbox"
              id="rdp-ignore-cert"
              checked={ignoreCert}
              onChange={(e) => setIgnoreCert(e.target.checked)}
              className="size-3.5 rounded border-border/60 text-primary focus:ring-primary"
            />
            <label
              htmlFor="rdp-ignore-cert"
              className="text-[11px] text-muted-foreground cursor-pointer"
            >
              {t("rdp.ignoreCert")}
            </label>
          </div>

          {/* Save Profile Checkbox */}
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="rdp-save-profile"
              checked={saveProfile}
              onChange={(e) => setSaveProfile(e.target.checked)}
              className="size-3.5 rounded border-border/60 text-primary focus:ring-primary"
            />
            <label
              htmlFor="rdp-save-profile"
              className="text-[11px] text-muted-foreground cursor-pointer"
            >
              {t("rdp.saveToProfiles")}
            </label>
          </div>

          {/* Submit Button */}
          <div className="pt-2">
            <button
              type="submit"
              disabled={loading || !host.trim()}
              className="flex h-9 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-xs font-semibold text-primary-foreground shadow-sm transition-all hover:bg-primary/90 active:scale-[0.99] disabled:opacity-50"
            >
              {loading ? (
                <>
                  <HugeiconsIcon
                    icon={Loading03Icon}
                    size={14}
                    className="animate-spin"
                  />
                <span>{t("rdp.connecting")}</span>
                </>
              ) : (
                <span>{t("rdp.connect")}</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
