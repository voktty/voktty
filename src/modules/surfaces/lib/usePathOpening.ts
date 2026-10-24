import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import { useSpaces } from "@/modules/spaces/lib/useSpaces";
import {
  PATH_OPENING_EVENT,
  pathOpeningRequest,
  readPathOpeningRequest,
  type PathOpeningRequest,
} from "@/modules/surfaces/lib/pathOpeningRequest";
import { pathOpeningKind } from "@/modules/surfaces/lib/pathOpeningFilesystem";

type Props = {
  spaceId: string;
  sourceKey: string | null;
  openFile: (request: PathOpeningRequest) => void;
  openDirectory: (request: PathOpeningRequest, current: () => boolean) => void;
  onError: () => void;
};

export function usePathOpening({
  spaceId,
  sourceKey,
  openFile,
  openDirectory,
  onError,
}: Props) {
  const binding = useMemo(
    () => ({ spaceId, sourceKey, openFile, openDirectory, onError }),
    [spaceId, sourceKey, openFile, openDirectory, onError],
  );
  const owner = useRef<{ binding: typeof binding; live: boolean } | null>(null);
  const pending = useRef(0);
  const queuedCount = useRef(0);
  const revision = useRef(0);
  useLayoutEffect(() => {
    const receipt = { binding, live: true };
    owner.current = receipt;
    const signature = () => {
      const state = useSpaces.getState();
      const space = state.spaces.find((space) => space.id === spaceId);
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
  const openBatch = useCallback(
    async (inputs: readonly PathOpeningRequest[]) => {
      const receipt = owner.current;
      const capturedRevision = revision.current;
      const selection = useSpaces.getState().activeId;
      const current = () =>
        !!receipt?.live &&
        owner.current === receipt &&
        receipt.binding === binding &&
        revision.current === capturedRevision &&
        (selection === null || selection === spaceId) &&
        useSpaces.getState().spaces.some((space) => space.id === spaceId);
      if (
        !current() ||
        inputs.length === 0 ||
        inputs.length > 256 - pending.current - queuedCount.current
      )
        return;
      pending.current += inputs.length;
      try {
        const results = await Promise.allSettled(
          inputs.map(async (input) => {
            const request = pathOpeningRequest(
              input.path,
              input.workspace,
              input.kind,
            );
            if (
              request.workspace.kind === "docker" ||
              request.workspace.kind === "serial"
            )
              throw new Error("Path opening filesystem unavailable");
            const kind =
              request.kind === "file"
                ? "file"
                : await pathOpeningKind(request, current);
            return { request, kind };
          }),
        );
        for (const result of results) {
          if (!current()) return;
          if (result.status === "rejected") onError();
          else if (result.value.kind === "dir")
            openDirectory(result.value.request, current);
          else openFile(result.value.request);
        }
      } catch {
        if (current()) onError();
      } finally {
        pending.current -= inputs.length;
      }
    },
    [binding, spaceId, openDirectory, openFile, onError],
  );
  const open = useCallback(
    (input: PathOpeningRequest) => openBatch([input]),
    [openBatch],
  );
  useEffect(() => {
    const queued: PathOpeningRequest[] = [];
    let scheduled = false;
    let live = true;
    const handler = (event: Event) => {
      const request = readPathOpeningRequest(
        (event as CustomEvent<unknown>).detail,
      );
      if (!request || queuedCount.current >= 256 - pending.current) return;
      queued.push(request);
      queuedCount.current++;
      if (scheduled) return;
      scheduled = true;
      const capturedOwner = owner.current;
      const capturedRevision = revision.current;
      queueMicrotask(() => {
        scheduled = false;
        const batch = queued.splice(0);
        queuedCount.current -= batch.length;
        if (
          live &&
          capturedOwner?.live &&
          owner.current === capturedOwner &&
          revision.current === capturedRevision
        )
          void openBatch(batch);
      });
    };
    window.addEventListener(PATH_OPENING_EVENT, handler);
    return () => {
      live = false;
      queuedCount.current -= queued.length;
      queued.length = 0;
      window.removeEventListener(PATH_OPENING_EVENT, handler);
    };
  }, [openBatch]);
  return open;
}
