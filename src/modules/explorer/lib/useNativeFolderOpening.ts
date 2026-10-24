import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { t } from "@/modules/i18n";
import type { Tab } from "@/modules/tabs/lib/useTabs";
import { useSpaces } from "@/modules/spaces/lib/useSpaces";
import { LOCAL_WORKSPACE } from "@/modules/workspace";
import {
  isNativeFolderPath,
  nativeFolderDefaultPath,
  nativeFolderSource,
} from "@/modules/explorer/lib/nativeFolderSelection";

export function useNativeFolderOpening({
  source,
  spaceId,
  localLaunchCwd,
  localHome,
}: {
  source: Tab | undefined;
  spaceId: string;
  localLaunchCwd: string | null;
  localHome: string | null;
}) {
  const space = useSpaces((state) =>
    state.spaces.find((candidate) => candidate.id === spaceId),
  );
  const sourceKey = nativeFolderSource(source, space);
  const defaultPath = nativeFolderDefaultPath(
    source,
    space,
    localLaunchCwd,
    localHome,
  );
  const spaceKey = space
    ? JSON.stringify([space.createdAt, space.root, space.env])
    : null;
  const binding = useMemo(
    () => ({ sourceKey, spaceId, defaultPath }),
    [sourceKey, spaceId, defaultPath],
  );
  const owner = useRef<{ binding: typeof binding; current: boolean } | null>(
    null,
  );
  const pending = useRef<{ current: () => boolean; retired: boolean } | null>(
    null,
  );
  useLayoutEffect(() => {
    const receipt = { binding, current: true };
    owner.current = receipt;
    return () => {
      receipt.current = false;
      if (owner.current === receipt) owner.current = null;
    };
  }, [binding]);
  useLayoutEffect(
    () =>
      useSpaces.subscribe(() => {
        const request = pending.current;
        if (request && !request.current()) request.retired = true;
      }),
    [],
  );
  return useCallback(async (): Promise<boolean> => {
    const receipt = owner.current;
    if (
      !receipt?.current ||
      receipt.binding !== binding ||
      !spaceKey ||
      pending.current
    )
      return false;
    const selection = useSpaces.getState().activeId;
    if (selection !== null && selection !== spaceId) return false;
    const request = {
      retired: false,
      current: (): boolean => {
        if (request.retired || !receipt.current || owner.current !== receipt)
          return false;
        const state = useSpaces.getState();
        const live = state.spaces.find((candidate) => candidate.id === spaceId);
        return (
          state.activeId === selection &&
          !!live &&
          JSON.stringify([live.createdAt, live.root, live.env]) === spaceKey
        );
      },
    };
    if (!request.current()) return false;
    pending.current = request;
    try {
      const picked = await invoke<string | null>("fs_pick_folder", {
        defaultPath,
      });
      if (!request.current() || picked === null) return false;
      if (!isNativeFolderPath(picked))
        throw new Error("Invalid native folder selection");
      return useSpaces
        .getState()
        .setContext(spaceId, picked, LOCAL_WORKSPACE, request.current);
    } catch {
      if (request.current()) toast.error(t("feedback.somethingWentWrong"));
      return false;
    } finally {
      if (pending.current === request) pending.current = null;
    }
  }, [binding, spaceKey, spaceId, defaultPath]);
}
