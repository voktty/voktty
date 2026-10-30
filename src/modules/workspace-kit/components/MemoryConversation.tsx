import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/modules/i18n";
import type { WorkspaceEnv } from "@/modules/workspace/env";
import type { MemoryConversation as Conversation } from "@/modules/workspace-kit/lib/memoryConversation";
import {
  createMemoryConversationPanel,
  type MemoryConversationPanelState,
} from "@/modules/workspace-kit/lib/memoryConversationPanel";
import type { NativeMemoryTrustReview } from "@/modules/workspace-kit/lib/nativeMemoryTrust";

export function MemoryConversation({
  conversation,
  environment,
}: {
  conversation: Conversation;
  environment: WorkspaceEnv;
}) {
  const { t } = useTranslation();
  const status = useSyncExternalStore(
    conversation.subscribe,
    conversation.status,
  );
  const [state, setState] = useState<MemoryConversationPanelState>({
    status: "idle",
  });
  const [accepted, setAccepted] = useState<NativeMemoryTrustReview | null>(
    null,
  );
  const controller = useRef<ReturnType<
    typeof createMemoryConversationPanel
  > | null>(null);
  useLayoutEffect(() => {
    let active = true;
    setState({ status: "idle" });
    try {
      const owner = createMemoryConversationPanel(
        conversation,
        environment,
        (next) => {
          if (active) setState(next);
        },
      );
      controller.current = owner;
      return () => {
        active = false;
        controller.current = null;
        void owner.dispose();
      };
    } catch {
      setState({ status: "error" });
      return () => {
        active = false;
      };
    }
  }, [conversation, environment]);
  const busy =
    status === "binding" ||
    ["reviewing", "binding", "reading"].includes(state.status);
  const review =
    state.status === "review" || state.status === "binding"
      ? state.review
      : null;
  const result = state.status === "prepared" ? state.result : null;
  const retired = status === "retired" || state.status === "closed";
  return (
    <section
      className="space-y-3 rounded-lg border border-border p-3 text-sm"
      aria-busy={busy && !retired}
    >
      <h3 className="font-medium">{t("projectMemory.conversationTitle")}</h3>
      <p className="text-xs text-muted-foreground">
        {t("projectMemory.conversationDescription")}
      </p>
      <p className="break-all font-mono text-xs" dir="auto">
        {conversation.cwd}
      </p>
      {retired ? (
        <p role="status">{t("projectMemory.conversationRetired")}</p>
      ) : (
        <>
          {state.status === "error" ? (
            <p role="alert">{t("projectMemory.conversationError")}</p>
          ) : null}
          {busy ? <p role="status">{t("projectMemory.checking")}</p> : null}
          {review ? (
            <>
              <p className="break-all font-mono text-xs" dir="auto">
                {review.snapshot.root}
              </p>
              <div className="max-h-[40vh] space-y-2 overflow-auto rounded-md border border-border p-2">
                <details className="text-xs">
                  <summary>{t("projectMemory.trustConfiguration")}</summary>
                  <pre className="whitespace-pre-wrap break-words" dir="auto">
                    {JSON.stringify(review.snapshot.config, null, 2)}
                  </pre>
                </details>
                {review.snapshot.instructions.files.map((file) => (
                  <details
                    key={file.path}
                    open={file.path === ".voktty/INIT.md"}
                    className="text-xs"
                  >
                    <summary className="break-all font-mono" dir="auto">
                      {file.path}
                    </summary>
                    <pre
                      className="max-h-48 overflow-auto whitespace-pre-wrap break-words"
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
                  checked={accepted === review}
                  onChange={(event) =>
                    setAccepted(event.target.checked ? review : null)
                  }
                />
                <span>{t("projectMemory.conversationAccept")}</span>
              </label>
              <Button
                size="sm"
                disabled={busy || accepted !== review}
                onClick={() => {
                  if (accepted === review)
                    void controller.current?.confirm(review);
                }}
              >
                {t("projectMemory.conversationPrepare")}
              </Button>
            </>
          ) : null}
          {result ? (
            <div className="space-y-2">
              <p role="status">
                {t(
                  result.packet
                    ? "projectMemory.conversationPrepared"
                    : result.decision.reason === "KIT_MEMORY_POLICY_NEVER"
                      ? "projectMemory.conversationPolicyBlocked"
                      : "projectMemory.conversationTrustBlocked",
                )}
              </p>
              {result.packet ? (
                <>
                  {result.packet.contentState === "initial" ? (
                    <p className="text-xs">
                      {t("projectMemory.conversationInitial")}
                    </p>
                  ) : null}
                  <details>
                    <summary>{t("projectMemory.conversationPreview")}</summary>
                    <pre
                      className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-2 text-xs"
                      dir="auto"
                    >
                      {result.packet.text}
                    </pre>
                  </details>
                </>
              ) : null}
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {status === "inactive" && !review ? (
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => void controller.current?.review()}
              >
                {t("projectMemory.conversationReview")}
              </Button>
            ) : null}
            {status === "ready" ? (
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => void controller.current?.read()}
              >
                {t("projectMemory.conversationRead")}
              </Button>
            ) : null}
            {status === "ready" ? (
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => void controller.current?.disable()}
              >
                {t("projectMemory.conversationDisable")}
              </Button>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}
