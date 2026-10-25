import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { native } from "@/modules/ai/lib/native";
import { t } from "@/modules/i18n";
import { useSpaces } from "@/modules/spaces/lib/useSpaces";
import { toast } from "sonner";
import {
  GIT_HISTORY_EVENT,
  readGitHistoryRequest,
  takeGitHistoryRequest,
  type GitHistoryInput,
} from "@/modules/source-control/gitHistoryRequest";

type Props = {
  spaceId: string;
  sourceKey: string | null;
  open: (input: GitHistoryInput & { spaceId: string }) => unknown;
};

export function useGitHistoryRequests({ spaceId, sourceKey, open }: Props) {
  const binding = useMemo(
    () => ({ spaceId, sourceKey, open }),
    [spaceId, sourceKey, open],
  );
  const owner = useRef<{ binding: typeof binding; live: boolean } | null>(null);
  const revision = useRef(0);
  const pending = useRef(0);
  useLayoutEffect(() => {
    const receipt = { binding, live: true };
    owner.current = receipt;
    const signature = () => {
      const state = useSpaces.getState();
      const space = state.spaces.find((candidate) => candidate.id === spaceId);
      return JSON.stringify([
        state.activeId,
        space?.createdAt,
        space?.root,
        space?.env,
      ]);
    };
    let previous = signature();
    const stop = useSpaces.subscribe(() => {
      const next = signature();
      if (next !== previous) revision.current++;
      previous = next;
    });
    return () => {
      receipt.live = false;
      stop();
    };
  }, [binding, spaceId]);
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      const request = readGitHistoryRequest(detail);
      const receipt = owner.current;
      const capturedRevision = revision.current;
      const current = () =>
        !!receipt?.live &&
        owner.current === receipt &&
        receipt.binding === binding &&
        revision.current === capturedRevision &&
        request?.isCurrent() &&
        (useSpaces.getState().activeId === null ||
          useSpaces.getState().activeId === spaceId) &&
        useSpaces.getState().spaces.some((space) => space.id === spaceId);
      if (!request || !current() || pending.current >= 256) return;
      if (takeGitHistoryRequest(detail) !== request) return;
      pending.current++;
      const { input } = request;
      void (async () => {
        try {
          const repo = await native.gitResolveRepo(
            input.repoRoot,
            input.workspaceEnv,
          );
          if (!current()) return;
          if (!repo) {
            toast.info(t("feedback.noGitRepository"));
            return;
          }
          open({ ...input, repoRoot: repo.repoRoot, spaceId });
        } catch (error) {
          if (current())
            toast.error(t("feedback.resolveGitRepositoryFailed"), {
              description:
                error instanceof Error ? error.message : String(error),
            });
        } finally {
          pending.current--;
        }
      })();
    };
    window.addEventListener(GIT_HISTORY_EVENT, handler);
    return () => window.removeEventListener(GIT_HISTORY_EVENT, handler);
  }, [binding, spaceId, open]);
}
