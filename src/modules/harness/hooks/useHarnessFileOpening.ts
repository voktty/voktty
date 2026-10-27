import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  type Dispatch,
  type SetStateAction,
} from "react";
import { flushSync } from "react-dom";
import {
  rememberOpenedFile,
  resolveFileOpenRequest,
} from "@/modules/harness/lib/fileIndex";
import {
  focusedFileTab,
  newFileTab,
  openEditorTab,
  openSessionChangesTab,
  type SessionChangesView,
  type WorkspaceTab,
} from "@/modules/harness/lib/layout";
import type {
  EditorNavigation,
  FileOpenOptions,
  OpenFileFn,
} from "@/modules/harness/lib/search";
import { createProjectFileSourceStore } from "@/modules/remote/projectFileSource";

type Review = { sessionId: string; cwd: string; view?: SessionChangesView };
type Permit = { isCurrent: () => boolean };
type Props = {
  tabs: readonly WorkspaceTab[];
  activeTabId: string;
  cwd: string;
  projectCwd: string;
  enabled: boolean;
  deckLayout: boolean;
  capture: () => Permit | undefined;
  setTabs: Dispatch<SetStateAction<WorkspaceTab[]>>;
  navigate: (
    path: string,
    navigation: EditorNavigation,
    isCurrent: () => boolean,
  ) => void;
  showChanges: (isCurrent: () => boolean) => void;
  focusEditor: (isCurrent: () => boolean) => void;
  onError: (error: unknown) => void;
};

let pending = 0;
const MAX_PENDING = 256;

export function useHarnessFileOpening(props: Props) {
  const tab = props.tabs.find((entry) => entry.id === props.activeTabId);
  const selectedFileId = tab ? focusedFileTab(tab)?.id : undefined;
  const binding = useMemo(
    () => ({
      activeTabId: props.activeTabId,
      cwd: props.cwd,
      projectCwd: props.projectCwd,
      enabled: props.enabled,
      deckLayout: props.deckLayout,
      layout: tab?.layout,
      focusedId: tab?.focusedId,
      selectedFileId,
    }),
    [
      props.activeTabId,
      props.cwd,
      props.projectCwd,
      props.enabled,
      props.deckLayout,
      tab?.layout,
      tab?.focusedId,
      selectedFileId,
    ],
  );
  const committed = useRef<{
    binding: object;
    props: Props;
    tab: WorkspaceTab | undefined;
  } | null>(null);
  const lifetime = useRef<object | null>(null);
  const selectedRequest = useRef<object | null>(null);
  useLayoutEffect(() => {
    committed.current = { binding, props, tab };
  });
  useLayoutEffect(() => {
    const owner = { binding };
    lifetime.current = owner;
    return () => {
      if (lifetime.current === owner) lifetime.current = null;
    };
  }, [binding]);

  const open = useCallback(
    (
      path: string | undefined,
      navigation?: EditorNavigation,
      options?: FileOpenOptions,
      review?: Review,
      diff = false,
    ) => {
      const captured = committed.current;
      const owner = lifetime.current;
      if (
        !captured ||
        captured.binding !== binding ||
        !owner ||
        !captured.props.enabled ||
        !captured.tab
      )
        return;
      const original = captured.props;
      const target = captured.tab;
      const permit = original.capture();
      if (!permit?.isCurrent()) return;
      const request = {};
      const ownerCurrent = () =>
        lifetime.current === owner && permit.isCurrent();
      const presentationCurrent = () =>
        ownerCurrent() && selectedRequest.current === request;
      if (pending >= MAX_PENDING) {
        if (ownerCurrent())
          original.onError(new Error("File opening capacity exceeded."));
        return;
      }
      selectedRequest.current = request;
      const sourceCwd = review?.cwd ?? original.cwd;
      const fileCwd =
        review?.cwd ??
        (diff
          ? options?.repoRoot || original.cwd || original.projectCwd
          : original.projectCwd);
      const copiedNavigation = navigation ? { ...navigation } : undefined;
      const copiedOptions = options ? { ...options } : undefined;
      const copiedReview = review ? { ...review } : undefined;
      let stop: (() => void) | undefined;
      let sourceCurrent = () => true;
      let sourceEstablished = false;
      const isCurrent = () => presentationCurrent() && sourceCurrent();
      pending++;
      void (async () => {
        try {
          if (sourceCwd.startsWith("remote://voktty-ssh-")) {
            const store = createProjectFileSourceStore(sourceCwd);
            const key = store.getSnapshot().source?.key;
            stop = store.subscribe(() => {});
            const source = store.getSnapshot().source;
            sourceCurrent = () =>
              Boolean(source && source.key === key && source.isCurrent());
            if (!sourceCurrent())
              throw new Error("The saved project connection is unavailable.");
          }
          sourceEstablished = true;
          if (!isCurrent()) return;
          const resolved =
            path === undefined
              ? undefined
              : await resolveFileOpenRequest(sourceCwd, path, copiedOptions);
          if (!isCurrent()) return;
          const file = resolved
            ? newFileTab(resolved, fileCwd, diff)
            : undefined;
          flushSync(() => {
            original.setTabs((previous) => {
              if (!isCurrent()) return previous;
              return previous.map((entry) => {
                if (
                  entry.id !== target.id ||
                  entry.layout !== target.layout ||
                  entry.focusedId !== target.focusedId
                )
                  return entry;
                if (copiedReview)
                  return openSessionChangesTab(
                    entry,
                    copiedReview.cwd,
                    copiedReview.sessionId,
                    resolved,
                    copiedReview.view,
                  );
                const opened = file ? openEditorTab(entry, file) : entry;
                return diff && !original.deckLayout
                  ? { ...opened, diffOpen: true, diffFocused: !resolved }
                  : opened;
              });
            });
            if (!isCurrent()) return;
            if (resolved) rememberOpenedFile(original.projectCwd, resolved);
            if (!isCurrent()) return;
            if (resolved && copiedNavigation)
              original.navigate(resolved, copiedNavigation, isCurrent);
            if (!isCurrent()) return;
            if (diff && original.deckLayout) original.showChanges(isCurrent);
            if (isCurrent()) original.focusEditor(isCurrent);
          });
        } catch (error) {
          if (presentationCurrent() && (!sourceEstablished || sourceCurrent()))
            original.onError(error);
        } finally {
          try {
            stop?.();
          } finally {
            pending--;
          }
        }
      })();
    },
    [binding],
  );

  const onOpenFile: OpenFileFn = useCallback(
    (path, navigation, options) => open(path, navigation, options),
    [open],
  );
  const onOpenDiff = useCallback(
    (path?: string, review?: Review, options?: FileOpenOptions) =>
      open(path, undefined, options, review, true),
    [open],
  );
  return { onOpenFile, onOpenDiff };
}
