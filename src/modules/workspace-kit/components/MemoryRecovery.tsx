import { Button } from "@/components/ui/button";
import { useTranslation } from "@/modules/i18n";
import type { MemoryRecoveryState } from "@/modules/workspace-kit/lib/memoryPanel";
import type { NativeMemoryRecoveryReview } from "@/modules/workspace-kit/lib/nativeMemoryRecovery";
import { useState } from "react";

export default function MemoryRecovery({
  state,
  onConfirm,
  onBack,
  onReview,
  onContinue,
  onInspect,
}: {
  state: MemoryRecoveryState;
  onConfirm: (review: NativeMemoryRecoveryReview) => void;
  onBack: () => void;
  onReview: () => void;
  onContinue: () => void;
  onInspect: () => void;
}) {
  const { t } = useTranslation();
  const [accepted, setAccepted] = useState<NativeMemoryRecoveryReview | null>(
    null,
  );
  const busy =
    state.status === "recoveryLoading" || state.status === "recoveryRestoring";
  const review =
    state.status === "recoveryReview" || state.status === "recoveryRestoring"
      ? state.review
      : null;
  return (
    <div className="space-y-3 text-sm" aria-busy={busy}>
      <h3 className="font-medium">{t("projectMemory.recovery.title")}</h3>
      <p className="text-xs text-muted-foreground">
        {t("projectMemory.recovery.effects")}
      </p>
      {state.status === "recoveryLoading" ? (
        <p role="status">{t("projectMemory.checking")}</p>
      ) : null}
      {state.status === "recoveryInspection" ? (
        <p className="text-xs text-muted-foreground">
          {t("projectMemory.inspectDescription")}
        </p>
      ) : null}
      {review ? (
        <>
          <p className="break-all font-mono text-xs" dir="auto">
            {review.snapshot.root}
          </p>
          <div className="max-h-[40vh] space-y-3 overflow-y-auto rounded-md border border-border p-2">
            {review.snapshot.entries.map((entry) => (
              <section key={entry.target} className="space-y-2 text-xs">
                <dl className="space-y-1">
                  <dt>{t("projectMemory.recovery.target")}</dt>
                  <dd className="break-all font-mono" dir="auto">
                    {entry.target}
                  </dd>
                  <dt>{t("projectMemory.recovery.backup")}</dt>
                  <dd className="break-all font-mono" dir="auto">
                    {entry.backup}
                  </dd>
                </dl>
                <pre
                  className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-2"
                  dir="auto"
                >
                  {entry.text}
                </pre>
              </section>
            ))}
          </div>
          <label className="flex items-start gap-2 text-xs">
            <input
              type="checkbox"
              disabled={busy}
              checked={accepted === review}
              onChange={(event) =>
                setAccepted(event.target.checked ? review : null)
              }
            />
            <span>{t("projectMemory.recovery.accept")}</span>
          </label>
        </>
      ) : null}
      {state.status === "recoveryError" ? (
        <div role="alert" className="space-y-2">
          <p>{t("projectMemory.recovery.failed")}</p>
          <p className="text-xs text-muted-foreground">
            {t("projectMemory.partialWarning")}
          </p>
          <code>{state.error.code}</code>
          {state.error.changes ? (
            <ul className="max-h-48 overflow-y-auto break-all font-mono text-xs">
              {[
                ...new Set(
                  Object.values(state.error.changes).flatMap((paths) =>
                    Array.isArray(paths)
                      ? paths.filter(
                          (path): path is string => typeof path === "string",
                        )
                      : [],
                  ),
                ),
              ].map((path) => (
                <li key={path}>{path}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {state.status === "recoveryRestored" ? (
        <div role="status" className="space-y-2">
          <p>{t("projectMemory.recovery.restored")}</p>
          <p className="break-all font-mono text-xs" dir="auto">
            {state.root}
          </p>
          <ul className="max-h-48 overflow-y-auto break-all font-mono text-xs">
            {state.report.created.map((path) => (
              <li key={path}>{path}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="flex justify-end gap-2">
        {state.status === "recoveryInspection" ? (
          <Button size="sm" onClick={onInspect}>
            {t("projectMemory.inspectAncestors")}
          </Button>
        ) : null}
        {state.status !== "recoveryRestored" ? (
          <Button variant="outline" size="sm" disabled={busy} onClick={onBack}>
            {t("common.back")}
          </Button>
        ) : null}
        {state.status === "recoveryError" ? (
          <Button size="sm" onClick={onReview}>
            {t("projectMemory.recovery.review")}
          </Button>
        ) : null}
        {review ? (
          <Button
            size="sm"
            disabled={busy || accepted !== review}
            onClick={() => {
              if (!busy && accepted === review) onConfirm(review);
            }}
          >
            {t(
              state.status === "recoveryRestoring"
                ? "projectMemory.recovery.restoring"
                : "projectMemory.recovery.confirm",
            )}
          </Button>
        ) : null}
        {state.status === "recoveryRestored" ? (
          <Button size="sm" onClick={onContinue}>
            {t("projectMemory.recovery.continue")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
