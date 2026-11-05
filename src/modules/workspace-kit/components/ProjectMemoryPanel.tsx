import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { useTranslation } from "@/modules/i18n";
import { MemoryConversation } from "@/modules/workspace-kit/components/MemoryConversation";
import { MemoryDocuments } from "@/modules/workspace-kit/components/MemoryDocuments";
import { MemoryInitialization } from "@/modules/workspace-kit/components/MemoryInitialization";
import type { MemoryConversation as Conversation } from "@/modules/workspace-kit/lib/memoryConversation";
import {
  canInitializeMemory,
  canRepairMemory,
  canReviewMemoryRecovery,
  canBrowseMemoryDocuments,
  createMemoryPanelController,
  type MemoryPanelState,
  type MemoryPanelTarget,
  supportedMemoryPanelTarget,
  supportsMemoryRecovery,
} from "@/modules/workspace-kit/lib/memoryPanel";
import {
  lazy,
  Suspense,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

const MemoryRecovery = lazy(
  () => import("@/modules/workspace-kit/components/MemoryRecovery"),
);

export default function ProjectMemoryPanel({
  target,
  conversation = null,
  conversationError = false,
}: {
  target: MemoryPanelTarget | null;
  conversation?: Conversation | null;
  conversationError?: boolean;
}) {
  const { t } = useTranslation();
  const [revision, setRevision] = useState(0);
  const [manageConversation, setManageConversation] = useState(false);
  const conversationTarget = useMemo(
    () =>
      target && conversation
        ? {
            ...target,
            path: conversation.cwd,
            environment: conversation.environment ?? target.environment,
          }
        : null,
    [target, conversation],
  );
  const canManageConversation =
    conversationTarget !== null &&
    supportedMemoryPanelTarget(conversationTarget);
  const managementTarget = useMemo(
    () =>
      manageConversation && conversationTarget ? conversationTarget : target,
    [manageConversation, target, conversationTarget],
  );
  return (
    <>
      {conversation && conversationTarget && canManageConversation ? (
        <MemoryConversation
          conversation={conversation}
          environment={conversationTarget.environment}
        />
      ) : null}
      {conversationError ? (
        <p role="alert">{t("projectMemory.conversationError")}</p>
      ) : null}
      {conversation &&
      target &&
      canManageConversation &&
      (conversation.cwd !== target.path ||
        JSON.stringify(conversation.environment ?? target.environment) !==
          JSON.stringify(target.environment)) ? (
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            if (manageConversation || conversation.isCurrent())
              setManageConversation((value) => !value);
          }}
        >
          {t(
            manageConversation
              ? "projectMemory.manageBrowsedDirectory"
              : "projectMemory.manageConversationDirectory",
          )}
        </Button>
      ) : null}
      {managementTarget ? (
        <>
          <dl className="grid min-w-0 gap-3 rounded-lg border border-border p-3 text-xs">
            <div>
              <dt className="text-muted-foreground">
                {t("projectMemory.directory")}
              </dt>
              <dd className="mt-1 break-all font-mono" dir="auto">
                {managementTarget.path}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">
                {t("projectMemory.environment")}
              </dt>
              <dd className="mt-1">
                {managementTarget.path.startsWith("remote://")
                  ? t("projectMemory.remote")
                  : managementTarget.environment.kind === "local"
                    ? t("projectMemory.local")
                    : managementTarget.environment.kind.toUpperCase()}
              </dd>
            </div>
          </dl>
          {supportedMemoryPanelTarget(managementTarget) ? (
            <MemoryObservation
              key={`${revision}:${managementTarget.path}`}
              target={managementTarget}
              onReload={() => setRevision((value) => value + 1)}
            />
          ) : (
            <p role="status" className="text-sm text-muted-foreground">
              {t("projectMemory.unsupported")}
            </p>
          )}
        </>
      ) : (
        <p role="status" className="text-sm text-muted-foreground">
          {t("projectMemory.noTarget")}
        </p>
      )}
    </>
  );
}

