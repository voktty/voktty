import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/modules/i18n";
import type { MemoryTrustState } from "@/modules/workspace-kit/lib/memoryPanel";
import type { NativeMemoryTrustReview } from "@/modules/workspace-kit/lib/nativeMemoryTrust";

export function MemoryTrust({
  state,
  onConfirm,
  onBack,
}: {
  state: MemoryTrustState;
  onConfirm: (review: NativeMemoryTrustReview) => void;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const [accepted, setAccepted] = useState<NativeMemoryTrustReview | null>(
    null,
  );
  const busy =
    state.status === "trustLoading" || state.status === "trustAccepting";
  return (
    <div className="space-y-3 text-sm" aria-busy={busy}>
      <h3 className="font-medium">{t("projectMemory.trustTitle")}</h3>
      <p className="text-xs text-muted-foreground">
        {t("projectMemory.trustDescription")}
      </p>
      {state.status === "trustLoading" ? (
        <p role="status">{t("projectMemory.checking")}</p>
      ) : null}
      {state.status === "trustError" ? (
        <p role="alert">{t("projectMemory.trustFailed")}</p>
      ) : null}
      {state.status === "trustAccepted" ? (
        <div role="status">
          <p>{t("projectMemory.trustSaved")}</p>
          <p className="mt-2 break-all font-mono text-xs" dir="auto">
            {state.root}
          </p>
        </div>
      ) : null}
      {state.status === "trustReview" || state.status === "trustAccepting" ? (
        <>
          <p className="break-all font-mono text-xs" dir="auto">
            {state.review.snapshot.root}
          </p>
          {state.review.snapshot.preference?.instructionDigest ? (
            <p className="text-xs">
              {t(
                state.review.snapshot.preference.instructionDigest ===
                  state.review.snapshot.fingerprint.digest
                  ? "projectMemory.trustUnchanged"
                  : "projectMemory.trustChanged",
              )}
            </p>
          ) : null}
          <div className="max-h-[40vh] space-y-2 overflow-y-auto rounded-md border border-border p-2">
            <details className="text-xs">
              <summary className="cursor-pointer">
                {t("projectMemory.trustConfiguration")}
              </summary>
              <pre
                className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-2"
                dir="auto"
              >
                {JSON.stringify(state.review.snapshot.config, null, 2)}
              </pre>
            </details>
            {state.review.snapshot.instructions.files.map((file) => (
              <details
                key={file.path}
                open={file.path === ".voktty/INIT.md"}
                className="text-xs"
              >
                <summary
                  className="cursor-pointer break-all font-mono"
                  dir="auto"
                >
                  {file.path}
                </summary>
                <pre
                  className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-2"
                  dir="auto"
                >
                  {file.fact.kind === "file"
                    ? file.fact.text
                    : t("projectMemory.missingFile")}
                </pre>
              </details>
            ))}
          </div>
          <label className="flex items-start gap-2 text-xs">
            <input
              type="checkbox"
              disabled={busy}
              checked={accepted === state.review}
              onChange={(event) =>
                setAccepted(event.target.checked ? state.review : null)
              }
            />
            <span>{t("projectMemory.trustAccept")}</span>
          </label>
        </>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" disabled={busy} onClick={onBack}>
          {t("common.back")}
        </Button>
        {state.status === "trustReview" || state.status === "trustAccepting" ? (
          <Button
            size="sm"
            disabled={busy || accepted !== state.review}
            onClick={() => {
              if (accepted === state.review) onConfirm(state.review);
            }}
          >
            {t(
              state.status === "trustAccepting"
                ? "projectMemory.trustSaving"
                : "projectMemory.trustConfirm",
            )}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
