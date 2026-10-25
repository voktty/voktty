import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { native } from "@/modules/ai/lib/native";
import { t } from "@/modules/i18n";
import type { WorkspaceEnv } from "@/modules/workspace";
import { toast } from "sonner";
import {
  useConflictScope,
  type ConflictAdmission,
} from "@/modules/source-control/useConflictScope";
import {
  conflictFileTarget,
  readConflictFile,
  writeConflictFile,
  MAX_CONFLICT_BYTES,
} from "@/modules/source-control/lib/conflictFile";
import {
  applyConflictResolutions,
  parseConflictMarkers,
  type ParsedConflicts,
  type ConflictResolution,
} from "@/modules/source-control/lib/conflictMarkers";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "unresolvable" }
  | { status: "ready"; parsed: ParsedConflicts; original: string };
const LOADING: LoadState = { status: "loading" };
const alwaysCurrent = () => true;

export function useConflictResolver({
  open,
  repoRoot,
  path,
  workspace,
  onOpenChange,
  onResolved,
  isCurrent = alwaysCurrent,
  admit,
  blocked = false,
}: {
  open: boolean;
  repoRoot: string;
  path: string;
  workspace: WorkspaceEnv;
  onOpenChange: (open: boolean) => void;
  onResolved: () => void;
  isCurrent?: () => boolean;
  admit?: ConflictAdmission;
  blocked?: boolean;
}) {
  const scope = useConflictScope(
    JSON.stringify([repoRoot, path]),
    open,
    workspace,
  );
  const filesystem = JSON.stringify(workspace);
  const target = useMemo(
    () => conflictFileTarget(repoRoot, path, JSON.parse(filesystem)),
    [repoRoot, path, filesystem],
  );
  const [loaded, setLoaded] = useState<{
    binding: object;
    state: LoadState;
  } | null>(null);
  const [choices, setChoices] = useState<{
    binding: object;
    values: Map<number, ConflictResolution>;
  } | null>(null);
  const [savingBinding, setSaving] = useState<object | null>(null);
  const pending = useRef(new Set<object>());
  const knownContent = useRef<{ binding: object; content: string } | null>(
    null,
  );
  const state = loaded?.binding === scope.binding ? loaded.state : LOADING;
  const resolutions =
    choices?.binding === scope.binding
      ? choices.values
      : new Map<number, ConflictResolution>();
  const saving = savingBinding === scope.binding;
  useEffect(() => {
    const permit = scope.capture();
    if (!permit || !isCurrent()) return;
    let active = true;
    const valid = () => active && permit.isCurrent() && isCurrent();
    const publish = (state: LoadState) => {
      if (valid())
        setLoaded((previous) =>
          valid() ? { binding: scope.binding, state } : previous,
        );
    };
    if (!target) {
      publish({ status: "error", message: t("git.unsupportedFilesystem") });
      return;
    }
    const release = admit ? admit() : permit.begin();
    if (!release) {
      publish({ status: "error", message: t("git.waitActionFinish") });
      return;
    }
    void (async () => {
      try {
        const result = await readConflictFile(target);
        if (!valid()) return;
        if (
          result.kind !== "text" ||
          result.size > MAX_CONFLICT_BYTES ||
          result.content.length > MAX_CONFLICT_BYTES ||
          new TextEncoder().encode(result.content).byteLength >
            MAX_CONFLICT_BYTES ||
          result.content.includes("\0")
        ) {
          publish({ status: "unresolvable" });
          return;
        }
        const parsed = parseConflictMarkers(result.content);
        publish(
          parsed.hunks.length
            ? { status: "ready", parsed, original: result.content }
            : { status: "unresolvable" },
        );
      } catch (error) {
        publish({ status: "error", message: String(error) });
      } finally {
        release();
      }
    })();
    return () => {
      active = false;
    };
  }, [scope.binding, scope.capture, target, isCurrent, admit]);
  const setResolution = useCallback(
    (index: number, resolution: ConflictResolution) => {
      const permit = scope.capture();
      if (
        !permit ||
        !isCurrent() ||
        saving ||
        state.status !== "ready" ||
        !state.parsed.hunks[index]
      )
        return;
      setChoices((previous) => {
        if (!permit.isCurrent() || !isCurrent()) return previous;
        const values = new Map(
          previous?.binding === scope.binding ? previous.values : [],
        );
        values.set(index, resolution);
        return { binding: scope.binding, values };
      });
    },
    [scope.binding, scope.capture, isCurrent, saving, state],
  );
  const hunkCount = state.status === "ready" ? state.parsed.hunks.length : 0;
  const allResolved = hunkCount > 0 && resolutions.size === hunkCount;
  const requestClose = useCallback(() => {
    const permit = scope.capture();
    if (!permit || !isCurrent()) return;
    permit.retire();
    onOpenChange(false);
  }, [scope.capture, isCurrent, onOpenChange]);
  const handleSave = useCallback(async () => {
    const permit = scope.capture();
    if (
      !permit ||
      !isCurrent() ||
      !target ||
      state.status !== "ready" ||
      !allResolved ||
      blocked ||
      pending.current.has(scope.binding)
    )
      return;
    const release = admit ? admit("resolve") : permit.begin("resolve");
    if (!release) {
      if (permit.isCurrent() && isCurrent())
        toast.error(t("git.waitActionFinish"));
      return;
    }
    const binding = scope.binding;
    const valid = () => permit.isCurrent() && isCurrent();
    const expected =
      knownContent.current?.binding === binding
        ? knownContent.current.content
        : state.original;
    pending.current.add(binding);
    setSaving(binding);
    try {
      const content = applyConflictResolutions(
        state.parsed,
        new Map(resolutions),
      );
      const current = await readConflictFile(target);
      if (!valid()) return;
      if (current.kind !== "text" || current.content !== expected)
        throw new Error(t("feedback.fileChangedOnDisk"));
      if (content !== expected) {
        await writeConflictFile(target, content, expected);
        if (!valid()) return;
        knownContent.current = { binding, content };
      }
      if (!valid()) return;
      await native.gitStage(repoRoot, [target.relative], permit.workspace());
      if (!valid()) return;
      toast.success(t("git.conflicts.resolvedSuccess", { path }));
      if (!valid()) return;
      onResolved();
      if (valid()) requestClose();
    } catch (error) {
      if (valid()) toast.error(String(error));
    } finally {
      pending.current.delete(binding);
      release();
      if (valid())
        setSaving((previous) =>
          valid() && previous === binding ? null : previous,
        );
    }
  }, [
    scope.binding,
    scope.capture,
    target,
    state,
    allResolved,
    resolutions,
    blocked,
    admit,
    isCurrent,
    repoRoot,
    path,
    onResolved,
    requestClose,
  ]);
  return {
    state,
    resolutions,
    setResolution,
    hunkCount,
    allResolved,
    saving,
    handleSave,
    requestClose,
  };
}
