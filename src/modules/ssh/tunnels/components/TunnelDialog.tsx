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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTranslation } from "@/modules/i18n";
import { useSshConnections } from "@/modules/ssh/sshStore";
import type { SshTunnelConfig, TunnelType } from "../types";
import {
  ArrowRight01Icon,
  GlobalIcon,
  ServerStack01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tunnel?: SshTunnelConfig | null;
  defaultConnectionId?: string;
  onSave: (data: Omit<SshTunnelConfig, "id">) => Promise<void>;
};

export function TunnelDialog({
  open,
  onOpenChange,
  tunnel,
  defaultConnectionId,
  onSave,
}: Props) {
  const { t } = useTranslation();
  const connections = useSshConnections();

  const [name, setName] = useState("");
  const [tunnelType, setTunnelType] = useState<TunnelType>("local");
  const [connectionId, setConnectionId] = useState<string>("custom");

  // Endpoint Details
  const [localHost, setLocalHost] = useState("127.0.0.1");
  const [localPort, setLocalPort] = useState<number>(3306);
  const [remoteHost, setRemoteHost] = useState("127.0.0.1");
  const [remotePort, setRemotePort] = useState<number>(3306);

  // SSH Host Details (if custom)
  const [host, setHost] = useState("");
  const [port, setPort] = useState<number>(22);
  const [user, setUser] = useState("");
  const [identityFile, setIdentityFile] = useState("");
  const [extraArgs, setExtraArgs] = useState("");
  const [autoStart, setAutoStart] = useState(false);

  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!open) return;

    if (tunnel) {
      setName(tunnel.name || "");
      setTunnelType(tunnel.tunnelType || "local");
      setConnectionId(tunnel.connectionId || "custom");
      setLocalHost(tunnel.localHost || "127.0.0.1");
      setLocalPort(tunnel.localPort || 3306);
      setRemoteHost(tunnel.remoteHost || "127.0.0.1");
      setRemotePort(tunnel.remotePort ?? tunnel.localPort ?? 3306);
      setHost(tunnel.host || "");
      setPort(tunnel.port || 22);
      setUser(tunnel.user || "");
      setIdentityFile(tunnel.identityFile || "");
      setExtraArgs(tunnel.extraArgs || "");
      setAutoStart(Boolean(tunnel.autoStart));
    } else {
      const connId = defaultConnectionId || (connections[0]?.id ?? "custom");
      const matched = connections.find((c) => c.id === connId);
      setName("");
      setTunnelType("local");
      setConnectionId(connId);
      setLocalHost("127.0.0.1");
      setLocalPort(3306);
      setRemoteHost("127.0.0.1");
      setRemotePort(3306);
      setHost(matched?.host || "");
      setPort(matched?.port || 22);
      setUser(matched?.user || "");
      setIdentityFile(matched?.identityFile || "");
      setExtraArgs(matched?.extraArgs || "");
      setAutoStart(false);
    }
  }, [open, tunnel, defaultConnectionId, connections]);

  const handleConnectionSelect = (val: string) => {
    setConnectionId(val);
    if (val !== "custom") {
      const matched = connections.find((c) => c.id === val);
      if (matched) {
        setHost(matched.host);
        setPort(matched.port || 22);
        setUser(matched.user || "");
        setIdentityFile(matched.identityFile || "");
        setExtraArgs(matched.extraArgs || "");
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      toast.error(t("ssh.tunnelDialog.validation.nameRequired"));
      return;
    }
    if (connectionId === "custom" && !host.trim()) {
      toast.error(t("ssh.tunnelDialog.validation.hostRequired"));
      return;
    }
    if (!localPort || localPort < 1 || localPort > 65535) {
      toast.error(t("ssh.tunnelDialog.validation.invalidLocalPort"));
      return;
    }
    if (
      tunnelType !== "dynamic" &&
      (!remotePort || remotePort < 1 || remotePort > 65535)
    ) {
      toast.error(t("ssh.tunnelDialog.validation.invalidRemotePort"));
      return;
    }

    setIsSaving(true);
    try {
      await onSave({
        name: name.trim(),
        tunnelType,
        connectionId: connectionId !== "custom" ? connectionId : undefined,
        localHost: localHost.trim() || "127.0.0.1",
        localPort: Number(localPort),
        remoteHost:
          tunnelType !== "dynamic"
            ? remoteHost.trim() || "127.0.0.1"
            : undefined,
        remotePort:
          tunnelType !== "dynamic" ? Number(remotePort) : undefined,
        host: host.trim(),
        port: Number(port) || 22,
        user: user.trim() || undefined,
        identityFile: identityFile.trim() || undefined,
        extraArgs: extraArgs.trim() || undefined,
        autoStart,
      });
      toast.success(
        tunnel
          ? t("ssh.tunnelDialog.toast.updated")
          : t("ssh.tunnelDialog.toast.created"),
      );
      onOpenChange(false);
    } catch (err) {
      toast.error(String(err));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <HugeiconsIcon icon={ServerStack01Icon} size={18} />
            <span>
              {tunnel
                ? t("ssh.tunnelDialog.editTitle")
                : t("ssh.tunnelDialog.newTitle")}
            </span>
          </DialogTitle>
          <DialogDescription className="text-xs">
            {t("ssh.tunnelDialog.description")}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 py-2">
          {/* Rule Name */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tunnel-name" className="text-xs font-medium">
              {t("ssh.tunnelDialog.nameLabel")} <span className="text-destructive">*</span>
            </Label>
            <Input
              id="tunnel-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("ssh.tunnelDialog.namePlaceholder")}
              className="h-8 text-xs"
              required
              autoFocus
            />
          </div>

          {/* Forwarding Type */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs font-medium">
              {t("ssh.tunnelDialog.typeLabel")}
            </Label>
            <Select
              value={tunnelType}
              onValueChange={(val: TunnelType) => setTunnelType(val)}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="local">
                  <span className="font-medium">{t("ssh.tunnelDialog.typeLocal")}</span>
                  <span className="text-muted-foreground ml-1">
                    ({t("ssh.tunnelDialog.typeLocalDesc")})
                  </span>
                </SelectItem>
                <SelectItem value="remote">
                  <span className="font-medium">{t("ssh.tunnelDialog.typeRemote")}</span>
                  <span className="text-muted-foreground ml-1">
                    ({t("ssh.tunnelDialog.typeRemoteDesc")})
                  </span>
                </SelectItem>
                <SelectItem value="dynamic">
                  <span className="font-medium">{t("ssh.tunnelDialog.typeDynamic")}</span>
                  <span className="text-muted-foreground ml-1">
                    ({t("ssh.tunnelDialog.typeDynamicDesc")})
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* SSH Server Target */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs font-medium">
              {t("ssh.tunnelDialog.serverLabel")}
            </Label>
            <Select
              value={connectionId}
              onValueChange={handleConnectionSelect}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {connections.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name} ({c.user ? `${c.user}@` : ""}{c.host})
                  </SelectItem>
                ))}
                <SelectItem value="custom">
                  {t("ssh.tunnelDialog.customServerOption")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* If Custom Server, provide host fields */}
          {connectionId === "custom" && (
            <div className="rounded-lg border border-border/70 bg-muted/20 p-3 flex flex-col gap-3">
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2 flex flex-col gap-1">
                  <Label className="text-[11px] text-muted-foreground">
                    {t("ssh.dialog.host")} *
                  </Label>
                  <Input
                    value={host}
                    onChange={(e) => setHost(e.target.value)}
                    placeholder="192.168.1.100"
                    className="h-7 text-xs font-mono"
                    required
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="text-[11px] text-muted-foreground">
                    {t("ssh.dialog.port")}
                  </Label>
                  <Input
                    type="number"
                    value={port}
                    onChange={(e) => setPort(Number(e.target.value))}
                    className="h-7 text-xs font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="flex flex-col gap-1">
                  <Label className="text-[11px] text-muted-foreground">
                    {t("ssh.dialog.user")}
                  </Label>
                  <Input
                    value={user}
                    onChange={(e) => setUser(e.target.value)}
                    placeholder="root"
                    className="h-7 text-xs font-mono"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="text-[11px] text-muted-foreground">
                    {t("ssh.dialog.identityFile")}
                  </Label>
                  <Input
                    value={identityFile}
                    onChange={(e) => setIdentityFile(e.target.value)}
                    placeholder="~/.ssh/id_rsa"
                    className="h-7 text-xs font-mono"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Port Mappings Visual Matrix */}
          <div className="rounded-lg border border-border/80 bg-card p-3 flex flex-col gap-3">
            <div className="text-xs font-semibold text-foreground flex items-center gap-1.5">
              <HugeiconsIcon icon={GlobalIcon} size={14} />
              <span>{t("ssh.tunnelDialog.endpointsHeading")}</span>
            </div>

            {tunnelType === "local" && (
              <div className="flex items-center gap-2">
                <div className="flex-1 flex flex-col gap-1">
                  <Label className="text-[11px] text-muted-foreground">
                    {t("ssh.tunnelDialog.localBind")}
                  </Label>
                  <div className="flex items-center gap-1">
                    <Input
                      value={localHost}
                      onChange={(e) => setLocalHost(e.target.value)}
                      placeholder="127.0.0.1"
                      className="h-7 text-xs font-mono flex-1"
                    />
                    <span className="text-xs text-muted-foreground">:</span>
                    <Input
                      type="number"
                      value={localPort}
                      onChange={(e) => setLocalPort(Number(e.target.value))}
                      className="h-7 text-xs font-mono w-20"
                      required
                    />
                  </div>
                </div>

                <div className="pt-4 text-muted-foreground">
                  <HugeiconsIcon icon={ArrowRight01Icon} size={16} />
                </div>

                <div className="flex-1 flex flex-col gap-1">
                  <Label className="text-[11px] text-muted-foreground">
                    {t("ssh.tunnelDialog.remoteDest")}
                  </Label>
                  <div className="flex items-center gap-1">
                    <Input
                      value={remoteHost}
                      onChange={(e) => setRemoteHost(e.target.value)}
                      placeholder="127.0.0.1"
                      className="h-7 text-xs font-mono flex-1"
                    />
                    <span className="text-xs text-muted-foreground">:</span>
                    <Input
                      type="number"
                      value={remotePort}
                      onChange={(e) => setRemotePort(Number(e.target.value))}
                      className="h-7 text-xs font-mono w-20"
                      required
                    />
                  </div>
                </div>
              </div>
            )}

            {tunnelType === "remote" && (
              <div className="flex items-center gap-2">
                <div className="flex-1 flex flex-col gap-1">
                  <Label className="text-[11px] text-muted-foreground">
                    {t("ssh.tunnelDialog.remoteBindPort")}
                  </Label>
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-muted-foreground font-mono">0.0.0.0:</span>
                    <Input
                      type="number"
                      value={remotePort}
                      onChange={(e) => setRemotePort(Number(e.target.value))}
                      className="h-7 text-xs font-mono flex-1"
                      required
                    />
                  </div>
                </div>

                <div className="pt-4 text-muted-foreground">
                  <HugeiconsIcon icon={ArrowRight01Icon} size={16} />
                </div>

                <div className="flex-1 flex flex-col gap-1">
                  <Label className="text-[11px] text-muted-foreground">
                    {t("ssh.tunnelDialog.localDest")}
                  </Label>
                  <div className="flex items-center gap-1">
                    <Input
                      value={localHost}
                      onChange={(e) => setLocalHost(e.target.value)}
                      placeholder="127.0.0.1"
                      className="h-7 text-xs font-mono flex-1"
                    />
                    <span className="text-xs text-muted-foreground">:</span>
                    <Input
                      type="number"
                      value={localPort}
                      onChange={(e) => setLocalPort(Number(e.target.value))}
                      className="h-7 text-xs font-mono w-20"
                      required
                    />
                  </div>
                </div>
              </div>
            )}

            {tunnelType === "dynamic" && (
              <div className="flex flex-col gap-1">
                <Label className="text-[11px] text-muted-foreground">
                  {t("ssh.tunnelDialog.socksPortLabel")}
                </Label>
                <div className="flex items-center gap-1.5">
                  <Input
                    value={localHost}
                    onChange={(e) => setLocalHost(e.target.value)}
                    placeholder="127.0.0.1"
                    className="h-7 text-xs font-mono flex-1"
                  />
                  <span className="text-xs text-muted-foreground">:</span>
                  <Input
                    type="number"
                    value={localPort}
                    onChange={(e) => setLocalPort(Number(e.target.value))}
                    className="h-7 text-xs font-mono w-24"
                    required
                  />
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              {t("dialog.cancel")}
            </Button>
            <Button
              type="submit"
              variant="default"
              size="sm"
              disabled={isSaving}
            >
              {isSaving ? t("dialog.saving") : t("dialog.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
