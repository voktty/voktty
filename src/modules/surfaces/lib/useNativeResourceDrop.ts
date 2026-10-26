import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isWindowsNativePath, LOCAL_WORKSPACE } from "@/modules/workspace";
import { useChatStore } from "@/modules/ai/store/chatStore";
import { useChatActionOwner } from "@/modules/ai/lib/useChatActionOwner";
import type { SlotId, ViewSpaceId } from "@/modules/spaces/lib/spaceLayout";
import type {
  WorkspaceDragSource,
  WorkspaceDropTarget,
} from "@/modules/spaces/lib/workspaceDrag";

let pendingDrops = 0;

export function useNativeResourceDrop({
  viewSpaceId,
  sourceKey,
  drop,
  onUnavailable,
}: {
  viewSpaceId: ViewSpaceId | undefined;
  sourceKey: string;
  drop: (
    source: WorkspaceDragSource,
    target: WorkspaceDropTarget,
    isCurrent: () => boolean,
  ) => void | Promise<void>;
  onUnavailable: () => void;
}) {
  const sessionId = useChatStore((state) => state.activeSessionId);
  const captureChat = useChatActionOwner(sessionId);
  const binding = useMemo(
    () => ({ viewSpaceId, sourceKey, captureChat }),
    [viewSpaceId, sourceKey, captureChat],
  );
  const committed = useRef<{ binding: typeof binding; active: boolean } | null>(
    null,
  );
  useLayoutEffect(() => {
    const owner = { binding, active: true };
    committed.current = owner;
    return () => {
      owner.active = false;
      if (committed.current === owner) committed.current = null;
    };
  }, [binding]);
  return useCallback(
    async (slotId: SlotId, event: React.DragEvent<HTMLElement>) => {
      const owner = committed.current;
      const chat = captureChat();
      let chatCurrent = true;
      const isCurrent = () =>
        Boolean(
          chatCurrent &&
          owner?.active &&
          owner.binding === binding &&
          (sessionId === null
            ? useChatStore.getState().activeSessionId === null
            : chat?.isCurrent()),
        );
      if (!viewSpaceId || !isCurrent() || pendingDrops >= 16) return;
      const raw =
        event.dataTransfer.getData("text/uri-list") ||
        event.dataTransfer.getData("text/plain");
      const candidate = raw
        .split("\n")
        .map((value) => value.trim())
        .find(Boolean)
        ?.replace(/^file:\/\//, "");
      if (!candidate || candidate.length > 32768) return;
      let path: string;
      try {
        path = decodeURIComponent(candidate);
      } catch {
        return;
      }
      if (
        (!path.startsWith("/") && !isWindowsNativePath(path)) ||
        /[\x00-\x1f\x7f]/.test(path)
      )
        return;
      pendingDrops++;
      const unsubscribe = useChatStore.subscribe((state) => {
        if (state.activeSessionId !== sessionId) chatCurrent = false;
      });
      try {
        const stat = await invoke<{ kind: string }>("fs_stat", {
          path,
          workspace: LOCAL_WORKSPACE,
        });
        if (!isCurrent()) return;
        if (
          stat.kind !== "dir" &&
          stat.kind !== "file" &&
          stat.kind !== "symlink"
        ) {
          onUnavailable();
          return;
        }
        await drop(
          {
            kind: stat.kind === "dir" ? "directory" : "file",
            path,
            workspaceEnv: LOCAL_WORKSPACE,
          },
          { kind: "slot", viewSpaceId, slotId },
          isCurrent,
        );
      } catch {
        if (isCurrent()) onUnavailable();
      } finally {
        unsubscribe();
        pendingDrops--;
      }
    },
    [binding, captureChat, drop, onUnavailable, sessionId, viewSpaceId],
  );
}
