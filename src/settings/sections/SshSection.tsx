import { Button } from "@/components/ui/button";
import { useTranslation } from "@/modules/i18n";
import {
  deleteSshConnection,
  formatSshSubtitle,
  importSshConfigHosts,
  SshConnectionDialog,
  updateSshConnection,
  useSshConnections,
  type SshConnection,
} from "@/modules/ssh";
import { SshTunnelsManager } from "@/modules/ssh/tunnels";
import { InlineRename } from "@/modules/spaces/components/InlineRename";
import {
  Add01Icon,
  Delete02Icon,
  Download01Icon,
  Edit02Icon,
  GlobalIcon,
  PencilEdit02Icon,
  ServerStack01Icon,
  ServerStack03Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";
import { SectionHeader } from "../components/SectionHeader";

export function SshSection() {
  const { t } = useTranslation();
  const connections = useSshConnections();
  const [activeSubTab, setActiveSubTab] = useState<"servers" | "tunnels">("servers");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingConn, setEditingConn] = useState<SshConnection | null>(null);
  const [renamingConnId, setRenamingConnId] = useState<string | null>(null);
  const [importStatus, setImportStatus] = useState<string | null>(null);

  const handleOpenNew = () => {
    setEditingConn(null);
    setDialogOpen(true);
  };

  const handleEdit = (conn: SshConnection) => {
    setEditingConn(conn);
    setDialogOpen(true);
  };

  const handleDelete = (id: string) => {
    void deleteSshConnection(id);
  };

  const handleCommitRename = (conn: SshConnection, name: string) => {
    const nextName = name.trim();
    if (nextName && nextName !== conn.name) {
      void updateSshConnection(conn.id, { name: nextName });
    }
    setRenamingConnId(null);
  };

  const handleImport = async () => {
    setImportStatus(null);
    const res = await importSshConfigHosts();
    if (res.totalFound === 0) {
      setImportStatus(t("ssh.noConfigFound"));
    } else {
      setImportStatus(
        t("ssh.importSuccess", {
          imported: res.importedCount,
          total: res.totalFound,
        }),
      );
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <SectionHeader
        title={t("ssh.title")}
        description={t("ssh.description")}
      />

      {/* Sub-tab Navigation */}
      <div className="flex items-center gap-1 border-b border-border/40 pb-2">
        <Button
          variant={activeSubTab === "servers" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => setActiveSubTab("servers")}
          className="h-8 text-xs gap-1.5 cursor-pointer"
        >
          <HugeiconsIcon icon={ServerStack01Icon} size={14} />
          <span>{t("ssh.subtabs.servers")} ({connections.length})</span>
        </Button>
        <Button
          variant={activeSubTab === "tunnels" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => setActiveSubTab("tunnels")}
          className="h-8 text-xs gap-1.5 cursor-pointer"
        >
          <HugeiconsIcon icon={GlobalIcon} size={14} />
          <span>{t("ssh.subtabs.tunnels")}</span>
        </Button>
      </div>

      {activeSubTab === "servers" && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 px-2.5 text-xs cursor-pointer"
              onClick={handleImport}
            >
              <HugeiconsIcon icon={Download01Icon} size={14} strokeWidth={1.75} />
              {t("ssh.importConfig")}
            </Button>

            <Button
              size="sm"
              className="h-8 gap-1.5 px-2.5 text-xs cursor-pointer"
              onClick={handleOpenNew}
            >
              <HugeiconsIcon icon={Add01Icon} size={14} strokeWidth={2} />
              {t("ssh.newConnection")}
            </Button>
          </div>

          {importStatus && (
            <div className="rounded-lg border border-border/70 bg-accent/40 px-3 py-2 text-xs text-muted-foreground">
              {importStatus}
            </div>
          )}

          {connections.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/80 p-8 text-center bg-card/40">
              <div className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <HugeiconsIcon icon={ServerStack03Icon} size={20} strokeWidth={1.75} />
              </div>
              <span className="mt-3 text-xs font-medium text-foreground">
                {t("ssh.noConnectionsTitle")}
              </span>
              <span className="mt-1 max-w-sm text-[11px] text-muted-foreground">
                {t("ssh.noConnectionsDesc")}
              </span>
              <Button
                size="sm"
                variant="outline"
                className="mt-4 h-7 gap-1.5 text-xs cursor-pointer"
                onClick={handleOpenNew}
              >
                <HugeiconsIcon icon={Add01Icon} size={13} strokeWidth={2} />
                {t("ssh.newConnection")}
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {connections.map((conn) => (
                <div
                  key={conn.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-card/60 p-2.5 transition-colors hover:border-border hover:bg-card"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent text-foreground">
                      <HugeiconsIcon icon={ServerStack01Icon} size={16} strokeWidth={1.75} />
                    </div>
                    <div className="flex min-w-0 flex-col">
                      {renamingConnId === conn.id ? (
                        <InlineRename
                          initial={conn.name}
                          ariaLabel={t("common.rename")}
                          onCommit={(name) => handleCommitRename(conn, name)}
                          onCancel={() => setRenamingConnId(null)}
                          className="h-6 text-xs"
                        />
                      ) : (
                        <span className="truncate text-xs font-medium text-foreground">
                          {conn.name}
                        </span>
                      )}
                      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                        <span className="font-mono">{formatSshSubtitle(conn)}</span>
                        {conn.identityFile ? (
                          <span className="truncate max-w-40 text-[10px] text-muted-foreground/70">
                            ({conn.identityFile})
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1">
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      onClick={() => setRenamingConnId(conn.id)}
                      title={t("common.rename")}
                      className="size-7 rounded-md text-muted-foreground hover:text-foreground cursor-pointer"
                    >
                      <HugeiconsIcon icon={PencilEdit02Icon} size={13} strokeWidth={1.75} />
                    </Button>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      onClick={() => handleEdit(conn)}
                      title={t("common.edit")}
                      className="size-7 rounded-md text-muted-foreground hover:text-foreground cursor-pointer"
                    >
                      <HugeiconsIcon icon={Edit02Icon} size={13} strokeWidth={1.75} />
                    </Button>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      onClick={() => handleDelete(conn.id)}
                      title={t("common.delete")}
                      className="size-7 rounded-md text-muted-foreground hover:text-destructive cursor-pointer"
                    >
                      <HugeiconsIcon icon={Delete02Icon} size={13} strokeWidth={1.75} />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeSubTab === "tunnels" && (
        <SshTunnelsManager />
      )}

      <SshConnectionDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        connection={editingConn}
      />
    </div>
  );
}
