import { useEffect, useState } from "react";
import { Alert02Icon, CheckmarkCircle02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useTranslation } from "@/modules/i18n";
import {
  applyLegacyImport,
  previewLegacyImport,
  type LegacyImportPreview,
} from "../lib/legacyImporter";
import { validateRoster } from "../lib/rosterValidation";
import { readRoster } from "../lib/teamFs";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectPath: string;
  onImportSuccess?: () => void;
};

export function LegacyImportModal({
  open,
  onOpenChange,
  projectPath,
  onImportSuccess,
}: Props) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [preview, setPreview] = useState<LegacyImportPreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [existingRosterFound, setExistingRosterFound] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setPreview(null);
      setLoadError(null);
      setConfirmed(false);
      setSuccessMessage(null);
      return;
    }

    setLoading(true);
    setLoadError(null);
    setConfirmed(false);
    setSuccessMessage(null);

    Promise.all([
      previewLegacyImport(projectPath),
      readRoster(projectPath).then((res) => !!res.roster),
    ])
      .then(([prev, hasExisting]) => {
        setPreview(prev);
        setExistingRosterFound(hasExisting);
      })
      .catch((err: unknown) => {
        setLoadError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        setLoading(false);
      });
  }, [open, projectPath]);

  const validationResult = preview
    ? validateRoster(JSON.stringify(preview.roster))
    : null;
  const isRosterValid = validationResult ? !validationResult.error : false;

  const handleApply = async () => {
    if (!preview || !isRosterValid) return;
    setApplying(true);
    setLoadError(null);
    try {
      await applyLegacyImport(projectPath, preview);
      setSuccessMessage(t("teams.importLegacySuccess"));
      setTimeout(() => {
        onImportSuccess?.();
        onOpenChange(false);
      }, 700);
    } catch (err: unknown) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setApplying(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-[700px]">
        <DialogHeader>
          <DialogTitle>{t("teams.importLegacyTitle")}</DialogTitle>
          <DialogDescription>
            {t("teams.importLegacyDesc")}
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="flex h-36 items-center justify-center text-sm text-muted-foreground">
            {t("common.loading")}...
          </div>
        )}

        {loadError && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            <p className="font-semibold">{t("common.error")}</p>
            <p className="mt-1 font-mono text-xs">{loadError}</p>
          </div>
        )}

        {successMessage && (
          <div className="flex items-center gap-2 rounded-md border border-primary/40 bg-primary/10 p-3 text-sm text-primary">
            <HugeiconsIcon icon={CheckmarkCircle02Icon} size={16} />
            <span>{successMessage}</span>
          </div>
        )}

        {!loading && preview && (
          <div className="space-y-4 text-xs">
            {/* Existing roster notice */}
            {existingRosterFound && (
              <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-amber-500">
                <HugeiconsIcon icon={Alert02Icon} size={16} className="shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">{t("teams.importLegacyExistingWarning")}</p>
                </div>
              </div>
            )}

            {/* Validation status */}
            {!isRosterValid && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-destructive">
                <p className="font-semibold">{t("teams.importLegacyInvalid")}</p>
                <p className="mt-1 font-mono">{validationResult?.error}</p>
              </div>
            )}

            {/* Source info */}
            <div className="rounded-md border bg-muted/30 p-2.5">
              <span className="text-muted-foreground">{t("teams.importLegacySource")} </span>
              <span className="font-mono">{preview.sourceFile}</span>
            </div>

            {/* Agents summary */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="font-semibold text-sm">
                  {t("teams.importLegacyAgents")} ({preview.roster.agents.length})
                </span>
                <Badge variant={isRosterValid ? "outline" : "destructive"}>
                  {isRosterValid ? t("teams.importLegacyValid") : t("teams.importLegacyInvalidBadge")}
                </Badge>
              </div>
              <div className="max-h-48 space-y-1.5 overflow-y-auto rounded-md border p-2">
                {preview.roster.agents.map((agent) => (
                  <div
                    key={agent.name}
                    className="flex items-center justify-between rounded bg-muted/40 px-2 py-1 text-xs"
                  >
                    <div>
                      <span className="font-semibold text-foreground">{agent.name}</span>
                      <span className="ml-2 font-mono text-[11px] text-muted-foreground">
                        {agent.role}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Badge variant="secondary" className="text-[10px]">
                        {agent.runtime?.model || t("teams.importLegacyDefaultModel")}
                      </Badge>
                      <Badge variant="outline" className="text-[10px]">
                        {agent.start}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Warnings */}
            {preview.warnings.length > 0 && (
              <div>
                <span className="font-semibold text-sm">
                  {t("teams.importLegacyWarnings")} ({preview.warnings.length})
                </span>
                <div className="mt-1.5 max-h-32 space-y-1 overflow-y-auto rounded-md border border-amber-500/20 bg-amber-500/5 p-2 text-amber-600 dark:text-amber-400">
                  {preview.warnings.map((w, i) => (
                    <div key={i} className="text-[11px]">
                      <span>• </span>
                      {w.agent && <span>[{w.agent}] </span>}
                      <span>{w.detail}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Unmapped fields */}
            {preview.unmapped.length > 0 && (
              <div>
                <span className="font-semibold text-sm">
                  {t("teams.importLegacyUnmapped")} ({preview.unmapped.length})
                </span>
                <div className="mt-1.5 max-h-28 space-y-1 overflow-y-auto rounded-md border bg-muted/20 p-2 text-muted-foreground font-mono text-[11px]">
                  {preview.unmapped.map((u, i) => (
                    <div key={i}>
                      <span>• </span>
                      {u.agent && <span>{u.agent}.</span>}
                      <span>{u.field}</span>: <span>{JSON.stringify(u.value)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Explicit confirmation checkbox */}
            <div className="pt-2">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                  className="rounded border-input text-primary focus:ring-primary"
                />
                <span className="text-xs text-foreground font-medium">
                  {t("teams.importLegacyConfirmCheck")}
                </span>
              </label>
            </div>
          </div>
        )}

        <DialogFooter className="mt-4 gap-2 sm:gap-0">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={applying}
          >
            {t("teams.cancel")}
          </Button>
          <Button
            size="sm"
            onClick={handleApply}
            disabled={!preview || !isRosterValid || !confirmed || applying || loading}
          >
            {applying ? t("teams.importLegacySaving") : t("teams.importLegacyApply")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
