import { useCallback, useContext, useLayoutEffect, useRef } from "react";
import { flushSync } from "react-dom";
import { HarnessTerminalOwner } from "@/modules/harness/hooks/harnessTerminalContext";
import type { PersistencePermit } from "@/modules/harness/lib/persistenceAdmission";
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
  const latest = useRef({ ...props, owner });
  const lifetime = useRef<object | null>(null);
  const pending = useRef(
    new Set<{ cancel?: () => void; isCurrent: () => boolean }>(),
  );
  const cancelPending = useCallback(() => {
    for (const request of pending.current) request.cancel?.();
  }, []);
  useLayoutEffect(() => {
    latest.current = { ...props, owner };
    for (const request of pending.current)
      if (!request.isCurrent()) request.cancel?.();
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
      cancelPending();
    };
  }, [owner?.tabKey, props.projectCwd, props.focused, cancelPending]);
  const open = useCallback(
    (options: {
      cwd: string;
      isCurrent?: () => boolean;
      onCreated: (terminal: ProjectTerminalReference) => void;
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
      const operation: { cancel?: () => void; isCurrent: () => boolean } = {
        isCurrent,
      };
      pending.current.add(operation);
      try {
        const request = requestProjectTerminal({
          ownerTabKey: source.tabKey,
          projectCwd: captured.projectCwd,
          cwd: options.cwd,
          isCurrent,
          onCreated: (terminal) => {
            source.onFocus?.();
            flushSync(() => {
              if (!isCurrent()) throw new Error("Terminal view was retired.");
              options.onCreated(terminal);
            });
            if (!isCurrent()) throw new Error("Terminal view was retired.");
          },
        });
        operation.cancel = () => {
          active = false;
          request.cancel();
        };
        if (!isCurrent()) request.cancel();
        void request.result
          .catch((error: unknown) => {
            if (
              isCurrent() &&
              !(error instanceof Error && error.name === "AbortError")
            )
              captured.onError(error);
          })
          .finally(() => pending.current.delete(operation));
        return true;
      } catch (error) {
        pending.current.delete(operation);
        if (isCurrent()) captured.onError(error);
        return false;
      }
    },
    [],
  );
  return { open, cancelPending };
}