function MemoryObservation({
  target,
  onReload,
}: {
  target: MemoryPanelTarget;
  onReload: () => void;
}) {
  const { t, language } = useTranslation();
  const [state, setState] = useState<MemoryPanelState>({ status: "loading" });
  const controller = useRef<ReturnType<
    typeof createMemoryPanelController
  > | null>(null);
  useLayoutEffect(() => {
    let active = true;
    try {
      const owner = createMemoryPanelController(target, (next) => {
        if (active) setState((previous) => (active ? next : previous));
      });
      controller.current = owner;
      void owner.load();
      return () => {
        active = false;
        controller.current = null;
        void owner.dispose();
      };
    } catch {
      setState({ status: "error", code: "busy" });
      return () => {
        active = false;
      };
    }
  }, [target]);
  if (
    state.status === "recoveryLoading" ||
    state.status === "recoveryInspection" ||
    state.status === "recoveryReview" ||
    state.status === "recoveryRestoring" ||
    state.status === "recoveryRestored" ||
    state.status === "recoveryError"
  )
    return (
      <Suspense fallback={<p role="status">{t("projectMemory.checking")}</p>}>
        <MemoryRecovery
          state={state}
          onConfirm={(review) => {
            void controller.current?.confirmRecovery(review);
          }}
          onBack={() => {
            void controller.current?.backRecovery();
          }}
          onReview={() => {
            void controller.current?.reviewRecovery();
          }}
          onContinue={() => {
            void controller.current?.resumeInitialization();
          }}
          onInspect={() => {
            void controller.current?.inspectAncestors();
          }}
        />
      </Suspense>
    );
  if (
    state.status === "documentsLoading" ||
    state.status === "documentsReady" ||
    state.status === "documentsError"
  )
    return (
      <MemoryDocuments
        state={state}
        onBack={() => controller.current?.backDocuments()}
        onRefresh={() => {
          void controller.current?.browseDocuments();
        }}
      />
    );
  if (
    state.status !== "loading" &&
    state.status !== "ready" &&
    state.status !== "error"
  )
    return (
      <>
        <MemoryInitialization
          state={state}
          directory={target.path}
          onPreview={(values, links) => {
            void controller.current?.preview(values, links);
          }}
          onConfirm={(review) => {
            void controller.current?.confirm(review);
          }}
          onBack={() => {
            void controller.current?.back();
          }}
        />
        <DialogFooter>
          {supportsMemoryRecovery(target) &&
          ((state.status === "deploymentError" &&
            ["recoveryRequired", "pendingRecovery"].includes(
              state.error.code,
            )) ||
            (state.status === "review" &&
              state.review.snapshot.publicationBlocker ===
                "recoveryRequired")) ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                void controller.current?.reviewRecovery();
              }}
            >
              {t("projectMemory.recovery.review")}
            </Button>
          ) : null}
          {state.status === "published" ? (
            <Button
              size="sm"
              onClick={() => {
                void controller.current?.load();
              }}
            >
              {t("projectMemory.next")}
            </Button>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            disabled={
              state.status === "previewing" || state.status === "publishing"
            }
            onClick={onReload}
          >
            {t("common.refresh")}
          </Button>
        </DialogFooter>
      </>
    );
  const message =
    state.status === "loading"
      ? "projectMemory.checking"
      : state.status === "error"
        ? state.code === "unsupported"
          ? "projectMemory.unsupported"
          : "projectMemory.error"
        : state.observation.scope.state === "ready"
          ? "projectMemory.found"
          : state.observation.scope.state === "absent" ||
              state.observation.scope.state === "reserved"
            ? "projectMemory.absent"
            : state.observation.scope.state === "incomplete"
              ? "projectMemory.incomplete"
              : "projectMemory.review";
  return (
    <>
      <div
        aria-live="polite"
        aria-busy={state.status === "loading"}
        className="space-y-3 text-sm"
      >
        <p role={state.status === "error" ? "alert" : "status"}>{t(message)}</p>
        {state.status === "error" ? (
          <p className="text-xs text-muted-foreground">
            {t("common.error")}: <code>{state.code}</code>
          </p>
        ) : null}
        {state.status === "error" &&
        state.code === "denied" &&
        target.environment.kind === "local" &&
        !target.path.startsWith("remote://") ? (
          <Button
            size="sm"
            onClick={() => void controller.current?.authorize()}
          >
            {t("git.authorizeDirectory")}
          </Button>
        ) : null}
        {state.status === "ready" && state.observation.root ? (
          <div>
            <p className="text-xs text-muted-foreground">
              {t("projectMemory.root")}
            </p>
            <p className="mt-1 break-all font-mono text-xs" dir="auto">
              {state.observation.root}
            </p>
          </div>
        ) : null}
        {state.status === "ready" &&
        state.observation.scope.state === "incomplete" &&
        !state.observation.scope.ancestryComplete ? (
          <div className="space-y-3 rounded-lg border border-border p-3">
            <p className="text-xs text-muted-foreground">
              {t("projectMemory.inspectDescription")}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void controller.current?.inspectAncestors();
              }}
            >
              {t("projectMemory.inspectAncestors")}
            </Button>
          </div>
        ) : null}
        {state.status === "ready" &&
        (canInitializeMemory(state.observation) ||
          canRepairMemory(state.observation)) ? (
          <Button
            size="sm"
            onClick={() => void controller.current?.configure(language)}
          >
            {t("projectMemory.initialize")}
          </Button>
        ) : null}
        {state.status === "ready" &&
        canReviewMemoryRecovery(target, state.observation) ? (
          <>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                void controller.current?.reviewRecovery();
              }}
            >
              {t("projectMemory.recovery.review")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                controller.current?.configureInterruptedInitialization();
              }}
            >
              {t("projectMemory.recovery.reviewInitialization")}
            </Button>
          </>
        ) : null}
        {state.status === "ready" &&
        canBrowseMemoryDocuments(state.observation) ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              void controller.current?.browseDocuments();
            }}
          >
            {t("common.browse")}
          </Button>
        ) : null}
      </div>
      <DialogFooter>
        <Button
          variant="outline"
          size="sm"
          disabled={state.status === "loading"}
          onClick={() => {
            if (state.status === "ready") void controller.current?.load();
            else onReload();
          }}
        >
          {t("common.refresh")}
        </Button>
      </DialogFooter>
    </>
  );
}
