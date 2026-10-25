import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { t } from "@/modules/i18n";
import { useWorkspaceEnvStore, type WorkspaceEnv } from "@/modules/workspace";
import { toast } from "sonner";

type Operation = (root: string, workspace: WorkspaceEnv) => Promise<void>;
function errorMessage(error: unknown): string {
  return error && typeof error === "object" && "message" in error
    ? String(error.message)
    : String(error);
}

export function useGitCollectionMenu<T extends object>({
  repoRoot,
  contextKey = "",
  load,
  keyOf,
  onRefresh,
}: {
  repoRoot: string | null;
  contextKey?: string;
  load: (root: string, workspace: WorkspaceEnv) => Promise<T[]>;
  keyOf: (item: T) => string;
  onRefresh: () => void;
}) {
  const workspace = useWorkspaceEnvStore((state) => state.env);
  const filesystem = JSON.stringify(workspace);
  const [epoch, setEpoch] = useState(0);
  const epochRef = useRef(0);
  const binding = useMemo(
    () => ({ repoRoot, contextKey, filesystem, epoch, load, keyOf }),
    [repoRoot, contextKey, filesystem, epoch, load, keyOf],
  );
  type Owner = { binding: typeof binding; live: boolean; pending: boolean };
  type Scope = {
    owner: Owner;
    key: string;
    kind: "menu" | "dialog";
    live: boolean;
    pending: boolean;
    latest: object | null;
  };
  type Result = {
    scope: Scope;
    items: T[];
    loading: boolean;
    error: string | null;
  };
  const current = useRef<Owner | null>(null);
  const currentScope = useRef<Scope | null>(null);
  const [scope, setScope] = useState<Scope | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const publication = useRef<Result | null>(null);
  const unsettled = useRef(new Set<object>());
  const [busy, setBusy] = useState<{ scope: Scope; key: string } | null>(null);
  const [dialogError, setDialogError] = useState<{
    scope: Scope;
    message: string | null;
  } | null>(null);

  useLayoutEffect(() => {
    let previous = JSON.stringify(useWorkspaceEnvStore.getState().env);
    return useWorkspaceEnvStore.subscribe((state) => {
      const next = JSON.stringify(state.env);
      if (next !== previous) {
        epochRef.current++;
        setEpoch(epochRef.current);
      }
      previous = next;
    });
  }, []);
  useLayoutEffect(() => {
    const owner: Owner = { binding, live: true, pending: false };
    current.current = owner;
    return () => {
      owner.live = false;
      if (currentScope.current?.owner === owner) {
        currentScope.current.live = false;
        currentScope.current = null;
      }
    };
  }, [binding]);
  const ownsOwner = useCallback(
    (owner: Owner) =>
      owner.live &&
      current.current === owner &&
      owner.binding === binding &&
      binding.epoch === epochRef.current &&
      binding.filesystem ===
        JSON.stringify(useWorkspaceEnvStore.getState().env),
    [binding],
  );
  const owns = useCallback(
    (capture: Scope) =>
      capture.live &&
      currentScope.current === capture &&
      ownsOwner(capture.owner),
    [ownsOwner],
  );
  const close = useCallback(
    (capture: Scope) => {
      if (!owns(capture)) return;
      capture.live = false;
      currentScope.current = null;
      setScope((previous) => (previous === capture ? null : previous));
    },
    [owns],
  );
  const setMenuOpen = useCallback(
    (open: boolean) => {
      const owner = current.current;
      if (
        !owner?.live ||
        owner.binding !== binding ||
        binding.epoch !== epochRef.current ||
        binding.filesystem !==
          JSON.stringify(useWorkspaceEnvStore.getState().env)
      )
        return;
      if (!open) {
        if (currentScope.current?.kind === "menu") close(currentScope.current);
        return;
      }
      if (!repoRoot || currentScope.current?.live) return;
      const next: Scope = {
        owner,
        key: crypto.randomUUID(),
        kind: "menu",
        live: true,
        pending: false,
        latest: null,
      };
      currentScope.current = next;
      setScope(next);
    },
    [binding, close, repoRoot],
  );
  const openDialog = useCallback(() => {
    if (scope?.kind !== "menu" || !owns(scope) || scope.pending) return;
    scope.live = false;
    const next: Scope = {
      owner: scope.owner,
      key: crypto.randomUUID(),
      kind: "dialog",
      live: true,
      pending: false,
      latest: null,
    };
    currentScope.current = next;
    setScope(next);
  }, [scope, owns]);
  const setDialogOpen = useCallback(
    (open: boolean) => {
      if (!open && scope?.kind === "dialog") close(scope);
    },
    [scope, close],
  );

  const read = useCallback(
    async (capture: Scope) => {
      if (!repoRoot || !owns(capture) || capture.kind !== "menu") return;
      const receipt = {};
      capture.latest = receipt;
      const isCurrent = () => owns(capture) && capture.latest === receipt;
      const publish = (items: T[], loading: boolean, error: string | null) => {
        if (!isCurrent()) return;
        const next = { scope: capture, items, loading, error };
        publication.current = next;
        setResult((previous) => (isCurrent() ? next : previous));
      };
      if (unsettled.current.size >= 256) {
        publish([], false, t("git.waitActionFinish"));
        return;
      }
      unsettled.current.add(receipt);
      publish([], true, null);
      try {
        const items = await load(repoRoot, JSON.parse(binding.filesystem));
        if (isCurrent())
          publish(
            items.map((item) => ({ ...item })),
            false,
            null,
          );
      } catch (error) {
        publish([], false, errorMessage(error));
      } finally {
        unsettled.current.delete(receipt);
      }
    },
    [repoRoot, owns, load, binding],
  );
  useEffect(() => {
    if (scope?.kind === "menu") void read(scope);
  }, [scope, read]);

  const reloadOwnerMenu = useCallback(
    async (owner: Owner) => {
      const target = currentScope.current;
      if (target?.owner === owner && target.kind === "menu" && owns(target))
        await read(target);
    },
    [owns, read],
  );

  const runEntry = useCallback(
    async (
      key: string,
      operation: Operation,
      success: string,
      refresh = true,
    ) => {
      if (
        scope?.kind !== "menu" ||
        !repoRoot ||
        !owns(scope) ||
        scope.owner.pending ||
        unsettled.current.size >= 256 ||
        result?.scope !== scope ||
        publication.current !== result ||
        !result.items.some((item) => keyOf(item) === key)
      )
        return;
      const capture = scope;
      const receipt = {};
      capture.pending = true;
      capture.owner.pending = true;
      unsettled.current.add(receipt);
      setBusy({ scope: capture, key });
      if (refresh) publication.current = null;
      try {
        await operation(repoRoot, JSON.parse(binding.filesystem));
        if (owns(capture)) toast.success(success);
        if (ownsOwner(capture.owner) && refresh) onRefresh();
        if (refresh) await reloadOwnerMenu(capture.owner);
      } catch (error) {
        if (owns(capture)) toast.error(errorMessage(error));
        if (refresh) await reloadOwnerMenu(capture.owner);
      } finally {
        capture.pending = false;
        capture.owner.pending = false;
        unsettled.current.delete(receipt);
        if (ownsOwner(capture.owner))
          setBusy((previous) =>
            ownsOwner(capture.owner) && previous?.scope === capture
              ? null
              : previous,
          );
      }
    },
    [
      scope,
      repoRoot,
      owns,
      result,
      keyOf,
      binding,
      onRefresh,
      reloadOwnerMenu,
      ownsOwner,
    ],
  );
  const submitDialog = useCallback(
    async (operation: Operation, success: string, inlineError = false) => {
      if (
        scope?.kind !== "dialog" ||
        !repoRoot ||
        !owns(scope) ||
        scope.owner.pending
      )
        return;
      if (unsettled.current.size >= 256) {
        if (inlineError)
          setDialogError((previous) =>
            owns(scope)
              ? { scope, message: t("git.waitActionFinish") }
              : previous,
          );
        else toast.error(t("git.waitActionFinish"));
        return;
      }
      const capture = scope;
      const receipt = {};
      capture.pending = true;
      capture.owner.pending = true;
      unsettled.current.add(receipt);
      setBusy({ scope: capture, key: "dialog" });
      setDialogError((previous) =>
        owns(capture) ? { scope: capture, message: null } : previous,
      );
      try {
        await operation(repoRoot, JSON.parse(binding.filesystem));
        if (!owns(capture)) return;
        toast.success(success);
        if (!owns(capture)) return;
        close(capture);
        if (ownsOwner(capture.owner) && currentScope.current === null)
          onRefresh();
      } catch (error) {
        if (!owns(capture)) return;
        if (inlineError)
          setDialogError((previous) =>
            owns(capture)
              ? { scope: capture, message: errorMessage(error) }
              : previous,
          );
        else toast.error(errorMessage(error));
      } finally {
        await reloadOwnerMenu(capture.owner);
        capture.pending = false;
        capture.owner.pending = false;
        unsettled.current.delete(receipt);
        if (ownsOwner(capture.owner))
          setBusy((previous) =>
            ownsOwner(capture.owner) && previous?.scope === capture
              ? null
              : previous,
          );
      }
    },
    [
      scope,
      repoRoot,
      owns,
      binding,
      onRefresh,
      close,
      ownsOwner,
      reloadOwnerMenu,
    ],
  );
  const visibleScope =
    scope?.live && scope.owner.binding === binding ? scope : null;
  const visible = result?.scope === visibleScope ? result : null;
  return {
    menuOpen: visibleScope?.kind === "menu",
    setMenuOpen,
    openDialog,
    setDialogOpen,
    dialogKey: visibleScope?.kind === "dialog" ? visibleScope.key : null,
    items: visible?.items ?? [],
    loading: visibleScope?.kind === "menu" && (visible?.loading ?? true),
    error: visible?.error ?? null,
    busyKey: busy?.scope === visibleScope ? busy.key : null,
    actionPending: !!visibleScope?.owner.pending,
    dialogError:
      dialogError?.scope === visibleScope ? dialogError.message : null,
    runEntry,
    submitDialog,
  };
}

export type GitCollectionMenu<T extends object> = ReturnType<
  typeof useGitCollectionMenu<T>
>;
