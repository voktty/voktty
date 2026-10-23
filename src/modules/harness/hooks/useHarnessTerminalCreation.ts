import { useCallback, useContext, useLayoutEffect, useRef } from "react";
import { flushSync } from "react-dom";
import { HarnessTerminalOwner } from "@/modules/harness/hooks/harnessTerminalContext";
import type { PersistencePermit } from "@/modules/harness/lib/persistenceAdmission";
import { useCanonicalTerminalCatalog } from "@/modules/terminal/CanonicalTerminalCatalog";
import { t } from "@/modules/i18n";
import {
  requestProjectTerminal,
  type ProjectTerminalReference,
} from "@/modules/terminal/lib/projectTerminalRequest";

export function useHarnessTerminalCreation(props: {
  projectCwd: string;
  focused: boolean;
  capture: () => PersistencePermit | undefined;
  projectAvailable: (project: string) => boolean;
  onError: (error: unknown) => void;
}) {
  const owner = useContext(HarnessTerminalOwner);
  const catalog = useCanonicalTerminalCatalog();
  const latest = useRef({ ...props, owner, catalog });
  const lifetime = useRef<object | null>(null);
  const pending = useRef(
    new Set<{
      cancel?: () => void;
      isCurrent: () => boolean;
      confirmed: boolean;
    }>(),
  );
  const cancelPending = useCallback((includeConfirmed = true) => {
    for (const request of pending.current)
      if (includeConfirmed || !request.confirmed) request.cancel?.();
  }, []);
  useLayoutEffect(() => {
    latest.current = { ...props, owner, catalog };
    for (const request of pending.current)
      if (!request.confirmed && !request.isCurrent()) request.cancel?.();
  });
  useLayoutEffect(() => {
    const current = {
      tabKey: owner?.tabKey,
      projectCwd: props.projectCwd,
      focused: props.focused,
    };
    lifetime.current = current;
    return () => {
      if (lifetime.current === current) lifetime.current = null;
      cancelPending(false);
    };
  }, [owner?.tabKey, props.projectCwd, props.focused, cancelPending]);
  useLayoutEffect(() => {
    if (!owner?.tabKey || !owner.visible || !props.projectCwd) cancelPending();
    return () => cancelPending();
  }, [owner?.tabKey, owner?.visible, props.projectCwd, cancelPending]);
  const open = useCallback(
    (options: {
      cwd: string;
      title?: string;
      cold?: boolean;
      slotKey: string;
      isCurrent?: () => boolean;
      onCreated: (terminal: ProjectTerminalReference) => void;
      onConfirmed?: (terminal: ProjectTerminalReference) => boolean | undefined;
      onFailed?: (error: unknown) => void;
      onSettled?: () => void;
    }) => {
      options = { ...options };
      let active = true;
      const captured = latest.current;
      const original = lifetime.current;
      const permit = captured.capture();
      const source = captured.owner ? { ...captured.owner } : null;
      const isCurrent = () =>
        Boolean(
          active &&
            original &&
            lifetime.current === original &&
            captured.focused &&
            source?.visible &&
            permit?.isCurrent() &&
            captured.projectAvailable(captured.projectCwd) &&
            (options.isCurrent?.() ?? true),
        );
      if (!source || !isCurrent()) return false;
      const reservation = options.cold
        ? undefined
        : captured.catalog?.reserve({
            ownerTabKey: source.tabKey,
            projectCwd: captured.projectCwd,
            slotKey: options.slotKey,
          });
      if (!options.cold && !reservation) {
        captured.onError(new Error(t("spaces.rendererCapacity")));
        return false;
      }
      const admitted = () =>
        isCurrent() &&
        (options.cold === true || reservation?.isCurrent() === true);
      const operation: {
        cancel?: () => void;
        isCurrent: () => boolean;
        confirmed: boolean;
      } = {
        isCurrent: admitted,
        confirmed: false,
      };
      pending.current.add(operation);
      try {
        const request = requestProjectTerminal({
          ownerTabKey: source.tabKey,
          projectCwd: captured.projectCwd,
          cwd: options.cwd,
          title: options.title,
          cold: options.cold,
          isCurrent: admitted,
          onCreated: (terminal) => {
            if (!options.cold && !reservation?.bind(terminal.tabKey))
              throw new Error(t("spaces.rendererCapacity"));
            if (!options.cold) source.onFocus?.();
            flushSync(() => {
              if (!admitted()) throw new Error("Terminal view was retired.");
              options.onCreated(terminal);
            });
            if (!admitted()) throw new Error("Terminal view was retired.");
            operation.confirmed = true;
          },
        });
        operation.cancel = () => {
          active = false;
          reservation?.retire();
          request.cancel();
        };
        if (!admitted()) operation.cancel();
        void request.result
          .then((terminal) => {
            if (options.onConfirmed?.(terminal) === false)
              reservation?.retire();
          })
          .catch((error: unknown) => {
            options.onFailed?.(error);
            if (
              isCurrent() &&
              !(error instanceof Error && error.name === "AbortError")
            )
              captured.onError(error);
          })
          .finally(async () => {
            reservation?.release();
            await reservation?.done;
            pending.current.delete(operation);
            options.onSettled?.();
          });
        return true;
      } catch (error) {
        pending.current.delete(operation);
        reservation?.release();
        options.onSettled?.();
        if (isCurrent()) captured.onError(error);
        return false;
      }
    },
    [],
  );
  return { open, cancelPending };
}
