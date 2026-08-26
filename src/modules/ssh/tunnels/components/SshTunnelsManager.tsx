import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTranslation } from "@/modules/i18n";
import {
  addSshTunnel,
  deleteSshTunnel,
  initTunnelListeners,
  stopAllSshTunnels,
  toggleSshTunnel,
  updateSshTunnel,
  useLiveTunnelStore,
  useSshTunnels,
} from "../tunnelStore";
import {
  buildTunnelSshCommand,
  formatTunnelDirection,
  type SshTunnelConfig,
  type TunnelType,
} from "../types";
import { TunnelDialog } from "./TunnelDialog";
import {
  Add01Icon,
  Alert02Icon,
  CheckmarkCircle02Icon,
  Copy01Icon,
  Delete02Icon,
  Edit02Icon,
  GlobalIcon,
  PlayIcon,
  Search01Icon,
  ServerStack01Icon,
  StopIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

interface Props {
  filterConnectionId?: string;
  hideHeader?: boolean;
}

export function SshTunnelsManager({
  filterConnectionId,
  hideHeader = false,
}: Props) {
  const { t } = useTranslation();
  const allTunnels = useSshTunnels();
  const activeTunnels = useLiveTunnelStore((s) => s.activeTunnels);

  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "active" | TunnelType>(
    "all",
  );

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingTunnel, setEditingTunnel] = useState<SshTunnelConfig | null>(
    null,
  );
  const [tunnelToDelete, setTunnelToDelete] = useState<string | null>(null);

  // Initialize Tauri event listeners for tunnel state changes
  useEffect(() => {
    let cleanup: (() => void) | undefined;
    void initTunnelListeners().then((fn) => {
      cleanup = fn;
    });
    return () => {
      cleanup?.();
    };
  }, []);

  const tunnels = useMemo(() => {
    let list = allTunnels;
    if (filterConnectionId) {
      list = list.filter((t) => t.connectionId === filterConnectionId);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.host.toLowerCase().includes(q) ||
          String(t.localPort).includes(q) ||
          String(t.remotePort ?? "").includes(q),
      );
    }
    if (typeFilter === "active") {
      list = list.filter(
        (t) => activeTunnels[t.id]?.status === "active" || activeTunnels[t.id]?.status === "connecting",
      );
    } else if (typeFilter !== "all") {
      list = list.filter((t) => t.tunnelType === typeFilter);
    }
    return list;
  }, [allTunnels, filterConnectionId, searchQuery, typeFilter, activeTunnels]);

  const hasAnyActive = Object.values(activeTunnels).some(
    (s) => s.status === "active" || s.status === "connecting",
  );

  const handleCreate = () => {
    setEditingTunnel(null);
    setIsDialogOpen(true);
  };

  const handleEdit = (tunnel: SshTunnelConfig) => {
    setEditingTunnel(tunnel);
    setIsDialogOpen(true);
  };

  const handleSave = async (data: Omit<SshTunnelConfig, "id">) => {
    if (editingTunnel) {
      await updateSshTunnel(editingTunnel.id, data);
    } else {
      await addSshTunnel(data);
    }
  };

  const handleDeleteConfirm = async (id: string) => {
    try {
      await deleteSshTunnel(id);
      toast.success(t("ssh.tunnels.toast.deleted"));
      setTunnelToDelete(null);
    } catch (err) {
      toast.error(String(err));
    }
  };

  const copyCommand = (tunnel: SshTunnelConfig) => {
    const cmd = buildTunnelSshCommand(tunnel);
    void navigator.clipboard.writeText(cmd);
    toast.success(t("ssh.tunnels.toast.copiedCommand"));
  };

  const copyLocalAddress = (tunnel: SshTunnelConfig) => {
    const addr = `${tunnel.localHost || "127.0.0.1"}:${tunnel.localPort}`;
    void navigator.clipboard.writeText(addr);
    toast.success(t("ssh.tunnels.toast.copiedAddress"));
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      {!hideHeader && (
        <div className="flex flex-wrap items-center justify-between gap-3 pb-2 border-b border-border/40">
          <div className="flex flex-col gap-0.5">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
              <HugeiconsIcon icon={ServerStack01Icon} size={16} />
              <span>{t("ssh.tunnels.title")}</span>
            </h3>
            <p className="text-xs text-muted-foreground">
              {t("ssh.tunnels.description")}
            </p>
          </div>

          <div className="flex items-center gap-2">
            {hasAnyActive && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void stopAllSshTunnels()}
                className="h-8 text-xs gap-1.5 text-destructive hover:text-destructive hover:bg-destructive/10 cursor-pointer"
              >
                <HugeiconsIcon icon={StopIcon} size={14} />
                <span>{t("ssh.tunnels.stopAllButton")}</span>
              </Button>
            )}
            <Button
              variant="default"
              size="sm"
              onClick={handleCreate}
              className="h-8 text-xs gap-1.5 cursor-pointer"
            >
              <HugeiconsIcon icon={Add01Icon} size={14} />
              <span>{t("ssh.tunnels.newButton")}</span>
            </Button>
          </div>
        </div>
      )}

      {/* Filter and Search Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button
            variant={typeFilter === "all" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setTypeFilter("all")}
            className="h-7 px-2.5 text-xs cursor-pointer"
          >
            {t("ssh.tunnels.filterAll")} ({allTunnels.length})
          </Button>
          <Button
            variant={typeFilter === "active" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setTypeFilter("active")}
            className="h-7 px-2.5 text-xs gap-1.5 cursor-pointer"
          >
            <span className="flex h-2 w-2 rounded-full bg-emerald-500" />
            <span>{t("ssh.tunnels.filterActive")}</span>
          </Button>
          <Button
            variant={typeFilter === "local" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setTypeFilter("local")}
            className="h-7 px-2.5 text-xs cursor-pointer"
          >
            {t("ssh.tunnels.typeLocal")} (-L)
          </Button>
          <Button
            variant={typeFilter === "remote" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setTypeFilter("remote")}
            className="h-7 px-2.5 text-xs cursor-pointer"
          >
            {t("ssh.tunnels.typeRemote")} (-R)
          </Button>
          <Button
            variant={typeFilter === "dynamic" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setTypeFilter("dynamic")}
            className="h-7 px-2.5 text-xs cursor-pointer"
          >
            {t("ssh.tunnels.typeDynamic")} (-D)
          </Button>
        </div>

        <div className="relative w-48">
          <HugeiconsIcon
            icon={Search01Icon}
            size={13}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("ssh.tunnels.searchPlaceholder")}
            className="h-7 text-xs pl-8 font-mono"
          />
        </div>
      </div>

      {/* Tunnels List */}
      {tunnels.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/80 p-8 text-center bg-card/40">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground mb-2">
            <HugeiconsIcon icon={ServerStack01Icon} size={20} />
          </div>
          <p className="text-xs font-medium text-foreground">
            {allTunnels.length === 0
              ? t("ssh.tunnels.emptyTitle")
              : t("ssh.tunnels.noMatches")}
          </p>
          <p className="text-[11px] text-muted-foreground max-w-xs mt-1 mb-3">
            {allTunnels.length === 0
              ? t("ssh.tunnels.emptySubtitle")
              : t("ssh.tunnels.noMatchesSubtitle")}
          </p>
          {allTunnels.length === 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleCreate}
              className="h-7 text-xs gap-1.5 cursor-pointer"
            >
              <HugeiconsIcon icon={Add01Icon} size={13} />
              <span>{t("ssh.tunnels.newButton")}</span>
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2.5">
          {tunnels.map((tunnel) => {
            const statusState = activeTunnels[tunnel.id] || {
              status: "stopped",
            };
            const isLive = statusState.status === "active";
            const isConnecting = statusState.status === "connecting";
            const isError = statusState.status === "error";

            return (
              <div
                key={tunnel.id}
                className={`flex flex-col md:flex-row md:items-center justify-between gap-3 rounded-lg border p-3.5 transition-all shadow-xs ${
                  isLive
                    ? "border-emerald-500/40 bg-emerald-500/5 dark:bg-emerald-950/15"
                    : isError
                      ? "border-destructive/40 bg-destructive/5"
                      : "border-border/80 bg-card hover:border-border"
                }`}
              >
                {/* Left info */}
                <div className="flex items-start gap-3 min-w-0">
                  {/* Toggle Button */}
                  <Button
                    variant={isLive ? "default" : "outline"}
                    size="sm"
                    onClick={() => void toggleSshTunnel(tunnel.id)}
                    disabled={isConnecting}
                    className={`h-9 w-9 p-0 shrink-0 cursor-pointer rounded-lg ${
                      isLive
                        ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                        : ""
                    }`}
                    title={
                      isLive
                        ? t("ssh.tunnels.stopTunnel")
                        : t("ssh.tunnels.startTunnel")
                    }
                  >
                    {isLive ? (
                      <HugeiconsIcon icon={StopIcon} size={16} />
                    ) : isConnecting ? (
                      <span className="flex h-3 w-3 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                    ) : (
                      <HugeiconsIcon icon={PlayIcon} size={16} />
                    )}
                  </Button>

                  <div className="flex flex-col gap-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-semibold text-foreground truncate">
                        {tunnel.name}
                      </span>

                      {/* Type Badge */}
                      <span
                        className={`inline-flex items-center px-1.5 py-0.2 rounded text-[10px] font-medium uppercase tracking-wider ${
                          tunnel.tunnelType === "local"
                            ? "bg-blue-500/10 text-blue-600 dark:text-blue-400"
                            : tunnel.tunnelType === "remote"
                              ? "bg-purple-500/10 text-purple-600 dark:text-purple-400"
                              : "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                        }`}
                      >
                        {tunnel.tunnelType === "local"
                          ? t("ssh.tunnelDialog.typeLocal")
                          : tunnel.tunnelType === "remote"
                            ? t("ssh.tunnelDialog.typeRemote")
                            : t("ssh.tunnelDialog.typeDynamic")}
                      </span>

                      {/* Server badge */}
                      <span className="text-[11px] text-muted-foreground font-mono truncate">
                        {tunnel.user ? `${tunnel.user}@` : ""}
                        {tunnel.host}
                        {tunnel.port && tunnel.port !== 22 ? `:${tunnel.port}` : ""}
                      </span>
                    </div>

                    {/* Port mapping route */}
                    <div className="flex items-center gap-1.5 text-xs font-mono text-muted-foreground">
                      <HugeiconsIcon icon={GlobalIcon} size={13} className="text-primary/70 shrink-0" />
                      <span className="text-foreground/90 font-medium">
                        {formatTunnelDirection(tunnel)}
                      </span>
                    </div>

                    {/* Error message if any */}
                    {isError && statusState.error && (
                      <div className="flex items-center gap-1 text-[11px] text-destructive">
                        <HugeiconsIcon icon={Alert02Icon} size={12} className="shrink-0" />
                        <span className="truncate">{statusState.error}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Right Actions */}
                <div className="flex items-center gap-1.5 shrink-0 self-end md:self-center">
                  {isLive && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => copyLocalAddress(tunnel)}
                      className="h-7 px-2 text-[11px] gap-1 cursor-pointer text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10"
                      title={t("ssh.tunnels.copyAddressTooltip")}
                    >
                      <HugeiconsIcon icon={CheckmarkCircle02Icon} size={13} />
                      <span>{tunnel.localHost || "127.0.0.1"}:{tunnel.localPort}</span>
                    </Button>
                  )}

                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => copyCommand(tunnel)}
                    className="h-7 w-7 p-0 cursor-pointer text-muted-foreground hover:text-foreground"
                    title={t("ssh.tunnels.copyCommandTooltip")}
                  >
                    <HugeiconsIcon icon={Copy01Icon} size={13} />
                  </Button>

                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleEdit(tunnel)}
                    className="h-7 w-7 p-0 cursor-pointer text-muted-foreground hover:text-foreground"
                    title={t("ssh.tunnels.editTunnel")}
                  >
                    <HugeiconsIcon icon={Edit02Icon} size={13} />
                  </Button>

                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setTunnelToDelete(tunnel.id)}
                    className="h-7 w-7 p-0 cursor-pointer text-muted-foreground hover:text-destructive"
                    title={t("ssh.tunnels.deleteTunnel")}
                  >
                    <HugeiconsIcon icon={Delete02Icon} size={13} />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {tunnelToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5 max-w-sm w-full shadow-lg">
            <h4 className="text-sm font-semibold text-foreground">
              {t("ssh.tunnels.deleteConfirmTitle")}
            </h4>
            <p className="text-xs text-muted-foreground">
              {t("ssh.tunnels.deleteConfirmDescription")}
            </p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setTunnelToDelete(null)}
              >
                {t("dialog.cancel")}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => void handleDeleteConfirm(tunnelToDelete)}
              >
                {t("dialog.delete")}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Tunnel Add/Edit Modal */}
      <TunnelDialog
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        tunnel={editingTunnel}
        defaultConnectionId={filterConnectionId}
        onSave={handleSave}
      />
    </div>
  );
}
