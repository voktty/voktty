import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { native, type GitBranchComparison } from "@/modules/ai/lib/native";
import { t } from "@/modules/i18n";
import { useConflictScope } from "@/modules/source-control/useConflictScope";
import { useWorkspaceEnvStore } from "@/modules/workspace";

type Comparison =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: GitBranchComparison };

function errorMessage(error: unknown): string {
  return error && typeof error === "object" && "message" in error
    ? String(error.message)
    : String(error);
}

export function useBranchComparison({
  open,
  repoRoot,
  currentBranch,
  contextKey,
  onOpenChange,
}: {
  open: boolean;
  repoRoot: string | null;
  currentBranch: string | null;
  contextKey: string;
  onOpenChange: (open: boolean) => void;
}) {
  const workspace = useWorkspaceEnvStore((state) => state.env);
  const scope = useConflictScope(
    JSON.stringify([repoRoot, currentBranch, contextKey]),
    open,
    workspace,
    true,
  );
  type Selection = { base: string; compare: string };
  type View = {
    binding: object;
    onOpenChange: (open: boolean) => void;
    permit: NonNullable<ReturnType<typeof scope.capture>>;
    selection: Selection;
    branches: string[];
    listing: boolean;
    request: { selection: Selection; pending: boolean } | null;
  };
  type Snapshot = {
    view: View;
    selection: Selection;
    branches: string[];
    listError: string | null;
    listing: boolean;
    comparison: Comparison;
  };
  const current = useRef<View | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const owns = useCallback(
    (view: View) =>
      current.current === view &&
      view.binding === scope.binding &&
      view.permit.isCurrent(),
    [scope.binding],
  );
  const loadBranches = useCallback(
    async (view: View) => {
      if (!repoRoot || !owns(view) || view.listing) return;
      const release = view.permit.begin();
      const publish = (
        branches: string[],
        listing: boolean,
        listError: string | null,
      ) => {
        if (!owns(view)) return;
        view.branches = branches;
        setSnapshot((previous) =>
          owns(view) && previous?.view === view
            ? { ...previous, branches, listing, listError }
            : previous,
        );
      };
      if (!release) {
        publish([], false, t("git.waitActionFinish"));
        return;
      }
      view.listing = true;
      publish([], true, null);
      try {
        const result = await native.gitListBranches(
          repoRoot,
          view.permit.workspace(),
        );
        publish(
          result.branches
            .filter((branch) => branch.kind === "local")
            .map((branch) => branch.name),
          false,
          null,
        );
      } catch (error) {
        publish([], false, errorMessage(error));
      } finally {
        view.listing = false;
        release();
      }
    },
    [repoRoot, owns],
  );

  useLayoutEffect(() => {
    const permit = scope.capture();
    if (!permit) return;
    const view: View = {
      binding: scope.binding,
      onOpenChange,
      permit,
      selection: { base: currentBranch ?? "", compare: "" },
      branches: [],
      listing: false,
      request: null,
    };
    current.current = view;
    setSnapshot((previous) =>
      owns(view)
        ? {
            view,
            selection: view.selection,
            branches: [],
            listError: null,
            listing: !!repoRoot,
            comparison: { status: "idle" },
          }
        : previous,
    );
    void loadBranches(view);
    return () => {
      if (current.current === view) current.current = null;
    };
  }, [
    scope.binding,
    scope.capture,
    currentBranch,
    owns,
    loadBranches,
    onOpenChange,
    repoRoot,
  ]);

  const visible = snapshot && owns(snapshot.view) ? snapshot : null;
  const selection = visible?.selection;
  const view = visible?.view;
  const runCompare = useCallback(
    async (view: View, selection: Selection) => {
      if (!repoRoot || !owns(view) || view.selection !== selection) return;
      const { base, compare } = selection;
      if (!base || !compare || base === compare) return;
      if (view.request?.pending && view.request.selection === selection) return;
      const request = { selection, pending: true };
      view.request = request;
      const isCurrent = () =>
        owns(view) && view.selection === selection && view.request === request;
      const publish = (comparison: Comparison) => {
        if (isCurrent())
          setSnapshot((previous) =>
            isCurrent() &&
            previous?.view === view &&
            previous.selection === selection
              ? { ...previous, comparison }
              : previous,
          );
      };
      const release = view.permit.begin();
      if (!release) {
        request.pending = false;
        publish({ status: "error", message: t("git.waitActionFinish") });
        return;
      }
      publish({ status: "loading" });
      try {
        const data = await native.gitCompareBranches(
          repoRoot,
          base,
          compare,
          view.permit.workspace(),
        );
        publish({ status: "ready", data });
      } catch (error) {
        publish({ status: "error", message: errorMessage(error) });
      } finally {
        request.pending = false;
        release();
      }
    },
    [repoRoot, owns],
  );
  useEffect(() => {
    if (view && selection) void runCompare(view, selection);
  }, [view, selection, runCompare]);
  const choose = (field: keyof Selection, value: string) => {
    if (
      !visible ||
      !owns(visible.view) ||
      visible.view.selection !== visible.selection ||
      !visible.view.branches.includes(value)
    )
      return;
    if (visible.selection[field] === value) return;
    const next = { ...visible.selection, [field]: value };
    visible.view.selection = next;
    setSnapshot((previous) =>
      owns(visible.view) &&
      visible.view.selection === next &&
      previous?.view === visible.view
        ? { ...previous, selection: next, comparison: { status: "idle" } }
        : previous,
    );
  };
  const state: Comparison = visible?.comparison ?? { status: "idle" };
  return {
    branches: visible?.branches ?? [],
    base: selection?.base ?? "",
    compare: selection?.compare ?? "",
    state,
    listing: visible?.listing ?? (open && !!repoRoot),
    listError: visible?.listError ?? null,
    setBase: (value: string) => choose("base", value),
    setCompare: (value: string) => choose("compare", value),
    retryBranches: () => {
      if (visible) void loadBranches(visible.view);
    },
    retryComparison: () => {
      if (view && selection) void runCompare(view, selection);
    },
    setOpen: (next: boolean) => {
      if (!view || !owns(view)) return;
      if (!next) view.permit.retire();
      view.onOpenChange(next);
    },
  };
}
