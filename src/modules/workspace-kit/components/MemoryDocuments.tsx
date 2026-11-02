import { useState } from "react";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { useTranslation } from "@/modules/i18n";
import type { MemoryDocumentsState } from "@/modules/workspace-kit/lib/memoryPanel";

export function MemoryDocuments({
  state,
  onBack,
  onRefresh,
}: {
  state: MemoryDocumentsState;
  onBack: () => void;
  onRefresh: () => void;
}) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<string | null>(null);
  const snapshot = state.status === "documentsReady" ? state.snapshot : null;
  const file =
    snapshot?.files.find((item) => item.path === selected) ??
    snapshot?.files.find((item) => item.fact.kind === "file");
  const loading = state.status === "documentsLoading";
  return (
    <>
      <div className="min-w-0 space-y-3" aria-busy={loading}>
        {loading ? <p role="status">{t("common.loading")}</p> : null}
        {state.status === "documentsError" ? (
          <p role="alert">
            {t("projectMemory.error")} <code>{state.code}</code>
          </p>
        ) : null}
        {snapshot ? (
          <>
            <p className="break-all font-mono text-xs" dir="auto">
              {snapshot.root}
            </p>
            {!snapshot.complete ? (
              <p role="alert">
                {t("projectMemory.incomplete")} ({snapshot.blockedCount})
              </p>
            ) : null}
            <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
              <fieldset
                className="max-h-72 space-y-1 overflow-auto"
                aria-label={t("common.browse")}
              >
                {snapshot.files.map((item) => (
                  <Button
                    key={item.path}
                    variant={file === item ? "secondary" : "ghost"}
                    size="sm"
                    className="h-auto w-full justify-start whitespace-normal break-all text-left font-mono text-xs"
                    aria-pressed={file === item}
                    onClick={() => setSelected(item.path)}
                  >
                    {item.path}
                  </Button>
                ))}
              </fieldset>
              <div className="min-w-0 rounded border border-border p-3">
                {file ? (
                  <>
                    <p className="mb-3 break-all font-mono text-xs" dir="auto">
                      {file.path}
                    </p>
                    {file.fact.kind === "file" ? (
                      <pre
                        className="max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs"
                        dir="auto"
                      >
                        {file.fact.text}
                      </pre>
                    ) : (
                      <p role="status">
                        {t(
                          file.fact.kind === "absent"
                            ? "projectMemory.missingFile"
                            : "projectMemory.currentUnavailable",
                        )}
                      </p>
                    )}
                  </>
                ) : (
                  <p role="status">{t("common.noResults")}</p>
                )}
              </div>
            </div>
          </>
        ) : null}
      </div>
      <DialogFooter>
        <Button size="sm" variant="outline" disabled={loading} onClick={onBack}>
          {t("common.back")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={loading}
          onClick={onRefresh}
        >
          {t("common.refresh")}
        </Button>
      </DialogFooter>
    </>
  );
}
