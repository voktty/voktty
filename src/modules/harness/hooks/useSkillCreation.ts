import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { createBlankSkill } from "@/modules/harness/lib/skills";
import { PromptSourceRetiredError } from "@/modules/harness/lib/promptSource";

type Props = {
  cwd: string;
  open: boolean;
  context?: object;
  capture?: () => () => boolean;
  onCreated: (path: string, isCurrent: () => boolean) => void;
};
type Owner = { binding: object; pending: boolean };

export function useSkillCreation(props: Props) {
  const [epoch, setEpoch] = useState(0);
  const binding = useMemo(
    () => ({ cwd: props.cwd, open: props.open, context: props.context, epoch }),
    [props.cwd, props.open, props.context, epoch],
  );
  const active = useRef<Owner | null>(null);
  const latest = useRef(props);
  const [state, setState] = useState<{
    owner: Owner | null;
    busy: boolean;
    error: string | null;
  }>({ owner: null, busy: false, error: null });
  useLayoutEffect(() => {
    latest.current = props;
  });
  useLayoutEffect(() => {
    const owner = { binding, pending: false };
    active.current = owner;
    return () => {
      if (active.current === owner) active.current = null;
    };
  }, [binding]);

  const cancel = useCallback(() => {
    if (active.current?.binding !== binding) return;
    active.current = null;
    setEpoch((value) => value + 1);
  }, [binding]);
  const create = useCallback(
    (name: string, scope: "project" | "user") => {
      const owner = active.current;
      if (!binding.open || owner?.binding !== binding || owner.pending) return;
      const original = latest.current;
      const callerCurrent = original.capture?.() ?? (() => true);
      const isCurrent = () => active.current === owner && callerCurrent();
      if (!isCurrent()) return;
      owner.pending = true;
      setState({ owner, busy: true, error: null });
      void createBlankSkill(
        { cwd: binding.cwd, name, scope },
        () => {
          if (!isCurrent())
            throw new DOMException("Skill creation was retired.", "AbortError");
        },
        (path) => {
          if (isCurrent()) flushSync(() => original.onCreated(path, isCurrent));
        },
      )
        .catch((error: unknown) => {
          if (
            !isCurrent() ||
            error instanceof PromptSourceRetiredError ||
            (error instanceof DOMException && error.name === "AbortError")
          )
            return;
          setState((previous) =>
            previous.owner === owner && isCurrent()
              ? {
                  owner,
                  busy: true,
                  error: error instanceof Error ? error.message : String(error),
                }
              : previous,
          );
        })
        .finally(() => {
          owner.pending = false;
          if (isCurrent())
            setState((previous) =>
              previous.owner === owner && isCurrent()
                ? { ...previous, busy: false }
                : previous,
            );
        });
    },
    [binding],
  );
  const visible =
    state.owner?.binding === binding && active.current === state.owner;
  return {
    create,
    cancel,
    busy: visible && state.busy,
    error: visible ? state.error : null,
  };
}
