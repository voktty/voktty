import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { native } from "@/modules/ai/lib/native";
import type { WorkspaceEnv } from "@/modules/workspace";
import { canInitializeExplorerRepository } from "@/modules/explorer/lib/useExplorerRepositoryInitialization";

export function useExplorerRepository({
  scope,
  rootPath,
  workspace,
}: {
  scope: object;
  rootPath: string | null;
  workspace: WorkspaceEnv;
}) {
  const filesystem = JSON.stringify(workspace);
  const supported = canInitializeExplorerRepository(rootPath, workspace);
  const binding = useMemo(
    () => ({ scope, rootPath, filesystem, supported }),
    [scope, rootPath, filesystem, supported],
  );
  const [result, setResult] = useState<{
    binding: typeof binding;
    hasRepo: boolean | undefined;
    status: "loading" | "ready" | "error";
  } | null>(null);
  const unsettled = useRef(new Set<object>());
  const current = useRef<{
    binding: typeof binding;
    active: boolean;
    blocked: boolean;
    read: () => void;
  } | null>(null);

  useLayoutEffect(() => {
    if (!rootPath || !supported) return;
    const path = rootPath;
    const captured: WorkspaceEnv = JSON.parse(filesystem);
    const owner = {
      binding,
      active: true,
      blocked: false,
      pending: false,
      queued: false,
      read,
    };
    current.current = owner;
    let latestRequest: object | null = null;
    function read() {
      if (!owner.active) return;
      if (owner.pending) {
        owner.queued = true;
        return;
      }
      if (unsettled.current.size >= 256) {
        owner.blocked = true;
        return;
      }
      owner.blocked = false;
      owner.pending = true;
      owner.queued = false;
      const receipt = {};
      latestRequest = receipt;
      const owns = () =>
        owner.active && latestRequest === receipt && !owner.queued;
      unsettled.current.add(receipt);
      setResult((previous) =>
        owns() ? { binding, hasRepo: undefined, status: "loading" } : previous,
      );
      void (async () => {
        try {
          const repo = await native.gitResolveRepo(path, captured);
          if (owns())
            setResult((previous) =>
              owns()
                ? { binding, hasRepo: repo !== null, status: "ready" }
                : previous,
            );
        } catch {
          if (owns())
            setResult((previous) =>
              owns()
                ? { binding, hasRepo: undefined, status: "error" }
                : previous,
            );
        } finally {
          unsettled.current.delete(receipt);
          owner.pending = false;
          if (owner.active && owner.queued) owner.read();
          const live = current.current;
          if (live?.active && live.blocked) live.read();
        }
      })();
    }
    window.addEventListener("voktty:git-refresh", read);
    read();
    return () => {
      owner.active = false;
      if (current.current === owner) current.current = null;
      window.removeEventListener("voktty:git-refresh", read);
    };
  }, [binding, rootPath, filesystem, supported]);
  const refresh = useCallback(() => {
    if (current.current?.binding === binding) current.current.read();
  }, [binding]);
  return {
    hasRepo: result?.binding === binding ? result.hasRepo : undefined,
    status: !supported
      ? "unsupported"
      : result?.binding === binding
        ? result.status
        : "loading",
    refresh,
  };
}
