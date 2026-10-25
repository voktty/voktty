import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  native,
  type GitChangedFile,
  type GitOperationKind,
} from "@/modules/ai/lib/native";
import { t } from "@/modules/i18n";
import { useWorkspaceEnvStore } from "@/modules/workspace";
import {
  useConflictScope,
  type ConflictAdmission,
} from "@/modules/source-control/useConflictScope";
import { toast } from "sonner";

export function useConflictsPanel(
  repoRoot: string | null,
  files: GitChangedFile[],
  onRefresh: () => void,
) {
  const workspace = useWorkspaceEnvStore((state) => state.env);
  const scope = useConflictScope(repoRoot ?? "", !!repoRoot, workspace, true);
  type Permit = NonNullable<ReturnType<typeof scope.capture>>;
  type Fact = { binding: object; kind: GitOperationKind; error: string | null };
  type Dialog = {
    binding: object;
    key: string;
    path: string;
    workspace: typeof workspace;
    active: boolean;
    isCurrent: () => boolean;
    admit: ConflictAdmission;
    close: (open: boolean) => void;
    resolved: () => void;
  };
  const [fact, setFact] = useState<Fact | null>(null);
  const factRef = useRef<Fact | null>(null);
  const flightRef = useRef<{
    binding: object;
    queued: boolean;
    promise: Promise<void>;
    isCurrent: () => boolean;
  } | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const dialogRef = useRef<Dialog | null>(null);
  const paths = useRef<string[]>([]);
  const filesKey = JSON.stringify(files.map((file) => file.path));
  useLayoutEffect(() => {
    paths.current = JSON.parse(filesKey);
  }, [filesKey]);

  const loadOperation = useCallback((): Promise<void> => {
    const permit = scope.capture();
    if (!permit || !repoRoot) return Promise.resolve();
    const old = flightRef.current;
    if (old?.binding === scope.binding && old.isCurrent()) {
      old.queued = true;
      return old.promise;
    }
    let done!: () => void;
    const flight = {
      binding: scope.binding,
      queued: false,
      promise: new Promise<void>((resolve) => {
        done = resolve;
      }),
      isCurrent: permit.isCurrent,
    };
    flightRef.current = flight;
    const publish = (kind: GitOperationKind, error: string | null) => {
      if (!permit.isCurrent() || flight.queued) return;
      const next = { binding: scope.binding, kind, error };
      factRef.current = next;
      setFact((previous) =>
        permit.isCurrent() && !flight.queued ? next : previous,
      );
    };
    void (async () => {
      try {
        do {
          flight.queued = false;
          factRef.current = null;
          publish("none", null);
          const release = permit.begin();
          if (!release) {
            publish("none", t("git.waitActionFinish"));
            break;
          }
          try {
            const result = await native.gitOperationStatus(
              repoRoot,
              permit.workspace(),
            );
            publish(result.kind, null);
          } catch (error) {
            publish("none", String(error));
          } finally {
            release();
          }
        } while (permit.isCurrent() && flight.queued);
      } finally {
        if (flightRef.current === flight) flightRef.current = null;
        done();
      }
    })();
    return flight.promise;
  }, [scope.binding, scope.capture, repoRoot]);
  useEffect(() => {
    void filesKey;
    void loadOperation();
  }, [loadOperation, filesKey]);
  useEffect(() => {
    const read = () => {
      void loadOperation();
    };
    window.addEventListener("voktty:git-refresh", read);
    return () => window.removeEventListener("voktty:git-refresh", read);
  }, [loadOperation]);
  const operation = fact?.binding === scope.binding ? fact.kind : "none";
  const run = useCallback(
    async (action: "abort" | "continue") => {
      const permit = scope.capture();
      if (
        !permit ||
        !repoRoot ||
        operation === "none" ||
        factRef.current !== fact
      )
        return;
      if (action === "continue" && paths.current.length) {
        toast.error(t("git.conflicts.continueBlocked"));
        return;
      }
      const release = permit.begin(action);
      if (!release) return;
      try {
        if (action === "abort")
          await native.gitOperationAbort(
            repoRoot,
            operation,
            permit.workspace(),
          );
        else
          await native.gitOperationContinue(
            repoRoot,
            operation,
            permit.workspace(),
          );
        if (!permit.isCurrent()) return;
        toast.success(
          t(
            action === "abort"
              ? "git.conflicts.abortSuccess"
              : "git.conflicts.continueSuccess",
          ),
        );
        if (!permit.isCurrent()) return;
        await loadOperation();
        if (permit.isCurrent()) onRefresh();
      } catch (error) {
        if (permit.isCurrent()) toast.error(String(error));
      } finally {
        release();
      }
    },
    [scope.capture, repoRoot, operation, fact, loadOperation, onRefresh],
  );
  const openFile = useCallback(
    (path: string) => {
      const permit = scope.capture();
      if (!permit || !paths.current.includes(path)) return;
      if (dialogRef.current) dialogRef.current.active = false;
      const target: Dialog = {
        binding: scope.binding,
        key: crypto.randomUUID(),
        path,
        workspace: permit.workspace(),
        active: true,
        isCurrent: () =>
          target.active &&
          dialogRef.current === target &&
          permit.isCurrent() &&
          paths.current.includes(path),
        admit: (mutation) =>
          target.isCurrent() ? permit.begin(mutation) : null,
        close: (open) => {
          if (!open && target.isCurrent()) retire(target, permit, false);
        },
        resolved: () => {
          if (target.isCurrent()) retire(target, permit, true);
        },
      };
      function retire(target: Dialog, permit: Permit, refresh: boolean) {
        target.active = false;
        dialogRef.current = null;
        setDialog((previous) => (previous === target ? null : previous));
        if (refresh && permit.isCurrent()) {
          void loadOperation();
          onRefresh();
        }
      }
      dialogRef.current = target;
      setDialog(target);
    },
    [scope.binding, scope.capture, loadOperation, onRefresh],
  );
  return {
    operation,
    error: fact?.binding === scope.binding ? fact.error : null,
    busy: scope.busy,
    loadOperation,
    run,
    openFile,
    dialog:
      dialog?.binding === scope.binding &&
      dialog.isCurrent() &&
      files.some((file) => file.path === dialog.path)
        ? dialog
        : null,
  };
}
