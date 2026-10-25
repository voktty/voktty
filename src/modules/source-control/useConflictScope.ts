import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useWorkspaceEnvStore, type WorkspaceEnv } from "@/modules/workspace";

export type ConflictAdmission = (mutation?: string) => (() => void) | null;

export function useConflictScope(
  key: string,
  open: boolean,
  workspace: WorkspaceEnv,
  observeGlobal = false,
) {
  const filesystem = JSON.stringify(workspace);
  const [epoch, setEpoch] = useState(0);
  const epochRef = useRef(0);
  const binding = useMemo(
    () => ({ key, open, filesystem, epoch }),
    [key, open, filesystem, epoch],
  );
  type Owner = {
    binding: typeof binding;
    active: boolean;
    mutation: object | null;
  };
  const current = useRef<Owner | null>(null);
  const unsettled = useRef(new Set<object>());
  const [pending, setPending] = useState<{ owner: Owner; kind: string } | null>(
    null,
  );
  useLayoutEffect(() => {
    if (!observeGlobal) return;
    let previous = JSON.stringify(useWorkspaceEnvStore.getState().env);
    return useWorkspaceEnvStore.subscribe((state) => {
      const next = JSON.stringify(state.env);
      if (next !== previous) {
        epochRef.current++;
        setEpoch(epochRef.current);
      }
      previous = next;
    });
  }, [observeGlobal]);
  useLayoutEffect(() => {
    const owner: Owner = { binding, active: true, mutation: null };
    current.current = owner;
    return () => {
      owner.active = false;
    };
  }, [binding]);
  const capture = useCallback(() => {
    const owner = current.current;
    const isCurrent = () =>
      !!owner?.active &&
      current.current === owner &&
      owner.binding === binding &&
      binding.open &&
      binding.epoch === epochRef.current &&
      (!observeGlobal ||
        binding.filesystem ===
          JSON.stringify(useWorkspaceEnvStore.getState().env));
    if (!owner || !isCurrent()) return null;
    const begin: ConflictAdmission = (mutation) => {
      if (
        !isCurrent() ||
        unsettled.current.size >= 256 ||
        (mutation && owner.mutation)
      )
        return null;
      const receipt = {};
      unsettled.current.add(receipt);
      if (mutation) {
        owner.mutation = receipt;
        setPending({ owner, kind: mutation });
      }
      return () => {
        if (!unsettled.current.delete(receipt)) return;
        if (owner.mutation === receipt) {
          owner.mutation = null;
          if (isCurrent())
            setPending((previous) =>
              isCurrent() && previous?.owner === owner ? null : previous,
            );
        }
      };
    };
    return {
      isCurrent,
      begin,
      workspace: (): WorkspaceEnv => JSON.parse(binding.filesystem),
      retire: () => {
        owner.active = false;
      },
    };
  }, [binding, observeGlobal]);
  return {
    binding,
    capture,
    busy:
      pending?.owner.binding === binding && pending.owner.active
        ? pending.kind
        : null,
  };
}
