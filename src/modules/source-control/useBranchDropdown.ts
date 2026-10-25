import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { native, type GitBranchEntry } from "@/modules/ai/lib/native";
import { t } from "@/modules/i18n";
import { useWorkspaceEnvStore } from "@/modules/workspace";
import { toast } from "sonner";

export function useBranchDropdown({
  repoRoot,
  contextKey,
  onRefresh,
}: {
  repoRoot: string | null;
  contextKey: string;
  onRefresh: () => void;
}) {
  const workspace = useWorkspaceEnvStore((state) => state.env);
  const filesystem = JSON.stringify(workspace);
  const [epoch, setEpoch] = useState(0);
  const epochRef = useRef(0);
  const binding = useMemo(
    () => ({ repoRoot, contextKey, filesystem, epoch }),
    [repoRoot, contextKey, filesystem, epoch],
  );
  type Owner = { binding: typeof binding; live: boolean; pending: boolean };
  type Menu = { owner: Owner; live: boolean };
  const current = useRef<Owner | null>(null);
  const currentMenu = useRef<Menu | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const unsettled = useRef(new Set<object>());
  const [busy, setBusy] = useState<Owner | null>(null);
  const [result, setResult] = useState<{
    menu: Menu;
    branches: GitBranchEntry[];
    loading: boolean;
    error: string | null;
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
      if (currentMenu.current?.owner === owner) {
        currentMenu.current.live = false;
        currentMenu.current = null;
      }
    };
  }, [binding]);
  const owns = useCallback(
    (owner: Owner) =>
      owner.live &&
      current.current === owner &&
      owner.binding === binding &&
      binding.epoch === epochRef.current &&
      binding.filesystem ===
        JSON.stringify(useWorkspaceEnvStore.getState().env),
    [binding],
  );
  const ownsMenu = useCallback(
    (capture: Menu) =>
      owns(capture.owner) && capture.live && currentMenu.current === capture,
    [owns],
  );
  const setOpen = useCallback(
    (open: boolean) => {
      const owner = current.current;
      if (!owner || !owns(owner)) return;
      if (open) {
        if (owner.pending || currentMenu.current?.live) return;
        const next: Menu = { owner, live: true };
        currentMenu.current = next;
        setMenu(next);
      } else {
        const old = currentMenu.current;
        if (old) old.live = false;
        currentMenu.current = null;
        setMenu(null);
      }
    },
    [owns],
  );

  useEffect(() => {
    if (!menu || !repoRoot || !ownsMenu(menu)) return;
    const capture = menu;
    let active = true;
    const isCurrent = () => active && ownsMenu(capture);
    const publish = (
      branches: GitBranchEntry[],
      loading: boolean,
      error: string | null,
    ) => {
      if (isCurrent())
        setResult((previous) =>
          isCurrent() ? { menu: capture, branches, loading, error } : previous,
        );
    };
    if (unsettled.current.size >= 256) {
      publish([], false, t("git.waitActionFinish"));
      return;
    }
    const receipt = {};
    unsettled.current.add(receipt);
    publish([], true, null);
    void (async () => {
      try {
        const response = await native.gitListBranches(
          repoRoot,
          JSON.parse(binding.filesystem),
        );
        publish(
          response.branches.map((branch) => ({ ...branch })),
          false,
          null,
        );
      } catch (error) {
        publish([], false, String(error));
      } finally {
        unsettled.current.delete(receipt);
      }
    })();
    return () => {
      active = false;
    };
  }, [menu, repoRoot, binding, ownsMenu]);

  const checkout = useCallback(
    async (branch: string) => {
      if (
        !menu ||
        !repoRoot ||
        !ownsMenu(menu) ||
        menu.owner.pending ||
        unsettled.current.size >= 256 ||
        result?.menu !== menu ||
        !result.branches.some(
          (entry) => entry.kind === "local" && entry.name === branch,
        )
      )
        return;
      const owner = menu.owner;
      const receipt = {};
      owner.pending = true;
      unsettled.current.add(receipt);
      setBusy(owner);
      try {
        await native.gitCheckoutBranch(
          repoRoot,
          branch,
          JSON.parse(binding.filesystem),
        );
        if (!owns(owner)) return;
        setOpen(false);
        if (owns(owner)) onRefresh();
      } catch (error) {
        if (owns(owner))
          toast.error(t("common.unknownError"), { description: String(error) });
      } finally {
        owner.pending = false;
        unsettled.current.delete(receipt);
        if (owns(owner))
          setBusy((previous) =>
            owns(owner) && previous === owner ? null : previous,
          );
      }
    },
    [menu, repoRoot, ownsMenu, result, binding, owns, setOpen, onRefresh],
  );
  const runMenuAction = useCallback(
    (action: () => void) => {
      if (!menu || !ownsMenu(menu) || menu.owner.pending) return;
      setOpen(false);
      if (owns(menu.owner)) action();
    },
    [menu, ownsMenu, setOpen, owns],
  );
  const open = !!menu && menu.owner.binding === binding && menu.live;
  const visible = open && result?.menu === menu ? result : null;
  return {
    open,
    setOpen,
    checkout,
    runMenuAction,
    branches: visible?.branches ?? [],
    loading: open && !!repoRoot && (visible?.loading ?? true),
    error: visible?.error ?? null,
    checkingOut: busy?.binding === binding && busy.live,
  };
}
