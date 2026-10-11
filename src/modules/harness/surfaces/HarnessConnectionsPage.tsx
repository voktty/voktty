import { AddRemoteProjectDialog } from "@/modules/connections";
import { useTranslation } from "@/modules/i18n";
import { openSettingsWindow } from "@/modules/settings/openSettingsWindow";
import { formatSshSubtitle, useSshConnections } from "@/modules/ssh";
import { useState } from "react";
import { Internet } from "../chrome/icons";

export function HarnessConnectionsPage() {
  const { t } = useTranslation();
  const connections = useSshConnections();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [connectionId, setConnectionId] = useState<string>();

  const openFolder = (id?: string) => {
    setConnectionId(id);
    setDialogOpen(true);
  };

  return (
    <div className="flex flex-col gap-5" data-setting-id="remote-connections">
      <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-content/10 bg-content/3 p-4">
        <p className="max-w-2xl text-[12px] leading-relaxed text-content/60">
          {t("harness.connections.intro")}
        </p>
        <button
          type="button"
          className="rounded-lg border border-content/15 px-3 py-2 text-[12px] font-medium text-content/75 hover:bg-content/5 hover:text-content"
          onClick={() => void openSettingsWindow("ssh")}
        >
          {connections.length
            ? t("harness.connections.manageProfiles")
            : t("harness.connections.addProfile")}
        </button>
      </section>

      <section aria-label={t("harness.connections.profilesTitle")}>
        <h2 className="mb-2 text-[13px] font-semibold text-content">
          {t("harness.connections.profilesTitle")}
        </h2>
        {connections.length ? (
          <div className="divide-y divide-content/10 overflow-hidden rounded-xl border border-content/10">
            {connections.map((connection) => (
              <div
                key={connection.id}
                className="flex items-center gap-3 px-4 py-3"
              >
                <Internet className="size-4 shrink-0 text-content/45" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium text-content">
                    {connection.name}
                  </div>
                  <div className="mt-0.5 truncate text-[12px] text-content/45">
                    {formatSshSubtitle(connection)}
                  </div>
                </div>
                <button
                  type="button"
                  className="shrink-0 rounded-lg bg-selection px-3 py-2 text-[12px] font-medium hover:bg-selection-hover"
                  onClick={() => openFolder(connection.id)}
                >
                  {t("harness.connections.openFolder")}
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-content/15 px-5 py-7 text-center">
            <p className="text-[13px] font-medium text-content/75">
              {t("harness.connections.emptyTitle")}
            </p>
            <p className="mx-auto mt-1 max-w-lg text-[12px] leading-relaxed text-content/45">
              {t("harness.connections.emptyDescription")}
            </p>
          </div>
        )}
      </section>

      {dialogOpen ? (
        <AddRemoteProjectDialog
          initialConnectionId={connectionId}
          onCancel={() => setDialogOpen(false)}
          onOpen={(path) => {
            setDialogOpen(false);
            window.dispatchEvent(
              new CustomEvent("voktty:harness-select-project", {
                detail: { path },
              }),
            );
          }}
        />
      ) : null}
    </div>
  );
}
