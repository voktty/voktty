import { useEffect } from "react";
import { toast } from "sonner";
import { t } from "@/modules/i18n";
import { parseRemotePath } from "@/modules/connections/model/remoteProjects";
import { subscribeRemoteSessionProblems } from "../lib/remoteSessionAlerts";

/** Surfaces conversations on SSH projects that are not reaching the project's
 * `.voktty` folder, which otherwise fail without any sign. */
export function useRemoteSessionAlerts(): void {
  useEffect(
    () =>
      subscribeRemoteSessionProblems((problem) => {
        if (problem.kind === "save-failed") {
          toast.error(
            t("harness.chrome.remoteSessionSaveFailed", {
              error: problem.message,
            }),
          );
          return;
        }
        toast.warning(
          t("harness.chrome.remoteSessionNotSaved", {
            path: parseRemotePath(problem.cwd)?.hostPath ?? problem.cwd,
          }),
        );
      }),
    [],
  );
}
