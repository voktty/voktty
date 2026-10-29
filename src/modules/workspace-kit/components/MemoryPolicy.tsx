import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/modules/i18n";
import type { MemoryPolicyState } from "@/modules/workspace-kit/lib/memoryPanel";
import type {
  NativeMemoryPolicy,
  NativeMemoryPolicyReview,
} from "@/modules/workspace-kit/lib/nativeMemoryPolicy";

const labels = {
  manual: "projectMemory.policyManual",
  always: "projectMemory.policyAlways",
  never: "projectMemory.policyNever",
} as const;
const descriptions = {
  manual: "projectMemory.policyManualDescription",
  always: "projectMemory.policyAlwaysDescription",
  never: "projectMemory.policyNeverDescription",
} as const;

export function MemoryPolicy({
  state,
  onReview,
  onConfirm,
  onBack,
}: {
  state: MemoryPolicyState;
  onReview: (choice: NativeMemoryPolicy) => void;
  onConfirm: (review: NativeMemoryPolicyReview) => void;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const name = useId();
  const [choice, setChoice] = useState<NativeMemoryPolicy | null>(null);
  const busy =
    state.status === "policyLoading" || state.status === "policyAccepting";
  return (
    <div className="space-y-3 text-sm" aria-busy={busy}>
      <h3 className="font-medium">{t("projectMemory.policyTitle")}</h3>
      <p className="text-xs text-muted-foreground">
        {t("projectMemory.policyDescription")}
      </p>
      <p className="text-xs text-muted-foreground">
        {t("projectMemory.policyDeliveryPending")}
      </p>
      {state.status === "policyConfiguring" ? (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (choice) onReview(choice);
          }}
        >
          <fieldset className="space-y-2">
            <legend className="mb-2 font-medium">
              {t("projectMemory.policyChoice")}
            </legend>
            {(["manual", "always", "never"] as const).map((value) => (
              <label
                key={value}
                className="flex items-start gap-2 rounded-md border border-border p-3"
              >
                <input
                  className="mt-0.5"
                  type="radio"
                  name={name}
                  value={value}
                  checked={choice === value}
                  onChange={() => setChoice(value)}
                />
                <span>
                  <span className="block font-medium">{t(labels[value])}</span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {t(descriptions[value])}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onBack}>
              {t("common.back")}
            </Button>
            <Button type="submit" size="sm" disabled={!choice}>
              {t("projectMemory.policyReview")}
            </Button>
          </div>
        </form>
      ) : (
        <>
          {state.status === "policyLoading" ? (
            <p role="status">{t("projectMemory.checking")}</p>
          ) : null}
          {state.status === "policyError" ? (
            <p role="alert">{t("projectMemory.policyFailed")}</p>
          ) : null}
          {state.status === "policyAccepted" ? (
            <div role="status" className="space-y-2">
              <p>
                {t("projectMemory.policySaved", {
                  policy: t(labels[state.report.preference.policy]),
                })}
              </p>
              <p className="break-all font-mono text-xs" dir="auto">
                {state.root}
              </p>
            </div>
          ) : null}
          {state.status === "policyReview" ||
          state.status === "policyAccepting" ? (
            <>
              <dl className="space-y-3 rounded-md border border-border p-3">
                <div>
                  <dt className="text-xs text-muted-foreground">
                    {t("projectMemory.root")}
                  </dt>
                  <dd className="mt-1 break-all font-mono text-xs" dir="auto">
                    {state.review.snapshot.root}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">
                    {t("projectMemory.policyCurrent")}
                  </dt>
                  <dd>
                    {t(
                      labels[
                        state.review.snapshot.preference?.policy ?? "manual"
                      ],
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">
                    {t("projectMemory.policyRequested")}
                  </dt>
                  <dd className="font-medium">
                    {t(labels[state.review.snapshot.policy])}
                  </dd>
                </div>
              </dl>
              <p className="text-xs">
                {t(descriptions[state.review.snapshot.policy])}
              </p>
              <p className="text-xs text-muted-foreground">
                {t("projectMemory.policySaveEffects")}
              </p>
            </>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={onBack}
            >
              {t("common.back")}
            </Button>
            {state.status === "policyReview" ||
            state.status === "policyAccepting" ? (
              <Button
                type="button"
                size="sm"
                disabled={busy}
                onClick={() => {
                  if (state.status === "policyReview") onConfirm(state.review);
                }}
              >
                {t(
                  state.status === "policyAccepting"
                    ? "projectMemory.policySaving"
                    : "projectMemory.policyConfirm",
                )}
              </Button>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
