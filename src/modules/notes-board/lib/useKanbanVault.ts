import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { t } from "@/modules/i18n";
import {
  exportCardsToProjectVault,
  importCardsFromProjectVault,
} from "./kanbanFsSync";
import type { KanbanCard } from "./kanbanTypes";
import { useKanbanStore } from "@/modules/notes-board/store/kanbanStore";
import { vaultAvailable, type VaultTarget } from "./vaultFilesystem";

export function useKanbanVault(
  target: VaultTarget | null | undefined,
  sourceKey?: string,
) {
  const path = target?.path;
  const workspaceKey = JSON.stringify(target?.workspace);
  const binding = useMemo(
    () => ({ path, workspaceKey, sourceKey }),
    [path, workspaceKey, sourceKey],
  );
  const owner = useRef<{ binding: typeof binding; current: boolean } | null>(
    null,
  );
  const pending = useRef(false);
  const [syncing, setSyncing] = useState(false);
  useLayoutEffect(() => {
    const receipt = { binding, current: true };
    owner.current = receipt;
    return () => {
      receipt.current = false;
      if (owner.current === receipt) owner.current = null;
    };
  }, [binding]);
  const available = vaultAvailable(target);
  const run = useCallback(
    async (action: "import" | "export", cards: KanbanCard[] = []) => {
      const receipt = owner.current;
      if (
        !available ||
        !path ||
        !workspaceKey ||
        pending.current ||
        !receipt?.current ||
        receipt.binding !== binding
      )
        return;
      pending.current = true;
      setSyncing(true);
      const current = () => receipt.current && owner.current === receipt;
      try {
        const options = {
          workspace: JSON.parse(workspaceKey) as VaultTarget["workspace"],
          current,
        };
        if (action === "export") {
          const result = await exportCardsToProjectVault(path, cards, options);
          if (current())
            toast.success(
              t("notesBoard.exportedToast", { count: result.count }),
            );
        } else {
          const imported = await importCardsFromProjectVault(path, options);
          if (!current()) return;
          if (imported.length) {
            useKanbanStore.getState().mergeCards(imported);
            if (current())
              toast.success(
                t("notesBoard.importedToast", { count: imported.length }),
              );
          } else toast.info(t("notesBoard.importEmpty"));
        }
      } catch {
        if (current())
          toast.error(
            t(
              action === "export"
                ? "notesBoard.exportError"
                : "notesBoard.importError",
            ),
          );
      } finally {
        pending.current = false;
        if (owner.current?.current) setSyncing(false);
      }
    },
    [available, path, workspaceKey, binding],
  );
  return { run, syncing, available };
}
