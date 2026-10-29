import { useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { useTranslation } from "@/modules/i18n";
import { MemoryInitialization } from "@/modules/workspace-kit/components/MemoryInitialization";
import { MemoryTrust } from "@/modules/workspace-kit/components/MemoryTrust";
import {
  createMemoryPanelController,
  canInitializeMemory,
  canReviewMemoryTrust,
  supportedMemoryPanelTarget,
  type MemoryPanelState,
  type MemoryPanelTarget,
} from "@/modules/workspace-kit/lib/memoryPanel";

export default function ProjectMemoryPanel({
  target,
}: {
  target: MemoryPanelTarget | null;
}) {
  const { t } = useTranslation();
  const [revision, setRevision] = useState(0);
  return (
    <>
      {target ? (
        <>
          <dl className="grid min-w-0 gap-3 rounded-lg border border-border p-3 text-xs">
            <div>
              <dt className="text-muted-foreground">
                {t("projectMemory.directory")}
              </dt>
              <dd className="mt-1 break-all font-mono" dir="auto">
                {target.path}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">
                {t("projectMemory.environment")}
              </dt>
              <dd className="mt-1">
                {target.path.startsWith("remote://")
                  ? t("projectMemory.remote")
                  : target.environment.kind === "local"
                    ? t("projectMemory.local")
                    : target.environment.kind.toUpperCase()}
              </dd>
            </div>
          </dl>
          {supportedMemoryPanelTarget(target) ? (
            <MemoryObservation
              key={revision}
              target={target}
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
  const { t } = useTranslation();
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
      setState({ status: "error", code: "busy", canPrepare: false });
      return () => {
        active = false;
      };
    }
  }, [target]);
  if (
    state.status === "trustLoading" ||
    state.status === "trustReview" ||
    state.status === "trustAccepting" ||
    state.status === "trustAccepted" ||
    state.status === "trustError"
  )
    return (
      <>
        <MemoryTrust
          state={state}
          onConfirm={(review) => {
            void controller.current?.confirmTrust(review);
          }}
          onBack={() => {
            void controller.current?.backTrust();
          }}
        />
        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            disabled={
              state.status === "trustLoading" ||
              state.status === "trustAccepting"
            }
            onClick={onReload}
          >
            {t("common.refresh")}
          </Button>
        </DialogFooter>
      </>
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
        ? "projectMemory.error"
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
        {state.status === "error" && state.canPrepare ? (
          <div className="space-y-3 rounded-lg border border-border p-3">
            <p className="text-xs text-muted-foreground">
              {t("projectMemory.prepareDescription")}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void controller.current?.prepare()}
            >
              {t("projectMemory.prepare")}
            </Button>
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
        {state.status === "ready" && canInitializeMemory(state.observation) ? (
          <Button size="sm" onClick={() => controller.current?.configure()}>
            {t("projectMemory.initialize")}
          </Button>
        ) : null}
        {state.status === "ready" && canReviewMemoryTrust(state.observation) ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              void controller.current?.reviewTrust();
            }}
          >
            {t("projectMemory.reviewTrust")}
          </Button>
        ) : null}
      </div>
      <DialogFooter>
        <Button
          variant="outline"
          size="sm"
          disabled={state.status === "loading"}
          onClick={onReload}
        >
          {t("common.refresh")}
        </Button>
      </DialogFooter>
    </>
  );
}
