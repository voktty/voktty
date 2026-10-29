import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useTranslation } from "@/modules/i18n";
import type {
  MemoryPanelState,
  MemoryTrustState,
  MemoryPolicyState,
} from "@/modules/workspace-kit/lib/memoryPanel";
import type { NativeMemoryReview } from "@/modules/workspace-kit/lib/nativeMemory";

type InitializationState = Exclude<
  MemoryPanelState,
  | { status: "loading" | "ready" | "error" }
  | MemoryTrustState
  | MemoryPolicyState
>;
export function MemoryInitialization({
  state,
  directory,
  onPreview,
  onConfirm,
  onBack,
}: {
  state: InitializationState;
  directory: string;
  onPreview: (
    values: Record<string, string>,
    links: { agents: boolean; claude: boolean },
  ) => void;
  onConfirm: (review: NativeMemoryReview) => void;
  onBack: () => void;
}) {
  const { t, language } = useTranslation();
  const id = useId();
  const [step, setStep] = useState<"values" | "sharing">("values");
  const [values, setValues] = useState<Record<string, string>>(() => ({
    project_name:
      directory
        .replace(/[\\/]+$/, "")
        .split(/[\\/]/)
        .slice(-1)[0] || "",
    project_summary: "",
    owner_title: "",
    primary_branch: "main",
    verify_commands: "",
    language: language ?? "en",
    default_runtime: "claude-code",
    default_model: "",
    created_at: new Date().toISOString().slice(0, 10),
  }));
  const [links, setLinks] = useState({ agents: false, claude: false });
  const [accepted, setAccepted] = useState<NativeMemoryReview | null>(null);
  if (state.status === "configuring")
    return (
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (step === "values") setStep("sharing");
          else
            onPreview(
              Object.fromEntries(
                Object.entries(values).filter(
                  ([key, value]) => value.length > 0 || key === "default_model",
                ),
              ),
              links,
            );
        }}
      >
        <h3 className="text-sm font-medium" aria-live="polite">
          {t(
            step === "values"
              ? "projectMemory.valuesTitle"
              : "projectMemory.sharingTitle",
          )}
        </h3>
        {step === "values" ? (
          <div className="max-h-[45vh] space-y-3 overflow-y-auto pr-1">
            {(
              [
                "project_name",
                "project_summary",
                "owner_title",
                "language",
                "primary_branch",
                "verify_commands",
                "default_runtime",
                "default_model",
              ] as const
            ).map((field) => (
              <label
                className="block space-y-1 text-xs"
                key={field}
                htmlFor={`${id}-${field}`}
              >
                <span>{t(`projectMemory.fields.${field}`)}</span>
                {field === "project_summary" || field === "verify_commands" ? (
                  <Textarea
                    id={`${id}-${field}`}
                    value={values[field]}
                    maxLength={8000}
                    rows={3}
                    onChange={(event) =>
                      setValues({ ...values, [field]: event.target.value })
                    }
                  />
                ) : (
                  <Input
                    id={`${id}-${field}`}
                    required={
                      field === "project_name" ||
                      field === "language" ||
                      field === "default_runtime"
                    }
                    value={values[field]}
                    maxLength={field === "project_name" ? 200 : 256}
                    onChange={(event) =>
                      setValues({ ...values, [field]: event.target.value })
                    }
                  />
                )}
              </label>
            ))}
            <p className="text-xs text-muted-foreground">
              {t("projectMemory.valuesDescription")}
            </p>
          </div>
        ) : (
          <div className="space-y-3 text-xs">
            <p className="font-medium">{t("projectMemory.gitMode")}</p>
            <p className="text-muted-foreground">
              {t("projectMemory.publicWarning")}
            </p>
            <p className="text-muted-foreground">
              {t("projectMemory.installDescription")}
            </p>
            {(["agents", "claude"] as const).map((link) => (
              <label key={link} className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={links[link]}
                  onChange={(event) =>
                    setLinks({ ...links, [link]: event.target.checked })
                  }
                />
                <span>
                  {t(
                    link === "agents"
                      ? "projectMemory.agentsLink"
                      : "projectMemory.claudeLink",
                  )}
                </span>
              </label>
            ))}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => (step === "sharing" ? setStep("values") : onBack())}
          >
            {t("common.back")}
          </Button>
          <Button type="submit" size="sm">
            {t(
              step === "values"
                ? "projectMemory.next"
                : "projectMemory.preview",
            )}
          </Button>
        </div>
      </form>
    );
  if (state.status === "previewing")
    return (
      <p role="status" aria-busy="true" className="text-sm">
        {t("projectMemory.previewing")}
      </p>
    );
  if (state.status === "published")
    return (
      <div role="status" className="space-y-3 text-sm">
        <p>{t("projectMemory.installed")}</p>
        <p className="break-all font-mono text-xs" dir="auto">
          {state.root}
        </p>
        <p className="text-xs text-muted-foreground">
          {t("projectMemory.installDescription")}
        </p>
        <ul className="max-h-48 overflow-y-auto break-all font-mono text-xs">
          {[
            ...new Set([
              ...state.report.created,
              ...state.report.migrated,
              ...state.report.cleaned,
            ]),
          ].map((path) => (
            <li key={path}>{path}</li>
          ))}
        </ul>
      </div>
    );
  if (state.status === "deploymentError")
    return (
      <div role="alert" className="space-y-3 text-sm">
        <p>{t("projectMemory.deploymentFailed")}</p>
        <p className="text-xs text-muted-foreground">
          {t("projectMemory.partialWarning")}
        </p>
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
        <Button variant="outline" size="sm" onClick={onBack}>
          {t("common.back")}
        </Button>
      </div>
    );
  const review = state.review;
  const snapshot = review.snapshot;
  const publishing = state.status === "publishing";
  const canPublish =
    snapshot.deployment.canPublish && !snapshot.publicationBlocker;
  return (
    <div className="space-y-3 text-sm" aria-busy={publishing}>
      <h3 className="font-medium">{t("projectMemory.reviewTitle")}</h3>
      <p className="break-all font-mono text-xs" dir="auto">
        {snapshot.root}
      </p>
      <p className="text-xs text-muted-foreground">
        {t("projectMemory.installDescription")}
      </p>
      {!canPublish ? (
        <p role="alert" className="text-xs text-destructive">
          {t("projectMemory.conflicts")}
        </p>
      ) : null}
      {snapshot.isResuming ? (
        <p className="text-xs">{t("projectMemory.resuming")}</p>
      ) : null}
      <div className="max-h-[40vh] space-y-2 overflow-y-auto rounded-md border border-border p-2">
        {snapshot.deployment.entries.map((entry) => (
          <details key={entry.path} className="text-xs">
            <summary className="cursor-pointer break-all">
              <span className="mr-2 font-medium">
                {t(`projectMemory.actions.${entry.action}`)}
              </span>
              <span className="font-mono" dir="auto">
                {entry.path}
              </span>
            </summary>
            <p className="mt-2 font-medium">{t("projectMemory.before")}</p>
            <pre
              className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-2"
              dir="auto"
            >
              {entry.expected ??
                t(
                  entry.reason === "missing"
                    ? "projectMemory.missingFile"
                    : "projectMemory.currentUnavailable",
                )}
            </pre>
            <p className="mt-2 font-medium">{t("projectMemory.after")}</p>
            <pre
              className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-2"
              dir="auto"
            >
              {entry.proposed}
            </pre>
          </details>
        ))}
        {snapshot.recoveryFiles.map((file) => (
          <details key={file.path} className="text-xs">
            <summary className="cursor-pointer break-all font-mono">
              {file.path}
            </summary>
            <pre
              className="max-h-48 overflow-auto whitespace-pre-wrap break-words"
              dir="auto"
            >
              {file.text}
            </pre>
          </details>
        ))}
      </div>
      <label className="flex items-start gap-2 text-xs">
        <input
          type="checkbox"
          disabled={publishing || !canPublish}
          checked={accepted === review}
          onChange={(event) =>
            setAccepted(event.target.checked ? review : null)
          }
        />
        <span>{t("projectMemory.acceptDeployment")}</span>
      </label>
      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={publishing}
          onClick={onBack}
        >
          {t("common.back")}
        </Button>
        <Button
          size="sm"
          disabled={publishing || !canPublish || accepted !== review}
          onClick={() => onConfirm(review)}
        >
          {t(
            publishing
              ? "projectMemory.publishing"
              : "projectMemory.initialize",
          )}
        </Button>
      </div>
    </div>
  );
}
