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
import { TAB_PALETTE } from "@/modules/tabs/TabColorBubbles";
import { ComputerIcon, Key01Icon, ServerStack01Icon, UserIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useRef, useState } from "react";
import { addRdpConnection, updateRdpConnection } from "../rdpStore";
import type { RdpConnectionProfile } from "../types";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connection?: RdpConnectionProfile | null;
  onSaved?: (conn: RdpConnectionProfile, autoConnect: boolean) => void;
};

export function RdpConnectionDialog({
  open,
  onOpenChange,
  connection,
  onSaved,
}: Props) {
  const { t } = useTranslation();

  const [name, setName] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("3389");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [domain, setDomain] = useState("");
  const [resolution, setResolution] = useState("1280x800");
  const [ignoreCert, setIgnoreCert] = useState(true);
  const [color, setColor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hostInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    if (connection) {
      setName(connection.name);
      setHost(connection.host);
      setPort(String(connection.port ?? 3389));
      setUsername(connection.username ?? "");
      setPassword(connection.password ?? "");
      setDomain(connection.domain ?? "");
      setResolution(
        connection.width && connection.height
          ? `${connection.width}x${connection.height}`
          : "1280x800",
      );
      setIgnoreCert(connection.ignoreCert ?? true);
      setColor(connection.color ?? null);
    } else {
      setName("");
      setHost("");
      setPort("3389");
      setUsername("");
      setPassword("");
      setDomain("");
      setResolution("1280x800");
      setIgnoreCert(true);
      setColor(null);
    }
    setError(null);
  }, [open, connection]);

  const handleSave = (autoConnect = false) => {
    const trimmedHost = host.trim();
    if (!trimmedHost) {
      setError(t("rdp.dialog.hostRequired"));
      hostInputRef.current?.focus();
      return;
    }

    const parsedPort = Number.parseInt(port, 10);
    const validPort = !Number.isNaN(parsedPort) && parsedPort > 0 ? parsedPort : 3389;
    const [width, height] = resolution.split("x").map(Number);
    const finalName = name.trim() || trimmedHost;

    if (connection) {
      updateRdpConnection(connection.id, {
        name: finalName,
        host: trimmedHost,
        port: validPort,
        username: username.trim() || undefined,
        password: password || undefined,
        domain: domain.trim() || undefined,
        width: width || 1280,
        height: height || 800,
        ignoreCert,
        color: color || undefined,
      });
      onSaved?.(
        {
          ...connection,
          name: finalName,
          host: trimmedHost,
          port: validPort,
          username: username.trim() || undefined,
          password: password || undefined,
          domain: domain.trim() || undefined,
          width: width || 1280,
          height: height || 800,
          ignoreCert,
          color: color || undefined,
        },
        autoConnect,
      );
    } else {
      const created = addRdpConnection({
        name: finalName,
        host: trimmedHost,
        port: validPort,
        username: username.trim() || undefined,
        password: password || undefined,
        domain: domain.trim() || undefined,
        width: width || 1280,
        height: height || 800,
        ignoreCert,
        color: color || undefined,
      });
      onSaved?.(created, autoConnect);
    }

    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[85vh] flex flex-col p-0 gap-0 overflow-hidden rounded-2xl border border-border/50 bg-popover/95 backdrop-blur-xl">
        <DialogHeader className="p-6 pb-3 border-b border-border/40 shrink-0 gap-1">
          <div className="flex items-center gap-2 text-primary">
            <HugeiconsIcon icon={ComputerIcon} size={20} />
            <DialogTitle className="text-base font-semibold text-foreground">
              {connection
                ? t("rdp.dialog.editTitle")
                : t("rdp.dialog.newTitle")}
            </DialogTitle>
          </div>
          <DialogDescription className="text-xs text-muted-foreground">
            {t("rdp.dialog.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-3.5 text-xs">
          {error && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-400">
              {error}
            </div>
          )}
          {/* Display Name */}
          <div className="flex flex-col gap-1">
            <Label htmlFor="rdp-name" className="text-xs font-medium text-foreground/80">
              {t("rdp.dialog.nameLabel")}
            </Label>
            <Input
              id="rdp-name"
              placeholder={t("rdp.dialog.namePlaceholder")}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-8 text-xs bg-background/50"
            />
          </div>

          {/* Host & Port */}
          <div className="flex gap-2">
            <div className="flex-1 flex flex-col gap-1">
              <Label htmlFor="rdp-host" className="text-xs font-medium text-foreground/80">
                {t("rdp.host")} *
              </Label>
              <div className="relative">
                <HugeiconsIcon
                  icon={ServerStack01Icon}
                  size={13}
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/60"
                />
                <Input
                  id="rdp-host"
                  ref={hostInputRef}
                  required
                  placeholder="192.168.1.50 or rdp.corp.local"
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  className="h-8 pl-8 text-xs font-mono bg-background/50"
                />
              </div>
            </div>
            <div className="w-24 flex flex-col gap-1">
              <Label htmlFor="rdp-port" className="text-xs font-medium text-foreground/80">
                {t("rdp.port")}
              </Label>
              <Input
                id="rdp-port"
                placeholder="3389"
                value={port}
                onChange={(e) => setPort(e.target.value)}
                className="h-8 text-xs font-mono bg-background/50"
              />
            </div>
          </div>

          {/* Username & Domain */}
          <div className="flex gap-2">
            <div className="flex-1 flex flex-col gap-1">
              <Label htmlFor="rdp-username" className="text-xs font-medium text-foreground/80">
                {t("rdp.username")}
              </Label>
              <div className="relative">
                <HugeiconsIcon
                  icon={UserIcon}
                  size={13}
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/60"
                />
                <Input
                  id="rdp-username"
                  placeholder="Administrator"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="h-8 pl-8 text-xs bg-background/50"
                />
              </div>
            </div>
            <div className="w-32 flex flex-col gap-1">
              <Label htmlFor="rdp-domain" className="text-xs font-medium text-foreground/80">
              {t("rdp.domain")}
              </Label>
              <Input
                id="rdp-domain"
                placeholder="WORKGROUP"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                className="h-8 text-xs bg-background/50"
              />
            </div>
          </div>

          {/* Password */}
          <div className="flex flex-col gap-1">
            <Label htmlFor="rdp-password" className="text-xs font-medium text-foreground/80">
              {t("rdp.password")}
            </Label>
            <div className="relative">
              <HugeiconsIcon
                icon={Key01Icon}
                size={13}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/60"
              />
              <Input
                id="rdp-password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-8 pl-8 text-xs bg-background/50"
              />
            </div>
          </div>

          {/* Resolution */}
          <div className="flex flex-col gap-1">
            <Label className="text-xs font-medium text-foreground/80">
              {t("rdp.resolution")}
            </Label>
            <select
              value={resolution}
              onChange={(e) => setResolution(e.target.value)}
              className="h-8 w-full rounded-md border border-input bg-background/50 px-3 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="1280x800">1280 x 800 (16:10)</option>
              <option value="1920x1080">1920 x 1080 (Full HD)</option>
              <option value="1600x900">1600 x 900 (HD+)</option>
              <option value="1024x768">1024 x 768 (4:3)</option>
              <option value="2560x1440">2560 x 1440 (2K QHD)</option>
            </select>
          </div>

          {/* Color tag */}
          <div className="flex flex-col gap-1.5 pt-1">
            <Label className="text-xs font-medium text-foreground/80">
              {t("rdp.dialog.colorTag")}
            </Label>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setColor(null)}
                className={`size-5 rounded-full border border-border text-[10px] flex items-center justify-center ${
                  color === null ? "ring-2 ring-primary ring-offset-1" : ""
                }`}
                title={t("common.none")}
              >
                ✕
              </button>
              {TAB_PALETTE.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => setColor(p.value)}
                  className={`size-5 rounded-full transition-transform ${
                    color === p.value ? "scale-125 ring-2 ring-primary ring-offset-1" : "hover:scale-110"
                  }`}
                  style={{ backgroundColor: p.value }}
                  title={t(`projectToolkit.colorNames.${p.key}`)}
                />
              ))}
            </div>
          </div>

          {/* Ignore cert checkbox */}
          <div className="flex items-center gap-2 pt-1">
            <input
              type="checkbox"
              id="rdp-dialog-ignore-cert"
              checked={ignoreCert}
              onChange={(e) => setIgnoreCert(e.target.checked)}
              className="size-3.5 rounded border-border text-primary focus:ring-primary"
            />
            <Label
              htmlFor="rdp-dialog-ignore-cert"
              className="text-xs text-muted-foreground font-normal cursor-pointer"
            >
              {t("rdp.ignoreCert")}
            </Label>
          </div>
        </div>

        <DialogFooter className="p-4 px-6 border-t border-border/40 bg-muted/15 shrink-0 flex items-center justify-between gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="text-xs"
          >
            {t("common.cancel")}
          </Button>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleSave(false)}
              className="text-xs"
            >
            {t("common.save")}
            </Button>
            <Button
              size="sm"
              onClick={() => handleSave(true)}
              className="text-xs font-semibold"
            >
            {t("rdp.dialog.saveAndConnect")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
