import { useLayoutEffect, useState } from "react";
import { createProjectFileSourceStore } from "@/modules/remote/projectFileSource";
import {
  loadProjectFiles,
  peekProjectFiles,
} from "@/modules/harness/lib/fileIndex";
import type { ProjectFile } from "@/modules/harness/lib/fs";
import { looksLikeProject } from "@/modules/harness/lib/recents";

type Presentation = {
  files: ProjectFile[];
  loading: boolean;
  error: string | null;
  isCurrent: () => boolean;
};

const EMPTY: Presentation = {
  files: [],
  loading: false,
  error: null,
  isCurrent: () => false,
};

export function useProjectFileIndex(cwd: string, active: boolean) {
  const [presentation, setPresentation] = useState(EMPTY);

  useLayoutEffect(() => {
    if (!active) return;
    let mounted = true;
    let retireRead = () => {};
    const store = cwd.startsWith("remote://voktty-ssh-")
      ? createProjectFileSourceStore(cwd)
      : undefined;
    const read = () => {
      retireRead();
      let current = true;
      retireRead = () => {
        current = false;
      };
      const source = store?.getSnapshot().source;
      const isCurrent = () =>
        mounted && current && (!store || Boolean(source?.isCurrent()));
      const files = isCurrent() ? (peekProjectFiles(cwd) ?? []) : [];
      const available = looksLikeProject(cwd) && isCurrent();
      setPresentation({ files, loading: available, error: null, isCurrent });
      if (!available) return;
      // Let every metadata observer retire its cache before replacement IO.
      void Promise.resolve()
        .then(() => (isCurrent() ? loadProjectFiles(cwd, true) : undefined))
        .then(
          (next) => {
            if (!next || !isCurrent()) return;
            setPresentation((previous) =>
              isCurrent()
                ? { files: next, loading: false, error: null, isCurrent }
                : previous,
            );
          },
          (error: unknown) => {
            if (!isCurrent()) return;
            setPresentation((previous) =>
              isCurrent()
                ? {
                    files,
                    loading: false,
                    error:
                      error instanceof Error ? error.message : String(error),
                    isCurrent,
                  }
                : previous,
            );
          },
        );
    };
    let initializing = true;
    const stop = store?.subscribe(() => {
      if (!initializing) read();
    });
    initializing = false;
    read();
    return () => {
      mounted = false;
      retireRead();
      stop?.();
    };
  }, [cwd, active]);

  return presentation;
}
