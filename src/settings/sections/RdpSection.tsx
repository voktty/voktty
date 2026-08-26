import { Button } from "@/components/ui/button";
import { useTranslation } from "@/modules/i18n";
import {
  deleteRdpConnection,
  RdpConnectionDialog,
  useRdpConnections,
  type RdpConnectionProfile,
} from "@/modules/rdp";
import {
  Add01Icon,
  ComputerIcon,
  Delete02Icon,
  Edit02Icon,
  PlayIcon,
  ServerStack01Icon,
  UserIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";
import { SectionHeader } from "../components/SectionHeader";

type Props = {
  onConnectToRdp?: (profile: RdpConnectionProfile) => void;
};

export function RdpSection({ onConnectToRdp }: Props) {
  const { t } = useTranslation();
  const connections = useRdpConnections();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingConn, setEditingConn] = useState<RdpConnectionProfile | null>(null);

  const handleOpenNew = () => {
    setEditingConn(null);
    setDialogOpen(true);
  };

  const handleEdit = (conn: RdpConnectionProfile) => {
    setEditingConn(conn);
    setDialogOpen(true);
  };

  const handleDelete = (id: string) => {
    deleteRdpConnection(id);
  };

  return (
    <div className="flex flex-col gap-5">
      <SectionHeader
        title={t("rdp.section.title")}
        description={t("rdp.section.description")}
      />

      {/* Action Bar */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          {t("rdp.savedProfiles")} ({connections.length})
        </span>
        <Button
          size="sm"
          onClick={handleOpenNew}
          className="h-8 gap-1.5 text-xs font-semibold"
        >
          <HugeiconsIcon icon={Add01Icon} size={14} />
          <span>{t("rdp.newConnection")}</span>
        </Button>
      </div>

      {/* Connections List */}
      {connections.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/60 p-10 text-center bg-card/30">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary border border-primary/20 shadow-sm mb-3">
            <HugeiconsIcon icon={ComputerIcon} size={24} />
          </div>
          <h4 className="text-sm font-semibold text-foreground">
            {t("rdp.noConnectionsTitle")}
          </h4>
          <p className="text-xs text-muted-foreground max-w-sm mt-1 mb-4">
            {t("rdp.noConnectionsSubtitle")}
          </p>
          <Button size="sm" onClick={handleOpenNew} className="text-xs gap-1.5">
            <HugeiconsIcon icon={Add01Icon} size={14} />
            <span>{t("rdp.addFirstConnection")}</span>
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {connections.map((conn) => (
            <div
              key={conn.id}
              className="group relative flex flex-col justify-between rounded-xl border border-border/40 bg-card/60 p-3.5 backdrop-blur-sm shadow-xs transition-all hover:border-border/80 hover:bg-card hover:shadow-md"
            >
              {/* Top Row: Name, Host, Color */}
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div
                    className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border/50 text-foreground"
                    style={
                      conn.color
                        ? { backgroundColor: `${conn.color}20`, borderColor: `${conn.color}60` }
                        : undefined
                    }
                  >
                    <HugeiconsIcon icon={ComputerIcon} size={16} />
                  </div>
                  <div className="min-w-0">
                    <h5 className="text-xs font-semibold text-foreground truncate">
                      {conn.name}
                    </h5>
                    <div className="flex items-center gap-1.5 text-[11px] font-mono text-muted-foreground">
                      <HugeiconsIcon icon={ServerStack01Icon} size={11} className="shrink-0" />
                      <span className="truncate">
                        {conn.host}:{conn.port || 3389}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity">
                  <button
                    type="button"
                    onClick={() => handleEdit(conn)}
                    title={t("common.edit")}
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                  >
                    <HugeiconsIcon icon={Edit02Icon} size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(conn.id)}
                    title={t("common.delete")}
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-rose-500/10 hover:text-rose-400 transition-colors"
                  >
                    <HugeiconsIcon icon={Delete02Icon} size={13} />
                  </button>
                </div>
              </div>

              {/* Bottom Meta & Connect Button */}
              <div className="mt-3.5 flex items-center justify-between border-t border-border/30 pt-2.5">
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  {conn.username ? (
                    <span className="flex items-center gap-1">
                      <HugeiconsIcon icon={UserIcon} size={12} />
                      <span className="font-mono">{conn.username}</span>
                    </span>
                  ) : (
                    <span>{t("rdp.pane.noUsername")}</span>
                  )}
                  {conn.width && conn.height && (
                    <span className="text-[10px] text-muted-foreground/60">
                      ({conn.width}x{conn.height})
                    </span>
                  )}
                </div>

                {onConnectToRdp && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => onConnectToRdp(conn)}
                    className="h-7 px-2.5 text-[11px] font-semibold gap-1"
                  >
                    <HugeiconsIcon icon={PlayIcon} size={11} />
                    <span>{t("rdp.connect")}</span>
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Dialog */}
      <RdpConnectionDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        connection={editingConn}
        onSaved={(conn, autoConnect) => {
          if (autoConnect && onConnectToRdp) {
            onConnectToRdp(conn);
          }
        }}
      />
    </div>
  );
}
