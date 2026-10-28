import { useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { useTranslation } from "@/modules/i18n";
import {
  createMemoryPanelController,
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
