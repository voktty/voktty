import { useLayoutEffect, useRef } from "react";
import { toast } from "sonner";
import { t } from "@/modules/i18n";
import { subscribeHarnessSourceControl } from "@/modules/source-control/harnessSourceControlRequest";
import { LOCAL_WORKSPACE, type WorkspaceEnv } from "@/modules/workspace";

type Props = {
  sourceKey: string | null;
  open: (
    projectPath: string,
    isCurrent: () => boolean,
    workspace: WorkspaceEnv,
  ) => Promise<void>;
};

export function useHarnessSourceControlOpening({ sourceKey, open }: Props) {
  const pending = useRef(0);
  const generation = useRef(0);
  useLayoutEffect(() => {
    if (sourceKey === null) return;
    let live = true;
    const unsubscribe = subscribeHarnessSourceControl((projectPath, senderCurrent) => {
      if (!live || !senderCurrent() || pending.current >= 256) return;
      const request = ++generation.current;
      const current = () => live && request === generation.current && senderCurrent();
      pending.current++;
      void (async () => {
        try {
          await open(projectPath, current, LOCAL_WORKSPACE);
        } catch (error) {
          if (current()) {
            toast.error(t("feedback.resolveGitRepositoryFailed"), {
              description: error instanceof Error ? error.message : String(error),
            });
          }
        } finally {
          pending.current--;
        }
      })();
    });
    return () => {
      live = false;
      unsubscribe();
    };
  }, [sourceKey, open]);
}
