import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "@/modules/i18n";
import { useProjectBranchesState } from "../hooks/useProjectBranches";
import { LAYER } from "../lib/layers";
import { createWorktree, type Worktree } from "../lib/worktrees";
import { prettyCwd } from "../lib/paths";
import { Modal } from "./Modal";
import { SearchableSelect } from "./SearchableSelect";
import { Loader } from "./icons";

export function CreateWorktreeDialog({
  cwd,
  baseCwd,
  defaultRoot,
  onCreated,
  onCancel,
}: {
  cwd: string;
  baseCwd: string;
  defaultRoot?: string;
  onCreated: (tree: Worktree) => void | Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const { branches } = useProjectBranchesState(baseCwd, true);
  const [name, setName] = useState("");
  const [base, setBase] = useState("HEAD");
  const [existing, setExisting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (existing) return;
    const frame = requestAnimationFrame(() => input.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [existing]);

  const localBranches = useMemo(
    () =>
      (branches?.branches ?? [])
        .filter((branch) => !branch.remote)
        .map((branch) => ({ value: branch.name, label: branch.name })),
    [branches],
  );

  const baseOptions = useMemo(
    () => [
      {
        value: "HEAD",
        label: branches?.current
          ? t("harness.worktrees.currentCommit", { sha: branches.current })
          : t("harness.worktrees.currentCommitFallback"),
        keywords: "HEAD current commit",
      },
      ...(branches?.branches ?? []).map((branch) => {
        const ref = branch.remote
          ? `${branch.remote}/${branch.name}`
          : branch.name;
        return { value: ref, label: ref };
      }),
    ],
    [branches, t],
  );

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !name.trim()) return;
    setBusy(true);
    setError(undefined);
    try {
      const tree = await createWorktree(baseCwd, name.trim(), base, existing);
      await onCreated(tree);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const field =
    "h-9 rounded-md border border-content/10 bg-background-base px-2.5 text-[13px] outline-none focus:border-content/25 disabled:opacity-50";

  return (
    <Modal
      title={t("harness.worktrees.createTitle")}
      size="sm"
      onClose={() => {
        if (!busy) onCancel();
      }}
    >
      <form
        className="flex flex-col gap-4 p-4"
        onSubmit={(e) => void submit(e)}
      >
        <p className="text-[12px] text-content/55">
          {t("harness.worktrees.createDescription", { cwd: prettyCwd(cwd) })}
        </p>
        <div className="flex flex-col gap-1.5 text-[12px] text-content/70">
          <span>{t("harness.worktrees.branch")}</span>
          <SearchableSelect
            label={t("harness.worktrees.branchType")}
            disabled={busy}
            value={existing ? "existing" : "new"}
            options={[
              { value: "new", label: t("harness.worktrees.branchNew") },
              { value: "existing", label: t("harness.worktrees.branchExisting") },
            ]}
            onChange={(value) => {
              setExisting(value === "existing");
              setName("");
            }}
            searchPlaceholder={t("harness.worktrees.searchOptions")}
            layer={LAYER.dialogPopover}
          />
        </div>
        <div className="flex flex-col gap-1.5 text-[12px] text-content/70">
          <span>{existing ? t("harness.worktrees.existingBranch") : t("harness.worktrees.newBranchName")}</span>
          {existing ? (
            <SearchableSelect
              label={t("harness.worktrees.existingBranch")}
              value={name}
              disabled={busy}
              options={localBranches}
              onChange={setName}
              placeholder={t("harness.worktrees.chooseBranch")}
              searchPlaceholder={t("harness.worktrees.searchBranches")}
              emptyLabel={t("harness.worktrees.noMatchingBranches")}
              layer={LAYER.dialogPopover}
            />
          ) : (
            <input
              ref={input}
              aria-label={t("harness.worktrees.newBranchName")}
              className={field}
              value={name}
              disabled={busy}
              placeholder={t("harness.worktrees.branchPlaceholder")}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setName(e.target.value)}
            />
          )}
        </div>
        {!existing && (
          <div className="flex flex-col gap-1.5 text-[12px] text-content/70">
            <span>{t("harness.worktrees.startFrom")}</span>
            <SearchableSelect
              label={t("harness.worktrees.startFrom")}
              value={base}
              disabled={busy}
              options={baseOptions}
              onChange={setBase}
              searchPlaceholder={t("harness.worktrees.searchRefs")}
              layer={LAYER.dialogPopover}
            />
          </div>
        )}
        {defaultRoot && (
          <p className="break-all text-[11px] text-content/40">
            {t("harness.worktrees.createdIn", { path: prettyCwd(defaultRoot) })}
          </p>
        )}
        {error && (
          <p role="alert" className="text-[12px] text-red-400">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="rounded-md px-3 py-1.5 text-[12px] hover:bg-content/8 active:scale-[0.97]"
          >
            {t("harness.worktrees.cancel")}
          </button>
          <button
            type="submit"
            disabled={busy || !name.trim()}
            className="inline-flex items-center gap-1.5 rounded-md bg-content px-3 py-1.5 text-[12px] font-medium text-background-base disabled:opacity-40 active:scale-[0.97]"
          >
            {busy && <Loader className="size-3.5 animate-spin" />}
            {t("harness.worktrees.createButton")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
