import { useLayoutEffect, useMemo, useState } from "react";
import { remoteProjectForPath } from "@/modules/connections/model/remoteProjects";
import { usePreferencesStore } from "@/modules/settings/preferences";
import type { WorkspaceEnv } from "@/modules/workspace";
import { isRemoteProjectUri } from "@/modules/explorer/lib/remoteProjectDir";

type Metadata = { size: number; mtime: number };
let pending = 0;
const MAX_PENDING = 256;

export function useProjectEntryMetadata(
  path: string,
  workspace: WorkspaceEnv,
  open: boolean,
) {
  const source = useMemo(() => {
    if (!open || !isRemoteProjectUri(path)) return undefined;
    return {
      path,
      workspace,
      project: remoteProjectForPath(path),
      profiles: (usePreferencesStore.getState().sshConnections ?? []).map(
        (profile) => ({ ...profile }),
      ),
    };
  }, [path, workspace, open]);
  const [result, setResult] = useState<{
    source: typeof source;
    metadata: Metadata;
  }>();

  useLayoutEffect(() => {
    if (!source || pending >= MAX_PENDING) return;
    let active = true;
    const current = () => active;
    pending++;
    void (async () => {
      try {
        const { createProjectDocument } = await import(
          "@/modules/remote/projectDocument"
        );
        if (!current()) return;
        const metadata = await createProjectDocument(
          source.path,
          source.project,
          source.profiles,
        ).stat(current);
        if (
          current() &&
          Number.isSafeInteger(metadata.size) &&
          metadata.size >= 0 &&
          Number.isFinite(metadata.mtime) &&
          metadata.mtime >= 0 &&
          metadata.mtime <= 8_640_000_000_000_000
        )
          setResult({ source, metadata });
      } catch {
        // An unavailable remote stat must not turn into local metadata.
      } finally {
        pending--;
      }
    })();
    return () => {
      active = false;
    };
  }, [source]);

  return result?.source === source ? result?.metadata : undefined;
}
