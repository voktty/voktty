import type { FileCitationSource } from "@/modules/ai/store/chatStore";
import { searchGuestFiles } from "@/modules/collab/lib/guestRuntime";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useState } from "react";
import { useProjectFileSource } from "@/modules/remote/useProjectFileSource";
import type { ProjectFileSource } from "@/modules/remote/projectFileSource";
import {
  citationFileTarget,
  createCitationFileIndex,
  isCitationRelativePath,
  type CitationFileIndex,
} from "@/modules/ai/lib/workspaceCitationFiles";

export type WorkspaceFilesState = {
  files: string[];
  indexing: boolean;
  truncated: boolean;
  hasWorkspace: boolean;
  remote: boolean;
  error: string | null;
  projectSource?: ProjectFileSource;
};

const index = createCitationFileIndex(async ({ root, workspace }) => {
  if (workspace.kind !== "ssh")
    return invoke<CitationFileIndex>("fs_list_files", {
      root,
      workspace,
      limit: 10_000,
      maxDepth: 16,
    });
  const [{ indexRemoteFiles }, { remoteReadDir }] = await Promise.all([
    import("@/modules/quick-open/lib/remoteFileIndex"),
    import("@/modules/remote"),
  ]);
  let directories = 0;
  let entries = 0;
  return indexRemoteFiles(root, async (path) => {
    if (++directories > 256) throw new Error("File index directory limit");
    const result = await remoteReadDir(workspace, path);
    entries += result.length;
    if (entries > 20_000) throw new Error("File index entry limit");
    if (
      result.some(
        (entry) =>
          entry.name.includes("/") || !isCitationRelativePath(entry.name),
      )
    )
      throw new Error("Invalid file index entry");
    return result;
  });
});
let guestSearches = 0;

const EMPTY_STATE: WorkspaceFilesState = {
  files: [],
  indexing: false,
  truncated: false,
  hasWorkspace: false,
  remote: false,
  error: null,
};

export function useWorkspaceFiles(
  source: FileCitationSource,
  query: string,
  enabled: boolean,
): WorkspaceFilesState {
  const descriptor = JSON.stringify(source);
  const projectSource = useProjectFileSource(
    source.kind === "local" ? source.root : null,
    enabled,
  );
  const binding = useMemo(() => {
    const captured = JSON.parse(descriptor) as FileCitationSource;
    return {
      target: citationFileTarget(captured),
      guest: captured.kind === "collab" ? captured : null,
      projectSource,
    };
  }, [descriptor, projectSource]);
  const searchQuery = source.kind === "collab" ? query : "";
  const [state, setState] = useState<{
    binding: typeof binding;
    value: WorkspaceFilesState;
  } | null>(null);
  const available = Boolean(
    binding.target || binding.projectSource || binding.guest?.available,
  );
  const remote = Boolean(binding.guest);

  useEffect(() => {
    if (!enabled || !available) return;
    let current = true;
    const allowed = () =>
      current && (!binding.projectSource || binding.projectSource.isCurrent());
    const publish = (value: WorkspaceFilesState) => {
      if (allowed())
        setState((previous) => (allowed() ? { binding, value } : previous));
    };
    const base = { ...EMPTY_STATE, hasWorkspace: true, remote };
    publish({ ...base, indexing: true });
    const read = async (): Promise<CitationFileIndex> => {
      if (binding.target) return index.load(binding.target);
      if (binding.projectSource)
        return binding.projectSource.listFiles(allowed);
      if (!binding.guest || guestSearches >= 16)
        throw new Error("File search is busy");
      guestSearches++;
      try {
        return await searchGuestFiles(binding.guest.leafId, searchQuery, 30);
      } finally {
        guestSearches--;
      }
    };
    void read()
      .then((result) => publish({ ...base, ...result }))
      .catch(() => publish({ ...base, error: "File search unavailable" }));
    return () => {
      current = false;
    };
  }, [available, binding, enabled, remote, searchQuery]);

  const value =
    state?.binding === binding
      ? state.value
      : {
          ...EMPTY_STATE,
          hasWorkspace: available,
          remote,
          indexing: enabled && available,
        };
  return binding.projectSource
    ? { ...value, projectSource: binding.projectSource }
    : value;
}
